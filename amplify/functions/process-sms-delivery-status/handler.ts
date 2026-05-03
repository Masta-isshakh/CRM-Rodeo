import { gunzipSync } from "node:zlib";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { Schema } from "../../data/resource";

type SnsRecord = {
  messageId?: string;
  body?: string;
  Sns?: {
    Message?: string;
    MessageId?: string;
  };
};

type SnsEvent = {
  Records?: SnsRecord[];
  awslogs?: {
    data?: string;
  };
};

type NormalizedDeliveryMessage = {
  messageId?: string;
  destinationPhoneNumber?: string;
  messageStatus?: string;
  statusMessage?: string;
  statusCode?: string;
  priceInUSD?: string | number;
  timestamp?: string;
  rawMessage: unknown;
};

function safeParseJson(input: unknown): any {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function extractRawMessages(event: SnsEvent): Array<{ recordId: string; payload: any }> {
  const out: Array<{ recordId: string; payload: any }> = [];

  for (const record of event.Records || []) {
    const recordId = String(record.messageId || record.Sns?.MessageId || "unknown");

    if (record.Sns?.Message) {
      const parsed = safeParseJson(record.Sns.Message);
      if (parsed) out.push({ recordId, payload: parsed });
      continue;
    }

    if (record.body) {
      const body = safeParseJson(record.body);
      if (!body) continue;
      const rawMessage = body?.Type === "Notification" ? body?.Message : body?.Message ?? body;
      const parsed = safeParseJson(rawMessage) ?? rawMessage;
      if (parsed) out.push({ recordId, payload: parsed });
    }
  }

  return out;
}

function extractNotification(payload: any) {
  if (payload?.notification && typeof payload.notification === "object") return payload.notification;
  return payload;
}

function extractCloudWatchMessages(event: SnsEvent): Array<{ recordId: string; payload: any }> {
  const encoded = String(event.awslogs?.data ?? "").trim();
  if (!encoded) return [];

  try {
    const unzipped = gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
    const parsed = JSON.parse(unzipped);
    const logEvents = Array.isArray(parsed?.logEvents) ? parsed.logEvents : [];
    return logEvents
      .map((entry: any) => {
        const payload = safeParseJson(entry?.message);
        return payload ? { recordId: String(entry?.id ?? "unknown"), payload } : null;
      })
      .filter(Boolean) as Array<{ recordId: string; payload: any }>;
  } catch (error) {
    console.warn("Unable to parse CloudWatch delivery log payload", error);
    return [];
  }
}

function normalizeDeliveryMessage(payload: any): NormalizedDeliveryMessage | null {
  if (!payload || typeof payload !== "object") return null;

  if (payload.notification || payload.delivery || payload.status) {
    return {
      messageId: String(payload?.notification?.messageId ?? "").trim() || undefined,
      destinationPhoneNumber: String(payload?.delivery?.destination ?? "").trim() || undefined,
      messageStatus: String(payload?.status ?? "").trim() || undefined,
      statusMessage: String(payload?.delivery?.providerResponse ?? "").trim() || undefined,
      statusCode: undefined,
      priceInUSD: payload?.delivery?.priceInUSD,
      timestamp: String(payload?.notification?.timestamp ?? "").trim() || undefined,
      rawMessage: payload,
    };
  }

  const notification = extractNotification(payload) ?? {};
  if (!notification?.messageStatus && !notification?.destinationPhoneNumber) return null;

  return {
    messageId: String(notification?.messageId ?? "").trim() || undefined,
    destinationPhoneNumber: String(notification?.destinationPhoneNumber ?? "").trim() || undefined,
    messageStatus: String(notification?.messageStatus ?? "").trim() || undefined,
    statusMessage: String(notification?.statusMessage ?? "").trim() || undefined,
    statusCode: String(notification?.statusCode ?? "").trim() || undefined,
    priceInUSD: notification?.priceInUSD,
    timestamp: String(notification?.timestamp ?? "").trim() || undefined,
    rawMessage: payload,
  };
}

async function configureClient() {
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
}

export const handler = async (event: SnsEvent) => {
  console.log("SMS Delivery Status Event:", JSON.stringify(event, null, 2));

  const batchItemFailures: { itemIdentifier: string }[] = [];

  try {
    // Initialize Amplify
    const client = await configureClient();

    const rawMessages = event.awslogs?.data ? extractCloudWatchMessages(event) : extractRawMessages(event);

    // Handle carrier feedback messages
    for (const messageRecord of rawMessages) {
      try {
        const message = messageRecord.payload;
        console.log("Parsed Message:", message);

        const normalized = normalizeDeliveryMessage(message);
        if (!normalized) {
          console.warn("Skipping non-delivery payload", message);
          continue;
        }

        const {
          messageId,
          destinationPhoneNumber,
          messageStatus,
          statusMessage,
          statusCode,
          priceInUSD,
          timestamp,
          rawMessage,
        } = normalized;

        if (!messageStatus || !destinationPhoneNumber) {
          console.warn("Skipping non-delivery payload", message);
          continue;
        }

        // Normalize phone number
        const destinationPhone = String(destinationPhoneNumber);
        const normalizedPhone = destinationPhone.startsWith("+")
          ? destinationPhone
          : `+${destinationPhone}`;

        // Map SNS status to our status values
        const statusMap: Record<string, string> = {
          SUCCESSFUL: "DELIVERED",
          FAILED: "DELIVERY_FAILED",
          PERMANENT_FAILURE: "PERMANENT_FAILED",
          TRANSIENT_FAILURE: "TRANSIENT_FAILED",
          QUEUED: "QUEUED",
          OPTOUT: "OPT_OUT",
          SPAM: "SPAM",
          UNKNOWN: "UNKNOWN",
        };

        const status = statusMap[String(messageStatus).toUpperCase()] || String(messageStatus).toUpperCase();

        // Create delivery status record
        try {
          const deliveryMessageId = messageId ? `${messageId}` : "";
          const deliveryStatusMessage = statusMessage ? `${statusMessage}` : "";
          const deliveryStatusCode = statusCode ? `${statusCode}` : "";
          const parsedPriceInUSD = parseFloat(String(priceInUSD ?? "0"));

          await (client.models as any).SmsDeliveryStatus.create({
            snsMessageId: deliveryMessageId,
            phone: destinationPhone,
            normalizedPhone,
            status,
            statusMessage: deliveryStatusMessage,
            statusCode: deliveryStatusCode,
            priceInUSD: Number.isFinite(parsedPriceInUSD) ? parsedPriceInUSD : 0,
            rawMessageJson: JSON.stringify(rawMessage),
            createdAt: String(timestamp || new Date().toISOString()),
            processedAt: new Date().toISOString(),
          });

          console.log(
            "Created delivery status record for",
            normalizedPhone,
            "status:",
            status
          );

          if (messageId) {
            try {
              const linkedEvents = await (client.models as any).SmsDeliveryEvent.list({
                filter: { snsMessageId: { eq: String(messageId) } },
                limit: 100,
              });

              const linkedLogIds = new Set<string>();

              for (const linked of (linkedEvents?.data ?? []) as any[]) {
                if (!linked?.id) continue;
                if (linked?.smsLogId) linkedLogIds.add(String(linked.smsLogId));
                await (client.models as any).SmsDeliveryEvent.update({
                  id: linked.id,
                  status,
                  eventType: "SMS_DELIVERY_STATUS",
                  processedAt: new Date().toISOString(),
                  errorMessage: statusMessage || linked.errorMessage || undefined,
                });
              }

              for (const smsLogId of linkedLogIds) {
                try {
                  const existing = await (client.models as any).SmsLog.get({ id: smsLogId });
                  const row = (existing as any)?.data ?? existing;
                  if (!row?.id) continue;

                  await (client.models as any).SmsLog.update({
                    id: row.id,
                    status: status === "DELIVERED" ? "TRACKED" : row.status || "TRACKED",
                    lastEventAt: new Date().toISOString(),
                    lastEventType: "SMS_DELIVERY_STATUS",
                  });
                } catch (logErr) {
                  console.warn("Unable to update SmsLog for delivery feedback", logErr);
                }
              }
            } catch (linkErr) {
              console.warn("Unable to update linked SmsDeliveryEvent rows", linkErr);
            }
          }
        } catch (creationError) {
          console.error("Error creating delivery status record:", creationError);
          // Continue processing other records
        }
      } catch (recordError) {
        console.error("Error processing record:", recordError);
        // Add to failed items only if it's a persistent error
        const receiveCount = Number(1);
        const maxRetries = parseInt(
          process.env.SMS_DELIVERY_STATUS_MAX_RECEIVE_COUNT || "5",
          10
        );

        if (receiveCount >= maxRetries) {
          console.warn(
            `Record exceeded max retries (${receiveCount}), creating dead-letter entry`
          );
          // Create a dead-letter record
          try {
            await (client.models as any).SmsDeliveryStatus.create({
              status: "DEAD_LETTER",
              statusMessage: `Failed after ${receiveCount} attempts: ${
                recordError instanceof Error ? recordError.message : "Unknown error"
              }`,
              rawMessageJson: JSON.stringify(event.Records?.[0]?.Sns || {}),
              createdAt: new Date().toISOString(),
              processedAt: new Date().toISOString(),
            });
          } catch (dlError) {
            console.error("Error creating dead-letter record:", dlError);
          }
        } else {
          // Retry this message
          batchItemFailures.push({
            itemIdentifier: messageRecord.recordId || "unknown",
          });
        }
      }
    }

    console.log("Processing completed. Failed items:", batchItemFailures);
    return { batchItemFailures };
  } catch (error) {
    console.error("Fatal error in handler:", error);
    // Return all records as failed for retry
    return {
      batchItemFailures: (event.Records || []).map((record: any) => ({
        itemIdentifier: record.messageId || record.Sns?.MessageId || "unknown",
      })),
    };
  }
};
