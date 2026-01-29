import { defineFunction } from "@aws-amplify/backend";

export const renameDepartment = defineFunction({
  name: "rename-department",
  entry: "./handler.ts",
  resourceGroupName: "auth",
});
