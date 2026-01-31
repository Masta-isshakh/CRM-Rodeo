// amplify/functions/auth/my-groups/resource.ts
import { defineFunction } from "@aws-amplify/backend";

export const myGroups = defineFunction({
  name: "my-groups",
  entry: "./handler.ts",
});
