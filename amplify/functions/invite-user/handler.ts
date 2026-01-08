import type { Schema } from "../../data/resource";

import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = Schema["inviteUser"]["functionHandler"];

const cognito = new CognitoIdentityProviderClient();

const ALLOWED_ROLES = new Set(["ADMIN", "SALES", "SUPPORT"]);

function getAttr(attrs: { Name?: string; Value?: string }[] | undefined, name: string) {
  const found = (attrs ?? []).find((a) => a.Name === name);
  return found?.Value;
}

export const handler: Handler = async (event) => {
  const { email, fullName, role } = event.arguments;

  if (!ALLOWED_ROLES.has(role)) {
    throw new Error(`Invalid role. Allowed roles: ADMIN, SALES, SUPPORT`);
  }

  // Type assertion after validation
  const validatedRole = role as "ADMIN" | "SALES" | "SUPPORT";

  // 1) Create Cognito user (invite email is sent by Cognito)
  const createRes = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: process.env.AMPLIFY_AUTH_USERPOOL_ID,
      Username: email, // simplest: username == email
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        // Optional: if you later add custom attributes, set them here
      ],
      DesiredDeliveryMediums: ["EMAIL"],
      // Optional: if you want to suppress Cognito email and send your own:
      // MessageAction: "SUPPRESS",
      // TemporaryPassword: "SomeTempPass#123", // optional; Cognito can generate if omitted
    })
  );

  // 2) Add user to group (role)
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: process.env.AMPLIFY_AUTH_USERPOOL_ID,
      Username: email,
      GroupName: validatedRole,
    })
  );

  // 3) Get "sub" so we can set correct owner string for UserProfile
  // Sometimes AdminCreateUser returns attrs including sub; sometimes not.
  let sub = getAttr(createRes.User?.Attributes, "sub");

  if (!sub) {
    const getUserRes = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: process.env.AMPLIFY_AUTH_USERPOOL_ID,
        Username: email,
      })
    );
    sub = getAttr(getUserRes.UserAttributes, "sub");
  }

  if (!sub) {
    throw new Error("Could not resolve user 'sub' attribute after creating user.");
  }

  // 4) Write UserProfile record in Amplify Data
  // Configure Amplify client inside the function using recommended config helper
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const profileOwner = `${sub}::${email}`;

  // Create profile (idempotent-ish for small org: update if found)
  const existing = await dataClient.models.UserProfile.list({
    filter: { email: { eq: email } },
    limit: 1,
  });

  if (existing.data.length > 0) {
    await dataClient.models.UserProfile.update({
      id: existing.data[0].id,
      email,
      fullName,
      role: validatedRole,
      isActive: true,
      profileOwner,
      createdAt: existing.data[0].createdAt ?? new Date().toISOString(),
    });
  } else {
    await dataClient.models.UserProfile.create({
      email,
      fullName,
      role: validatedRole,
      isActive: true,
      profileOwner,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    ok: true,
    invitedEmail: email,
    role: validatedRole,
    sub,
  };
};
