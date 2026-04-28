import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { Schema } from "../../data/resource";

type SqsRecord = {
  messageId: string;
  body: string;
  attributes?: Record<string, string>;
};

type SqsEvent = {
  Records?: SqsRecord[];
};

type BatchFailure = { itemIdentifier: string };

type SmsFanoutEvent = {
  schemaVersion: number;
  eventType: string;
  batchId?: string;
  smsLogId?: string;
  phone?: string;
  normalised?: string | null;
  status?: string;
  smsType?: string;
  error?: string;
  snsMessageId?: string;
  sentAt?: string;
  topicPublishedAt?: string;
};

const DEAD_LETTER_THRESHOLD = Number(process.env.SMS_EVENT_MAX_RECEIVE_COUNT ?? 3);

function parseSnsEnvelope(record: SqsRecord): SmsFanoutEvent {
  const body = JSON.parse(String(record.body ?? "{}"));
  const rawMessage = body?.Type === "Notification" ? body?.Message : body?.Message ?? record.body;
  const parsed = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Queue message did not contain a valid SMS event payload");
  }
  return parsed as SmsFanoutEvent;
}

async function configureClient() {
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
}

export const handler = async (event: SqsEvent): Promise<{ batchItemFailures: BatchFailure[] }> => {
  const client = await configureClient();
  const failures: BatchFailure[] = [];

  for (const record of event.Records ?? []) {
    const receiveCount = Number(record.attributes?.ApproximateReceiveCount ?? 1);
    const processedAt = new Date().toISOString();

    try {
      const payload = parseSnsEnvelope(record);
      const smsLogId = String(payload.smsLogId ?? "").trim();
      const batchId = String(payload.batchId ?? "").trim();
      const eventType = String(payload.eventType ?? "SMS_SUBMISSION_RESULT").trim() || "SMS_SUBMISSION_RESULT";
      const status = String(payload.status ?? "UNKNOWN").trim() || "UNKNOWN";

      await client.models.SmsDeliveryEvent.create({
        smsLogId: smsLogId || undefined,
        batchId: batchId || undefined,
        phone: String(payload.phone ?? "").trim() || undefined,
        normalizedPhone: String(payload.normalised ?? "").trim() || undefined,
        eventType,
        status,
        smsType: String(payload.smsType ?? "").trim() || undefined,
        snsMessageId: String(payload.snsMessageId ?? "").trim() || undefined,
        queueMessageId: String(record.messageId ?? "").trim() || undefined,
        receiveCount,
        errorMessage: String(payload.error ?? "").trim() || undefined,
        rawPayloadJson: JSON.stringify(payload),
        createdAt: String(payload.sentAt ?? processedAt),
        processedAt,
      });

      if (smsLogId) {
        const existing = await client.models.SmsLog.get({ id: smsLogId });
        const row = (existing as any)?.data ?? existing;
        if (row?.id) {
          const currentProcessed = Number(row.queueProcessedCount ?? 0);
          const currentDeadLetters = Number(row.deadLetterCount ?? 0);
          const recipientCount = Number(row.recipientCount ?? 0);
          const nextProcessed = currentProcessed + 1;
          const nextStatus =
            currentDeadLetters > 0
              ? "DEAD_LETTER"
              : nextProcessed >= recipientCount && recipientCount > 0
                ? "TRACKED"
                : "PROCESSING";

          await client.models.SmsLog.update({
            id: row.id,
            queueProcessedCount: nextProcessed,
            status: nextStatus,
            lastEventAt: processedAt,
            lastEventType: eventType,
          });
        }
      }
    } catch (error: any) {
      const errMessage = error?.message ?? String(error);

      if (receiveCount >= DEAD_LETTER_THRESHOLD) {
        try {
          await client.models.SmsDeliveryEvent.create({
            eventType: "QUEUE_DEAD_LETTER",
            status: "DEAD_LETTER",
            queueMessageId: String(record.messageId ?? "").trim() || undefined,
            receiveCount,
            errorMessage: errMessage,
            rawPayloadJson: String(record.body ?? ""),
            createdAt: processedAt,
            processedAt,
          });
        } catch {
          // Best effort only; avoid poisoning the queue forever.
        }
        continue;
      }

      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
