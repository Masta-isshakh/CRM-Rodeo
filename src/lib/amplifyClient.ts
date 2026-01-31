// src/lib/amplifyClient.ts
import "../amplifyConfig"; // ensure configured even if imported elsewhere
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

let _client: ReturnType<typeof generateClient<Schema>> | null = null;

export function getDataClient() {
  if (!_client) {
    // Force userPool auth mode for admin pages & group auth
    _client = generateClient<Schema>({ authMode: "userPool" });
  }
  return _client;
}
