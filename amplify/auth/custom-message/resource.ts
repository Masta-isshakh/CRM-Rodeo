import { defineFunction } from "@aws-amplify/backend";

export const customMessage = defineFunction({
  name: "custom-message",
  entry: "./handler.ts",
  environment: {
    // Use your PROD domain here OR localhost for sandbox testing
    // Example local:
    // APP_ORIGIN: "http://localhost:5173",
    APP_ORIGIN: "https://main.d306x3a8sfnpva.amplifyapp.com",
  },
});
