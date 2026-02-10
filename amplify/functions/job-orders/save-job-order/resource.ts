import { defineFunction } from "@aws-amplify/backend";

export const jobOrderSave = defineFunction({
  name: "jobOrderSave",
  entry: "./handler.ts",
});
