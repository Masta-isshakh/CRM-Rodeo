import { defineFunction } from "@aws-amplify/backend";

export const jobOrderPaymentDelete = defineFunction({
  name: "jobOrderPaymentDelete",
  entry: "./handler.ts",
});
