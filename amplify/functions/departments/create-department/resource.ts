import { defineFunction } from "@aws-amplify/backend";

export const createDepartment = defineFunction({
  name: "create-department",
  entry: "./handler.ts",
  resourceGroupName: "auth",
});
