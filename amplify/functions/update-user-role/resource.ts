import { defineFunction } from "@aws-amplify/backend";

export const updateUserRole = defineFunction({
  name: "update-user-role",
  entry: "./handler.ts",
  resourceGroupName: "auth",
});
