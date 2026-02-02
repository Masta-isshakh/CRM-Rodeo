// amplify/auth/custom-message/resource.ts
import { defineFunction } from "@aws-amplify/backend";

export const customMessage = defineFunction({
  name: "custom-message",
  entry: "./handler.ts",

  // put trigger lambda in auth stack
  resourceGroupName: "auth",

  environment: {
    APP_ORIGIN: "https://main.d1vjb07p2rami9.amplifyapp.com",
  },
});
