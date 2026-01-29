import type { Schema } from "../../../data/resource";
import {
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  DeleteGroupCommand,
  GetGroupCommand,
  ListUsersInGroupCommand,
  ListUsersInGroupCommandOutput,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { toDeptKey, keyToLabel } from "../_shared/departmentKey";

const cognito = new CognitoIdentityProviderClient();

export const handler = async (event: { arguments: { oldKey: string; newName: string } }) => {
  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  const oldKey = event.arguments.oldKey.trim();
  const newName = event.arguments.newName.trim();
  if (!oldKey || !newName) throw new Error("oldKey and newName are required");

  const newKey = toDeptKey(newName);

  // ensure old exists
  await cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: oldKey }));

  // create new if missing
  try {
    await cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: newKey }));
  } catch (e: any) {
    await cognito.send(
      new CreateGroupCommand({
        UserPoolId: userPoolId,
        GroupName: newKey,
        Description: newName,
      })
    );
  }

  // migrate users
  let token: string | undefined = undefined;
  const usernames: string[] = [];

  do {
    const res: ListUsersInGroupCommandOutput = await cognito.send(
      new ListUsersInGroupCommand({
        UserPoolId: userPoolId,
        GroupName: oldKey,
        NextToken: token,
        Limit: 60,
      })
    );
    token = res.NextToken;
    for (const u of res.Users ?? []) {
      if (u.Username) usernames.push(u.Username);
    }
  } while (token);

  for (const username of usernames) {
    await cognito.send(
      new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: newKey })
    );
    await cognito.send(
      new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: oldKey })
    );
  }

  // update Data mappings
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  // update DepartmentRoleLink rows
  const links = await dataClient.models.DepartmentRoleLink.list({ limit: 5000 });
  const toUpdate = (links.data ?? []).filter((l) => l.departmentKey === oldKey);
  for (const row of toUpdate) {
    await dataClient.models.DepartmentRoleLink.update({
      id: row.id,
      departmentKey: newKey,
      departmentName: newName,
    });
  }

  // update UserProfile rows
  const profiles = await dataClient.models.UserProfile.list({ limit: 5000 });
  const affected = (profiles.data ?? []).filter((p) => p.departmentKey === oldKey);
  for (const p of affected) {
    await dataClient.models.UserProfile.update({
      id: p.id,
      departmentKey: newKey,
      departmentName: newName || keyToLabel(newKey),
    });
  }

  // delete old group (after migration)
  await cognito.send(new DeleteGroupCommand({ UserPoolId: userPoolId, GroupName: oldKey }));

  return { ok: true, oldKey, newKey, newName, movedUsers: usernames.length };
};
