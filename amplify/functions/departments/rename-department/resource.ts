import { defineFunction } from "@aws-amplify/backend";

export const renameDepartment = defineFunction({
  name: "rename-department",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "auth",
});
