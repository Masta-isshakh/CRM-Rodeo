// amplify/functions/send-sms/handler.ts
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE ?? "+974";
const REGION = process.env.SMS_REGION ?? "ap-south-1";
const AUDIT_TOPIC_ARN = process.env.SMS_AUDIT_TOPIC_ARN ?? "";
const IS_FIFO_AUDIT_TOPIC = AUDIT_TOPIC_ARN.endsWith(".fifo");
const MAX_RECIPIENTS_PER_BATCH = Number(process.env.MAX_SMS_RECIPIENTS_PER_BATCH ?? "250");
const SMS_SENDER_ID = String(process.env.SMS_SENDER_ID ?? "").trim();

const sns = new SNSClient({ region: REGION });

/**
 * Normalise a raw phone number to E.164.
 * Rules (Qatar default):
 *   +974XXXXXXXX  →  kept as-is
 *   00974XXXXXXX  →  +974XXXXXXXX
 *   XXXXXXXX      →  +974XXXXXXXX  (8-digit Qatar mobile)
 * Strips spaces, dashes, parentheses.
 */
function toE164(raw: string, defaultCC = DEFAULT_CC): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (!cleaned) return null;
  if (/^\+\d{7,15}$/.test(cleaned)) return cleaned;
  if (/^00\d{7,14}$/.test(cleaned)) return `+${cleaned.slice(2)}`;

  const defaultDigits = defaultCC.replace(/^\+/, "");

  if (new RegExp(`^${defaultDigits}\\d{6,12}$`).test(cleaned)) {
    return `+${cleaned}`;
  }

  if (/^0\d{7,12}$/.test(cleaned)) {
    const withoutTrunkPrefix = cleaned.replace(/^0+/, "");
    if (!withoutTrunkPrefix) return null;
    if (new RegExp(`^${defaultDigits}\\d{6,12}$`).test(withoutTrunkPrefix)) {
      return `+${withoutTrunkPrefix}`;
    }
    if (/^\d{7,12}$/.test(withoutTrunkPrefix)) {
      return `${defaultCC}${withoutTrunkPrefix}`;
    }
  }

  if (/^\d{7,12}$/.test(cleaned)) return `${defaultCC}${cleaned}`;
  return null; // unrecognised — skip
}

export const handler = async (event: any): Promise<any> => {
  const args = event?.arguments ?? {};
  const rawPhonesInput: string[] = Array.isArray(args.phones) ? args.phones : [];
  const rawPhones: string[] = Array.from(new Set(rawPhonesInput.map((p) => String(p ?? "").trim()).filter(Boolean)));
  const message = String(args.message ?? "").trim();
  const smsType: string = String(args.smsType ?? "Transactional"); // Transactional | Promotional
  const batchId = String(args.batchId ?? "").trim();
  const smsLogId = String(args.smsLogId ?? "").trim();

  if (!message) return { ok: false, error: "Message is required.", results: [] };
  if (!rawPhones.length) return { ok: false, error: "No phone numbers provided.", results: [] };
  if (rawPhones.length > MAX_RECIPIENTS_PER_BATCH) {
    return {
      ok: false,
      error: `Batch limit exceeded: max ${MAX_RECIPIENTS_PER_BATCH} recipients per request`,
      results: rawPhones.map((phone) => ({
        phone,
        normalised: null,
        status: "SKIPPED",
        error: `Batch limit exceeded (${MAX_RECIPIENTS_PER_BATCH})`,
      })),
      sentCount: 0,
      failedCount: rawPhones.length,
    };
  }

  const results: {
    phone: string;
    normalised: string | null;
    status: string;
    messageId?: string;
    error?: string;
    fanoutPublished?: boolean;
    fanoutError?: string;
  }[] = [];

  for (const raw of rawPhones) {
    const normalised = toE164(String(raw ?? "").trim());
    const sentAt = new Date().toISOString();

    const publishAuditEvent = async (payload: Record<string, unknown>) => {
      if (!AUDIT_TOPIC_ARN) return;
      const publishInput: any = {
        TopicArn: AUDIT_TOPIC_ARN,
        Message: JSON.stringify(payload),
      };
      if (IS_FIFO_AUDIT_TOPIC) {
        publishInput.MessageGroupId = `sms-${smsLogId || batchId || "default"}`;
        publishInput.MessageDeduplicationId = `${batchId || "no-batch"}:${String(payload.phone ?? raw)}:${String(payload.status ?? "UNKNOWN")}:${sentAt}`;
      }
      await sns.send(
        new PublishCommand(publishInput)
      );
    };

    if (!normalised) {
      const item = { phone: raw, normalised: null, status: "SKIPPED", error: "Could not normalise to E.164" };
      try {
        await publishAuditEvent({
          schemaVersion: 1,
          eventType: "SMS_SUBMISSION_RESULT",
          batchId,
          smsLogId,
          phone: raw,
          normalised: null,
          normalizedPhone: null,
          status: item.status,
          smsType,
          error: item.error,
          sentAt,
          topicPublishedAt: new Date().toISOString(),
        });
        results.push({ ...item, fanoutPublished: true });
      } catch (fanoutErr: any) {
        results.push({ ...item, fanoutPublished: false, fanoutError: fanoutErr?.message ?? String(fanoutErr) });
      }
      continue;
    }

    try {
      const messageAttributes: Record<string, { DataType: string; StringValue: string }> = {
        "AWS.SNS.SMS.SMSType": {
          DataType: "String",
          StringValue: smsType,
        },
      };
      if (SMS_SENDER_ID) {
        messageAttributes["AWS.SNS.SMS.SenderID"] = {
          DataType: "String",
          StringValue: SMS_SENDER_ID,
        };
      }

      const cmd = new PublishCommand({
        PhoneNumber: normalised,
        Message: message,
        MessageAttributes: messageAttributes,
      });
      const resp = await sns.send(cmd);
      const item = { phone: raw, normalised, status: "SENT", messageId: resp.MessageId };
      try {
        await publishAuditEvent({
          schemaVersion: 1,
          eventType: "SMS_SUBMISSION_RESULT",
          batchId,
          smsLogId,
          phone: raw,
          normalised,
          normalizedPhone: normalised,
          status: item.status,
          smsType,
          snsMessageId: resp.MessageId,
          sentAt,
          topicPublishedAt: new Date().toISOString(),
        });
        results.push({ ...item, fanoutPublished: true });
      } catch (fanoutErr: any) {
        results.push({ ...item, fanoutPublished: false, fanoutError: fanoutErr?.message ?? String(fanoutErr) });
      }
    } catch (err: any) {
      const item = { phone: raw, normalised, status: "FAILED", error: err?.message ?? String(err) };
      try {
        await publishAuditEvent({
          schemaVersion: 1,
          eventType: "SMS_SUBMISSION_RESULT",
          batchId,
          smsLogId,
          phone: raw,
          normalised,
          normalizedPhone: normalised,
          status: item.status,
          smsType,
          error: item.error,
          sentAt,
          topicPublishedAt: new Date().toISOString(),
        });
        results.push({ ...item, fanoutPublished: true });
      } catch (fanoutErr: any) {
        results.push({ ...item, fanoutPublished: false, fanoutError: fanoutErr?.message ?? String(fanoutErr) });
      }
    }
  }

  const sentCount = results.filter((r) => r.status === "SENT").length;
  const failedCount = results.filter((r) => r.status === "FAILED").length;

  return {
    ok: failedCount === 0,
    sentCount,
    failedCount,
    results,
  };
};
