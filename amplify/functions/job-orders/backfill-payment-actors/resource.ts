import { defineFunction } from "@aws-amplify/backend";

export const jobOrderPaymentBackfillActors = defineFunction({
  name: "jobOrderPaymentBackfillActors",
  entry: "./handler.ts",
  runtime: 20,
});
