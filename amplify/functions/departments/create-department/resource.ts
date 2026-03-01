import { defineFunction } from "@aws-amplify/backend";

export const createDepartment = defineFunction({
  name: "create-department",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "auth",
});
