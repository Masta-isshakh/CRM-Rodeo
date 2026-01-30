import { defineFunction } from "@aws-amplify/backend";

export const deleteDepartment = defineFunction({
  name: "delete-department",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "auth",
});
