import { defineFunction } from "@aws-amplify/backend";

export const setUserActive = defineFunction({
  name: "set-user-active",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "auth",
});
