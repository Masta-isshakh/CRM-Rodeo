import { defineFunction } from "@aws-amplify/backend";

export const driveRetentionCleanup = defineFunction({
  name: "drive-retention-cleanup",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 60,
  environment: {
    DRIVE_TRASH_RETENTION_DAYS: "30",
    DRIVE_LINK_RETENTION_DAYS: "15",
  },
});
