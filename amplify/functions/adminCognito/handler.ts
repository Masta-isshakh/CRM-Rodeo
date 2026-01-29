// amplify/functions/adminCognito/handler.ts
import {
  CognitoIdentityProviderClient,
  ListGroupsCommand,
  CreateGroupCommand,
  DeleteGroupCommand,
  UpdateGroupCommand,
  ListUsersCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const USERPOOL_ID = process.env.USERPOOL_ID!;
const DEPT_PREFIX = process.env.DEPT_PREFIX || "dept_";

const cognito = new CognitoIdentityProviderClient({});

type Dept = { key: string; name: string };

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function listAllGroups(): Promise<Dept[]> {
  const out: Dept[] = [];
  let nextToken: string | undefined;

  do {
    const res = await cognito.send(
      new ListGroupsCommand({
        UserPoolId: USERPOOL_ID,
        NextToken: nextToken,
        Limit: 60,
      })
    );

    for (const g of res.Groups ?? []) {
      const groupName = g.GroupName ?? "";
      if (!groupName.startsWith(DEPT_PREFIX)) continue;

      out.push({
        key: groupName,
        name: g.Description || groupName,
      });
    }

    nextToken = res.NextToken;
  } while (nextToken);

  // Sort by display name
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function createDepartment(departmentName: string) {
  const clean = departmentName.trim();
  if (!clean) throw new Error("Department name required.");

  const key = `${DEPT_PREFIX}${slugify(clean)}`;

  // Create group with description as human-friendly name
  await cognito.send(
    new CreateGroupCommand({
      UserPoolId: USERPOOL_ID,
      GroupName: key,
      Description: clean,
    })
  );

  return { ok: true, key };
}

// Cognito does not support renaming GroupName.
// We implement rename by: create new group -> migrate users -> delete old group.
async function renameDepartment(oldKey: string, newName: string) {
  const oldK = oldKey.trim();
  const newN = newName.trim();
  if (!oldK || !newN) throw new Error("Old key + new name required.");

  const newKey = `${DEPT_PREFIX}${slugify(newN)}`;

  // 1) Create new group
  await cognito.send(
    new CreateGroupCommand({
      UserPoolId: USERPOOL_ID,
      GroupName: newKey,
      Description: newN,
    })
  );

  // 2) Move users
  let nextToken: string | undefined;
  do {
    const res = await cognito.send(
      new ListUsersInGroupCommand({
        UserPoolId: USERPOOL_ID,
        GroupName: oldK,
        NextToken: nextToken,
        Limit: 60,
      })
    );

    for (const u of res.Users ?? []) {
      const username = u.Username;
      if (!username) continue;

      await cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: USERPOOL_ID,
          Username: username,
          GroupName: newKey,
        })
      );

      await cognito.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: USERPOOL_ID,
          Username: username,
          GroupName: oldK,
        })
      );
    }

    nextToken = res.NextToken;
  } while (nextToken);

  // 3) Delete old group
  await cognito.send(
    new DeleteGroupCommand({
      UserPoolId: USERPOOL_ID,
      GroupName: oldK,
    })
  );

  return { ok: true, newKey };
}

async function deleteDepartment(key: string) {
  const k = key.trim();
  if (!k) throw new Error("Department key required.");

  // Safety: block delete if it contains users
  const usersRes = await cognito.send(
    new ListUsersInGroupCommand({
      UserPoolId: USERPOOL_ID,
      GroupName: k,
      Limit: 1,
    })
  );
  if ((usersRes.Users ?? []).length > 0) {
    throw new Error("Cannot delete department: it still has users.");
  }

  await cognito.send(
    new DeleteGroupCommand({
      UserPoolId: USERPOOL_ID,
      GroupName: k,
    })
  );

  return { ok: true };
}

async function listUsers(limit = 60) {
  const out: any[] = [];
  let paginationToken: string | undefined;

  do {
    const res = await cognito.send(
      new ListUsersCommand({
        UserPoolId: USERPOOL_ID,
        Limit: Math.min(limit, 60),
        PaginationToken: paginationToken,
      })
    );

    for (const u of res.Users ?? []) {
      const username = u.Username ?? "";
      const emailAttr = (u.Attributes ?? []).find((a) => a.Name === "email");
      const email = emailAttr?.Value ?? "";

      // groups for this user
      const groupsRes = await cognito.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: USERPOOL_ID,
          Username: username,
        })
      );

      const groups = (groupsRes.Groups ?? [])
        .map((g) => g.GroupName)
        .filter(Boolean) as string[];

      out.push({
        username,
        email,
        enabled: !!u.Enabled,
        status: u.UserStatus ?? "",
        groups,
      });
    }

    paginationToken = res.PaginationToken;
  } while (paginationToken);

  out.sort((a, b) => (a.email || a.username).localeCompare(b.email || b.username));
  return { users: out };
}

async function addUserToDepartment(username: string, departmentKey: string) {
  if (!username?.trim()) throw new Error("Username required.");
  if (!departmentKey?.trim()) throw new Error("Department key required.");

  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USERPOOL_ID,
      Username: username.trim(),
      GroupName: departmentKey.trim(),
    })
  );

  return { ok: true };
}

async function removeUserFromDepartment(username: string, departmentKey: string) {
  if (!username?.trim()) throw new Error("Username required.");
  if (!departmentKey?.trim()) throw new Error("Department key required.");

  await cognito.send(
    new AdminRemoveUserFromGroupCommand({
      UserPoolId: USERPOOL_ID,
      Username: username.trim(),
      GroupName: departmentKey.trim(),
    })
  );

  return { ok: true };
}

async function listUserDepartments(username: string) {
  if (!username?.trim()) throw new Error("Username required.");

  const res = await cognito.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: USERPOOL_ID,
      Username: username.trim(),
    })
  );

  const departments = (res.Groups ?? [])
    .map((g) => g.GroupName)
    .filter((x): x is string => !!x && x.startsWith(DEPT_PREFIX));

  return { departments };
}

export const handler = async (event: any) => {
  const field = event?.info?.fieldName;

  switch (field) {
    case "adminListDepartments": {
      const departments = await listAllGroups();
      return { departments };
    }
    case "adminCreateDepartment": {
      const { departmentName } = event.arguments;
      return await createDepartment(departmentName);
    }
    case "adminRenameDepartment": {
      const { oldKey, newName } = event.arguments;
      return await renameDepartment(oldKey, newName);
    }
    case "adminDeleteDepartment": {
      const { departmentKey } = event.arguments;
      return await deleteDepartment(departmentKey);
    }

    case "adminListUsers": {
      return await listUsers();
    }
    case "adminAddUserToDepartment": {
      const { username, departmentKey } = event.arguments;
      return await addUserToDepartment(username, departmentKey);
    }
    case "adminRemoveUserFromDepartment": {
      const { username, departmentKey } = event.arguments;
      return await removeUserFromDepartment(username, departmentKey);
    }
    case "adminListUserDepartments": {
      const { username } = event.arguments;
      return await listUserDepartments(username);
    }

    default:
      throw new Error(`Unknown field: ${field}`);
  }
};
