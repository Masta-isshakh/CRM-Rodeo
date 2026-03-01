import { defineFunction } from "@aws-amplify/backend";

export const deleteUser = defineFunction({
  name: "delete-user",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "auth",
});
