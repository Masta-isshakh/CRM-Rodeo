import { defineFunction } from "@aws-amplify/backend";

export const sendSms = defineFunction({
  name: "send-sms",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 60,
  environment: {
    SMS_REGION: "ap-south-1",
    // Default country code prefix for Qatar numbers that don't start with +
    DEFAULT_COUNTRY_CODE: "+974",
  },
});
