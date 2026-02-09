import { defineFunction } from "@aws-amplify/backend";

export const jobOrderSave = defineFunction({
  name: "job-order-save",
  entry: "./handler.ts",
  timeoutSeconds: 30,
});
