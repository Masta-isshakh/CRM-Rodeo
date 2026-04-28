import { defineFunction } from "@aws-amplify/backend";

export const sendSms = defineFunction({
  name: "send-sms",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 60,
  environment: {
    SMS_REGION: "ap-south-1",
    SMS_AUDIT_TOPIC_ARN: "arn:aws:sns:ap-south-1:115246381405:Rodeo_Drive_Topic.fifo",
    // Default country code prefix for Qatar numbers that don't start with +
    DEFAULT_COUNTRY_CODE: "+974",
  },
});
