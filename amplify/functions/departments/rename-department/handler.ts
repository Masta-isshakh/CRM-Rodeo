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
import type { Schema } from "../../../data/resource";

type Handler = Schema["adminRenameDepartment"]["functionHandler"];
const cognito = new CognitoIdentityProviderClient();

export const handler: Handler = async (event) => {
  const oldName = event.arguments.oldName.trim();
  const newName = event.arguments.newName.trim();
  if (!oldName || !newName) throw new Error("oldName/newName required.");
  if (oldName === newName) return { ok: true, migratedUsers: 0, updatedLinks: 0 };

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  // ensure old exists
  await cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: oldName }));

  // ensure new exists (create if missing)
  try {
    await cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: newName }));
  } catch {
    await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: newName }));
  }

  // migrate users
  let migrated = 0;
  let token: string | undefined = undefined;
  do {
    const res: ListUsersInGroupCommandOutput = await cognito.send(
      new ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: oldName, NextToken: token, Limit: 60 })
    );

    for (const u of res.Users ?? []) {
      if (!u.Username) continue;
      await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: u.Username, GroupName: newName }));
      await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId, Username: u.Username, GroupName: oldName }));
      migrated++;
    }

    token = res.NextToken;
  } while (token);

  // update mappings in Data (DepartmentRoleLink + UserProfile.departmentName)
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  // update DepartmentRoleLink departmentName
  const links = await dataClient.models.DepartmentRoleLink.list({
    filter: { departmentName: { eq: oldName } },
    limit: 5000,
  });

  let updatedLinks = 0;
  for (const l of links.data) {
    await dataClient.models.DepartmentRoleLink.update({ id: l.id, departmentName: newName });
    updatedLinks++;
  }

  // update UserProfile.departmentName
  const users = await dataClient.models.UserProfile.list({
    filter: { departmentName: { eq: oldName } },
    limit: 5000,
  });
  for (const p of users.data) {
    await dataClient.models.UserProfile.update({ id: p.id, departmentName: newName });
  }

  // delete old group
  await cognito.send(new DeleteGroupCommand({ UserPoolId: userPoolId, GroupName: oldName }));

  return { ok: true, migratedUsers: migrated, updatedLinks };
};
