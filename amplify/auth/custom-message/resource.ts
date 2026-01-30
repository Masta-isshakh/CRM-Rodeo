// amplify/auth/custom-message/resource.ts
import { defineFunction } from "@aws-amplify/backend";

export const customMessage = defineFunction({
  name: "custom-message",
  entry: "./handler.ts",

  // ✅ put trigger lambda in auth stack
  resourceGroupName: "auth",

  environment: {
    APP_ORIGIN: "https://main.d306x3a8sfnpva.amplifyapp.com",
  },
});
