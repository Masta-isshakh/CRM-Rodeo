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

const ALLOWED_ROLES = new Set(["ADMIN", "SALES", "SUPPORT", "SALES_MANAGER"]);

type AllowedRole = "ADMIN" | "SALES" | "SUPPORT" | "SALES_MANAGER";

function getAttr(
  attrs: { Name?: string; Value?: string }[] | undefined,
  name: string
) {
  const found = (attrs ?? []).find((a) => a.Name === name);
  return found?.Value;
}

export const handler: Handler = async (event) => {
  const { email, fullName, role } = event.arguments;

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedName = fullName.trim();

  if (!normalizedEmail || !normalizedName) {
    throw new Error("Email and fullName are required.");
  }

  if (!role || !ALLOWED_ROLES.has(role)) {
    throw new Error(
      `Invalid role. Allowed roles: ADMIN, SALES, SUPPORT, SALES_MANAGER`
    );
  }

const validatedRole = role as "ADMIN" | "SALES" | "SALES_MANAGER" | "SUPPORT";


  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) {
    throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID env var.");
  }

  // 1) Create Cognito user (Cognito sends invite email)
  const createRes = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: normalizedEmail,
      UserAttributes: [
        { Name: "email", Value: normalizedEmail },
        { Name: "email_verified", Value: "true" },
      ],
      DesiredDeliveryMediums: ["EMAIL"],
    })
  );

  // 2) Add user to group
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: normalizedEmail,
      GroupName: validatedRole,
    })
  );

  // 3) Resolve sub
  let sub = getAttr(createRes.User?.Attributes, "sub");

  if (!sub) {
    const getUserRes = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: normalizedEmail,
      })
    );
    sub = getAttr(getUserRes.UserAttributes, "sub");
  }

  if (!sub) {
    throw new Error("Could not resolve user 'sub' after creating user.");
  }

  // 4) Write UserProfile
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(
    process.env as any
  );
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const profileOwner = `${sub}::${normalizedEmail}`;

  const existing = await dataClient.models.UserProfile.list({
    filter: { email: { eq: normalizedEmail } },
    limit: 1,
  });

  if (existing.data.length > 0 && existing.data[0]?.id) {
    await dataClient.models.UserProfile.update({
      id: existing.data[0].id,
      email: normalizedEmail,
      fullName: normalizedName,
      role: validatedRole,
      isActive: true,
      profileOwner,
      createdAt: existing.data[0].createdAt ?? new Date().toISOString(),
    });
  } else {
    await dataClient.models.UserProfile.create({
      email: normalizedEmail,
      fullName: normalizedName,
      role: validatedRole,
      isActive: true,
      profileOwner,
      createdAt: new Date().toISOString(),
    });
  }

  // Optional: include a direct app URL you can show in UI logs
  const appBaseUrl = process.env.APP_BASE_URL || ""; // set if you want
  const inviteLink = appBaseUrl
    ? `${appBaseUrl.replace(/\/$/, "")}/set-password?email=${encodeURIComponent(
        normalizedEmail
      )}`
    : "";

  return {
    ok: true,
    invitedEmail: normalizedEmail,
    role: validatedRole,
    sub,
    inviteLink,
  };
};
