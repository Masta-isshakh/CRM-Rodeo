import { defineFunction } from "@aws-amplify/backend";

export const setUserDepartment = defineFunction({
  name: "set-user-department",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "auth",
});
