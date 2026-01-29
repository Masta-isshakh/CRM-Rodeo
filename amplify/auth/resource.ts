import { defineAuth } from "@aws-amplify/backend";
import { customMessage } from "./custom-message/resource";

import { inviteUser } from "../functions/invite-user/resource";
import { setUserActive } from "../functions/set-user-active/resource";
import { deleteUser } from "../functions/delete-user/resource";

// Department (dynamic groups) functions
import { listDepartments } from "../functions/departments/list-departments/resource";
import { createDepartment } from "../functions/departments/create-department/resource";
import { deleteDepartment } from "../functions/departments/delete-department/resource";
import { setUserDepartment } from "../functions/departments/set-user-department/resource";

// If you implement rename by “create new group + move users + delete old”
import { renameDepartment } from "../functions/departments/rename-department/resource";

export const auth = defineAuth({
  loginWith: { email: true },
  triggers: { customMessage },

  // ✅ IMPORTANT: NO "groups: []" here -> departments are dynamic (created at runtime)

  access: (allow) => [
    // Invite user needs createUser + add user to group
    allow
      .resource(inviteUser)
      .to(["createUser", "getUser", "addUserToGroup", "getGroup", "createGroup"]),

    // Enable/disable user
    allow.resource(setUserActive).to(["disableUser", "enableUser"]),

    // Delete user
    allow.resource(deleteUser).to(["deleteUser"]),

    // Dynamic departments (Cognito Groups)
    allow.resource(listDepartments).to(["listGroups"]),
    allow.resource(createDepartment).to(["getGroup", "createGroup"]),
    allow.resource(deleteDepartment).to(["deleteGroup", "listUsersInGroup", "removeUserFromGroup"]),
    allow.resource(setUserDepartment).to(["listGroupsForUser", "addUserToGroup", "removeUserFromGroup"]),

    // Optional rename (implemented as migration)
    allow
      .resource(renameDepartment)
      .to([
        "getGroup",
        "createGroup",
        "deleteGroup",
        "listUsersInGroup",
        "addUserToGroup",
        "removeUserFromGroup",
      ]),
  ],
});
