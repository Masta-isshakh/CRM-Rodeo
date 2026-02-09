import { defineFunction } from "@aws-amplify/backend";

export const jobOrderDelete = defineFunction({
  name: "job-order-delete",
  entry: "./handler.ts",
  timeoutSeconds: 30,
});
