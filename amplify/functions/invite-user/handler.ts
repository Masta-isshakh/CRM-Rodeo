import type { Schema } from "../../data/resource";

import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  CreateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = Schema["inviteUser"]["functionHandler"];
const cognito = new CognitoIdentityProviderClient();

function getAttr(attrs: { Name?: string; Value?: string }[] | undefined, name: string) {
  return (attrs ?? []).find((a) => a.Name === name)?.Value;
}

export const handler: Handler = async (event) => {
  const { email, fullName, departmentName } = event.arguments;

  const e = email.trim().toLowerCase();
  const n = fullName.trim();
  const dept = departmentName.trim();

  if (!e || !n || !dept) throw new Error("email, fullName, departmentName are required.");

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  // ensure group exists
  try {
    await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: dept }));
  } catch {
    // ignore AlreadyExists
  }

  // create user (Cognito sends invite email)
  const createRes = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: e,
      UserAttributes: [
        { Name: "email", Value: e },
        { Name: "email_verified", Value: "true" },
      ],
      DesiredDeliveryMediums: ["EMAIL"],
    })
  );

  // add to department(group)
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: e, GroupName: dept }));

  // resolve sub
  let sub = getAttr(createRes.User?.Attributes, "sub");
  if (!sub) {
    const getUserRes = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: e }));
    sub = getAttr(getUserRes.UserAttributes, "sub");
  }
  if (!sub) throw new Error("Could not resolve user sub.");

  // write UserProfile
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const profileOwner = `${sub}::${e}`;

  const existing = await dataClient.models.UserProfile.list({ filter: { email: { eq: e } }, limit: 1 });
  if (existing.data.length) {
    await dataClient.models.UserProfile.update({
      id: existing.data[0].id,
      email: e,
      fullName: n,
      isActive: true,
      profileOwner,
      departmentName: dept,
      createdAt: existing.data[0].createdAt ?? new Date().toISOString(),
    });
  } else {
    await dataClient.models.UserProfile.create({
      email: e,
      fullName: n,
      isActive: true,
      profileOwner,
      departmentName: dept,
      createdAt: new Date().toISOString(),
    });
  }

  return { ok: true, invitedEmail: e, departmentName: dept, sub };
};
