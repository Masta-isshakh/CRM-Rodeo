import { defineFunction } from "@aws-amplify/backend";

export const customMessage = defineFunction({
  name: "custom-message-lambda",
  entry: "./handler.ts",
  environment: {
    // IMPORTANT: change this to your production domain (or your Amplify domain)
    // Example:
    // APP_ORIGIN: "https://main.d1r231trq47ahc.amplifyapp.com"
    APP_ORIGIN: "https://main.d306x3a8sfnpva.amplifyapp.com",
  },
});
