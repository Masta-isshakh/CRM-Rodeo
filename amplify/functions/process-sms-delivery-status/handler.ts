import {
  AppSyncIdentityWithSourceIp,
  Amplify,
  generateClient,
  defineAuth,
} from "aws-amplify";
import { Schema } from "../../data/resource";
import { getAmplifyDataClientConfig, selectVal } from "../../data/client-utils";

export const handler = async (event: any) => {
  console.log("SMS Delivery Status Event:", JSON.stringify(event, null, 2));

  const batchItemFailures: { itemId: string }[] = [];

  try {
    // Initialize Amplify
    const config = await getAmplifyDataClientConfig(process.env);
    Amplify.configure(config);
    const client = generateClient<Schema>();

    // Handle SNS events
    for (const record of event.Records || []) {
      try {
        // Parse SNS message
        const message = JSON.parse(record.Sns.Message);
        console.log("Parsed Message:", message);

        // Extract delivery status information
        const {
          notification: {
            messageId,
            destinationPhoneNumber,
            messageStatus,
            statusMessage,
            statusCode,
            priceInUSD,
            timestamp,
          } = {},
        } = message;

        if (!messageStatus || !destinationPhoneNumber) {
          console.warn("Invalid delivery status format", message);
          continue;
        }

        // Normalize phone number
        const normalizedPhone = destinationPhoneNumber.startsWith("+")
          ? destinationPhoneNumber
          : `+${destinationPhoneNumber}`;

        // Map SNS status to our status values
        const statusMap: Record<string, string> = {
          Successful: "DELIVERED",
          Failed: "DELIVERY_FAILED",
          Permanent_Failure: "PERMANENT_FAILED",
          Transient_Failure: "TRANSIENT_FAILED",
          Queued: "QUEUED",
          OptOut: "OPT_OUT",
          Spam: "SPAM",
          Unknown: "UNKNOWN",
        };

        const status = statusMap[messageStatus] || messageStatus;

        // Create delivery status record
        try {
          await (client.models as any).SmsDeliveryStatus.create({
            snsMessageId: messageId,
            phone: destinationPhoneNumber,
            normalizedPhone,
            status,
            statusMessage: statusMessage || "",
            statusCode: statusCode || "",
            priceInUSD: priceInUSD ? parseFloat(priceInUSD) : 0,
            rawMessageJson: JSON.stringify(message),
            processedAt: new Date().toISOString(),
          });

          console.log(
            "Created delivery status record for",
            normalizedPhone,
            "status:",
            status
          );
        } catch (creationError) {
          console.error("Error creating delivery status record:", creationError);
          // Continue processing other records
        }
      } catch (recordError) {
        console.error("Error processing record:", recordError);
        // Add to failed items only if it's a persistent error
        const receiveCount = record.Attributes?.ApproximateReceiveCount || 0;
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
              rawMessageJson: JSON.stringify(event.Records[0]?.Sns || {}),
              processedAt: new Date().toISOString(),
            });
          } catch (dlError) {
            console.error("Error creating dead-letter record:", dlError);
          }
        } else {
          // Retry this message
          batchItemFailures.push({
            itemId: record.messageId || record.Sns.MessageId,
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
        itemId: record.messageId || record.Sns.MessageId,
      })),
    };
  }
};
