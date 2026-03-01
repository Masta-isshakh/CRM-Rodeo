import { defineFunction } from "@aws-amplify/backend";

export const listDepartments = defineFunction({
  name: "list-departments",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
  resourceGroupName: "auth",
});
