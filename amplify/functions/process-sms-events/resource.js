import { defineFunction } from "@aws-amplify/backend";
export const processSmsEvents = defineFunction({
    name: "process-sms-events",
    entry: "./handler.ts",
    runtime: 20,
    timeoutSeconds: 30,
    environment: {
        SMS_EVENT_MAX_RECEIVE_COUNT: "3",
    },
});
