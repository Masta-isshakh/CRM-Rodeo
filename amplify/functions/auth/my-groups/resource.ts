import { defineFunction } from "@aws-amplify/backend";

export const myGroups = defineFunction({
  name: "my-groups",
  entry: "./handler.ts",
  timeoutSeconds: 10,

  // keep it in the auth stack like your other Cognito admin functions
  resourceGroupName: "auth",
});
