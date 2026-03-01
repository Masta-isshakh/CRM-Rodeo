// amplify/auth/custom-message/resource.ts
import { defineFunction } from "@aws-amplify/backend";

export const customMessage = defineFunction({
  name: "custom-message",
  entry: "./handler.ts",
  runtime: 20,

  // put trigger lambda in auth stack
  resourceGroupName: "auth",

  environment: {
    APP_ORIGIN: "https://main.d2plnbwjgshmb2.amplifyapp.com",
  },
});
