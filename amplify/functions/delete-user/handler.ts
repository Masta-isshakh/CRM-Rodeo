import type { Schema } from "../../data/resource";

import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

// TODO: Replace 'adminDeleteUser' with the correct property name from your Schema type
// For example, if your schema has 'deleteUser', use:
// type Handler = Schema["deleteUser"]["functionHandler"];
type Handler = any; // Temporary fix: use 'any' until the correct type is known

const cognito = new CognitoIdentityProviderClient();

export const handler: Handler = async (event: any) => {
  const { email } = event.arguments;

  const e = email.trim().toLowerCase();
  if (!e) throw new Error("Email is required.");

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID env var.");

  // 1) Delete from Cognito
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: e }));

  // 2) Delete Customer from Data
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const customers = await dataClient.models.Customer.list({
    filter: { email: { eq: e } },
    limit: 10,
  });

  for (const c of customers.data) {
    await dataClient.models.Customer.delete({ id: c.id });
  }

  return {
    ok: true,
    email: e,
    deletedProfiles: customers.data.length,
  };
};
