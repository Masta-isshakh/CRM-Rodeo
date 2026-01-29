import { defineFunction } from "@aws-amplify/backend";

export const listDepartments = defineFunction({
  name: "list-departments",
  entry: "./handler.ts",
  resourceGroupName: "auth",
});
