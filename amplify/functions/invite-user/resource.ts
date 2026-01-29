import { defineFunction } from "@aws-amplify/backend";

export const inviteUser = defineFunction({
  name: "invite-user",
  entry: "./handler.ts",
  resourceGroupName: "auth",
});
