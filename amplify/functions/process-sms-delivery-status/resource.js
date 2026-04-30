import { defineFunction } from "@aws-amplify/backend";
export const processSmsDeliveryStatus = defineFunction({
    name: "process-sms-delivery-status",
    entry: "./handler.ts",
    runtime: 20,
    timeoutSeconds: 30,
    environment: {
        SMS_DELIVERY_STATUS_MAX_RECEIVE_COUNT: "5",
    },
});
