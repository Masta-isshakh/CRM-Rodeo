import { defineFunction } from "@aws-amplify/backend";

export const inviteUser = defineFunction({
  name: "invite-user",
  entry: "./handler.ts",
  timeoutSeconds: 30,

  // ✅ breaks circular dependency
  resourceGroupName: "auth",
});
