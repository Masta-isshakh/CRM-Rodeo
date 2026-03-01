import { defineFunction } from "@aws-amplify/backend";

export const jobOrderPaymentCreate = defineFunction({
  name: "jobOrderPaymentCreate",
  entry: "./handler.ts",
  runtime: 20,
});
