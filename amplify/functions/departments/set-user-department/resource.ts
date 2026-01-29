import { defineFunction } from "@aws-amplify/backend";

export const setUserDepartment = defineFunction({
  name: "set-user-department",
  entry: "./handler.ts",
  resourceGroupName: "auth",
});
