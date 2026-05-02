// amplify/functions/send-sms/handler.ts
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE ?? "+974";
const REGION = process.env.SMS_REGION ?? "ap-south-1";
const AUDIT_TOPIC_ARN = process.env.SMS_AUDIT_TOPIC_ARN ?? "";
const IS_FIFO_AUDIT_TOPIC = AUDIT_TOPIC_ARN.endsWith(".fifo");

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
  if (/^\+\d{7,15}$/.test(cleaned)) return cleaned; // already E.164
  if (/^00\d{7,14}$/.test(cleaned)) return `+${cleaned.slice(2)}`; // 00 prefix
  if (/^\d{7,12}$/.test(cleaned)) return `${defaultCC}${cleaned}`;
  return null; // unrecognised — skip
}

export const handler = async (event: any): Promise<any> => {
  const args = event?.arguments ?? {};
  const rawPhones: string[] = Array.isArray(args.phones) ? args.phones : [];
  const message = String(args.message ?? "").trim();
  const smsType: string = String(args.smsType ?? "Transactional"); // Transactional | Promotional
  const batchId = String(args.batchId ?? "").trim();
  const smsLogId = String(args.smsLogId ?? "").trim();

  if (!message) return { ok: false, error: "Message is required.", results: [] };
  if (!rawPhones.length) return { ok: false, error: "No phone numbers provided.", results: [] };

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
      const cmd = new PublishCommand({
        PhoneNumber: normalised,
        Message: message,
        MessageAttributes: {
          "AWS.SNS.SMS.SMSType": {
            DataType: "String",
            StringValue: smsType,
          },
          "AWS.SNS.SMS.SenderID": {
            DataType: "String",
            StringValue: "CRMRODEO",
          },
        },
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
