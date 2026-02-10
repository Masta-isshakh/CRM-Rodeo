import { defineFunction } from "@aws-amplify/backend";

export const jobOrderDelete = defineFunction({
  name: "jobOrderDelete",
  entry: "./handler.ts",
});
