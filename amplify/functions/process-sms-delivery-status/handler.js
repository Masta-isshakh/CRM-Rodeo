import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
async function configureClient() {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env);
    Amplify.configure(resourceConfig, libraryOptions);
    return generateClient();
}
export const handler = async (event) => {
    console.log("SMS Delivery Status Event:", JSON.stringify(event, null, 2));
    const batchItemFailures = [];
    try {
        // Initialize Amplify
        const client = await configureClient();
        // Handle SNS events
        for (const record of event.Records || []) {
            try {
                // Parse SNS message
                const snsMessage = String(record.Sns?.Message ?? "{}");
                const message = JSON.parse(snsMessage);
                console.log("Parsed Message:", message);
                // Extract delivery status information
                const { notification: { messageId, destinationPhoneNumber, messageStatus, statusMessage, statusCode, priceInUSD, timestamp, } = {}, } = message;
                if (!messageStatus || !destinationPhoneNumber) {
                    console.warn("Invalid delivery status format", message);
                    continue;
                }
                // Normalize phone number
                const normalizedPhone = destinationPhoneNumber.startsWith("+")
                    ? destinationPhoneNumber
                    : `+${destinationPhoneNumber}`;
                // Map SNS status to our status values
                const statusMap = {
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
                    await client.models.SmsDeliveryStatus.create({
                        snsMessageId: messageId,
                        phone: destinationPhoneNumber,
                        normalizedPhone,
                        status,
                        statusMessage: statusMessage || "",
                        statusCode: statusCode || "",
                        priceInUSD: priceInUSD ? parseFloat(priceInUSD) : 0,
                        rawMessageJson: JSON.stringify(message),
                        createdAt: String(timestamp || new Date().toISOString()),
                        processedAt: new Date().toISOString(),
                    });
                    console.log("Created delivery status record for", normalizedPhone, "status:", status);
                }
                catch (creationError) {
                    console.error("Error creating delivery status record:", creationError);
                    // Continue processing other records
                }
            }
            catch (recordError) {
                console.error("Error processing record:", recordError);
                // Add to failed items only if it's a persistent error
                const receiveCount = Number(1);
                const maxRetries = parseInt(process.env.SMS_DELIVERY_STATUS_MAX_RECEIVE_COUNT || "5", 10);
                if (receiveCount >= maxRetries) {
                    console.warn(`Record exceeded max retries (${receiveCount}), creating dead-letter entry`);
                    // Create a dead-letter record
                    try {
                        await client.models.SmsDeliveryStatus.create({
                            status: "DEAD_LETTER",
                            statusMessage: `Failed after ${receiveCount} attempts: ${recordError instanceof Error ? recordError.message : "Unknown error"}`,
                            rawMessageJson: JSON.stringify(event.Records?.[0]?.Sns || {}),
                            createdAt: new Date().toISOString(),
                            processedAt: new Date().toISOString(),
                        });
                    }
                    catch (dlError) {
                        console.error("Error creating dead-letter record:", dlError);
                    }
                }
                else {
                    // Retry this message
                    batchItemFailures.push({
                        itemId: record.messageId || record.Sns?.MessageId || "unknown",
                    });
                }
            }
        }
        console.log("Processing completed. Failed items:", batchItemFailures);
        return { batchItemFailures };
    }
    catch (error) {
        console.error("Fatal error in handler:", error);
        // Return all records as failed for retry
        return {
            batchItemFailures: (event.Records || []).map((record) => ({
                itemId: record.messageId || record.Sns?.MessageId || "unknown",
            })),
        };
    }
};
