import type { Schema } from "../../../data/resource";
import {
  CognitoIdentityProviderClient,
  DeleteGroupCommand,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

const cognito = new CognitoIdentityProviderClient();

export const handler = async (event: { arguments: { departmentKey: string } }) => {
  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  const key = event.arguments.departmentKey.trim();
  if (!key) throw new Error("departmentKey is required");

  const users = await cognito.send(
    new ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: key, Limit: 2 })
  );

  if ((users.Users ?? []).length > 0) {
    throw new Error(`Cannot delete "${key}" because it still has users. Remove users first.`);
  }

  // delete DepartmentRoleLink mappings from Data
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const links = await dataClient.models.DepartmentRoleLink.list({ limit: 5000 });
  const toDelete = (links.data ?? []).filter((l) => l.departmentKey === key && l.id);
  for (const row of toDelete) {
    await dataClient.models.DepartmentRoleLink.delete({ id: row.id });
  }

  await cognito.send(new DeleteGroupCommand({ UserPoolId: userPoolId, GroupName: key }));
  return { ok: true };
};
