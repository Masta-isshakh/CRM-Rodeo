// src/lib/amplifyClient.ts
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

let _client: ReturnType<typeof generateClient<Schema>> | null = null;

export function getDataClient() {
  if (!_client) _client = generateClient<Schema>();
  return _client;
}
