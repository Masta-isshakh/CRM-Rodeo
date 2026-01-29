import type { Schema } from "../../data/resource";

import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  GetGroupCommand,
  CreateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { DEPT_PREFIX, keyToLabel } from "../departments/_shared/departmentKey";

type Handler = Schema["inviteUser"]["functionHandler"];

const cognito = new CognitoIdentityProviderClient();

function getAttr(attrs: { Name?: string; Value?: string }[] | undefined, name: string) {
  return (attrs ?? []).find((a) => a.Name === name)?.Value;
}

async function ensureGroup(userPoolId: string, groupName: string, description: string) {
  try {
    await cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: groupName }));
    return;
  } catch (e: any) {
    if (e?.name !== "ResourceNotFoundException") throw e;
  }
  await cognito.send(
    new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: groupName, Description: description })
  );
}

export const handler: Handler = async (event) => {
  const email = event.arguments.email.trim().toLowerCase();
  const fullName = event.arguments.fullName.trim();
  const departmentKey = event.arguments.departmentKey.trim();
  const departmentNameFromArgs = (event.arguments.departmentName ?? "").trim();

  if (!email || !fullName) throw new Error("email and fullName are required.");
  if (!departmentKey.startsWith(DEPT_PREFIX)) {
    throw new Error(`departmentKey must start with ${DEPT_PREFIX}`);
  }

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID env var.");

  const departmentName = departmentNameFromArgs || keyToLabel(departmentKey);
  await ensureGroup(userPoolId, departmentKey, departmentName);

  // 1) Create user (or fetch if exists)
  let sub: string | undefined;

  try {
    const createRes = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          { Name: "name", Value: fullName },
        ],
        DesiredDeliveryMediums: ["EMAIL"],
      })
    );
    sub = getAttr(createRes.User?.Attributes, "sub");
  } catch (e: any) {
    // If user already exists, continue (we still assign group + update profile)
    if (e?.name !== "UsernameExistsException") throw e;
  }

  // 2) Ensure user is in department group
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: email,
      GroupName: departmentKey,
    })
  );

  // 3) Resolve sub if missing
  if (!sub) {
    const getRes = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
    sub = getAttr(getRes.UserAttributes, "sub");
  }
  if (!sub) throw new Error("Could not resolve user sub.");

  // 4) Write UserProfile (Data)
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const profileOwner = `${sub}::${email}`;

  const existing = await dataClient.models.UserProfile.list({
    filter: { email: { eq: email } },
    limit: 1,
  });

  if (existing.data.length && existing.data[0]?.id) {
    await dataClient.models.UserProfile.update({
      id: existing.data[0].id,
      email,
      fullName,
      departmentKey,
      departmentName,
      isActive: true,
      profileOwner,
      createdAt: existing.data[0].createdAt ?? new Date().toISOString(),
    });
  } else {
    await dataClient.models.UserProfile.create({
      email,
      fullName,
      departmentKey,
      departmentName,
      isActive: true,
      profileOwner,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    ok: true,
    invitedEmail: email,
    departmentKey,
    departmentName,
    sub,
  };
};
