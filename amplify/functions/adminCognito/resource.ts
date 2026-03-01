// amplify/functions/adminCognito/resource.ts
import { defineFunction } from "@aws-amplify/backend";

export const adminCognito = defineFunction({
  name: "adminCognito",
  entry: "./handler.ts",
  runtime: 20,
  timeoutSeconds: 30,
});
