// amplify/backend.ts
import { defineBackend } from "@aws-amplify/backend";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

import { auth } from "./auth/resource";
import { data } from "./data/resource";

// existing functions
import { inviteUser } from "./functions/invite-user/resource";
import { setUserActive } from "./functions/set-user-active/resource";
import { deleteUser } from "./functions/delete-user/resource";

import { listDepartments } from "./functions/departments/list-departments/resource";
import { createDepartment } from "./functions/departments/create-department/resource";
import { deleteDepartment } from "./functions/departments/delete-department/resource";
import { renameDepartment } from "./functions/departments/rename-department/resource";
import { setUserDepartment } from "./functions/departments/set-user-department/resource";

// ✅ new function
import { myGroups } from "./functions/auth/my-groups/resource";

const backend = defineBackend({
  auth,
  data,

  inviteUser,
  setUserActive,
  deleteUser,

  listDepartments,
  createDepartment,
  deleteDepartment,
  renameDepartment,
  setUserDepartment,

  myGroups,
});

// ✅ IAM permission for Cognito group lookup (safe typing)
const myGroupsLambda = (backend as any)?.myGroups?.resources?.lambda;
if (myGroupsLambda?.addToRolePolicy) {
  myGroupsLambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["cognito-idp:AdminListGroupsForUser"],
      resources: ["*"],
    })
  );
} else if (myGroupsLambda?.role?.addToPrincipalPolicy) {
  myGroupsLambda.role.addToPrincipalPolicy(
    new PolicyStatement({
      actions: ["cognito-idp:AdminListGroupsForUser"],
      resources: ["*"],
    })
  );
}
