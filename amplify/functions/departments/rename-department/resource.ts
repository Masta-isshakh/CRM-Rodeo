import { defineFunction } from "@aws-amplify/backend";

export const renameDepartment = defineFunction({
  name: "rename-department",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "auth",
});
