import { defineFunction } from "@aws-amplify/backend";

export const processScheduledReports = defineFunction({
  name: "process-scheduled-reports",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 120,
  environment: {
    SES_REGION: "eu-west-1",
    SES_FROM_EMAIL: "",
    REPORT_MAX_ROWS: "3000",
  },
});
