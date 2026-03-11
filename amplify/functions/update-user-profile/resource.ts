import { defineFunction } from "@aws-amplify/backend";

export const updateUserProfile = defineFunction({
  name: "update-user-profile",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "auth",
});
