import { defineFunction } from "@aws-amplify/backend";

export const jobOrderPaymentUpdate = defineFunction({
  name: "jobOrderPaymentUpdate",
  entry: "./handler.ts",
  runtime: 20,
});
