import { defineAuth } from "@aws-amplify/backend";
import { customMessage } from "./custom-message/resource";

import { inviteUser } from "../functions/invite-user/resource";
import { setUserActive } from "../functions/set-user-active/resource";
import { deleteUser } from "../functions/delete-user/resource";

// Dynamic departments (Cognito groups) functions
import { listDepartments } from "../functions/departments/list-departments/resource";
import { createDepartment } from "../functions/departments/create-department/resource";
import { deleteDepartment } from "../functions/departments/delete-department/resource";
import { setUserDepartment } from "../functions/departments/set-user-department/resource";
import { renameDepartment } from "../functions/departments/rename-department/resource";

export const auth = defineAuth({
  loginWith: { email: true },
  triggers: { customMessage },

  // ✅ IMPORTANT: do NOT define static groups here (dynamic departments/groups at runtime)
  // groups: [],

  access: (allow) => [
    // Invite user + ensure department group exists
    allow
      .resource(inviteUser)
      .to(["createUser", "getUser", "addUserToGroup", "getGroup", "createGroup"]),

    // Enable/Disable user
    allow.resource(setUserActive).to(["disableUser", "enableUser"]),

    // Delete user
    allow.resource(deleteUser).to(["deleteUser"]),

    // Department groups (dynamic)
    allow.resource(listDepartments).to(["listGroups"]),
    allow.resource(createDepartment).to(["getGroup", "createGroup"]),
    allow
      .resource(deleteDepartment)
      .to(["deleteGroup", "listUsersInGroup", "removeUserFromGroup"]),
    allow
      .resource(setUserDepartment)
      .to(["listGroupsForUser", "addUserToGroup", "removeUserFromGroup"]),

    // Rename department (create new group, move users, delete old)
    allow
      .resource(renameDepartment)
      .to([
        "getGroup",
        "createGroup",
        "deleteGroup",
        "listUsersInGroup",
        "addUserToGroup",
        "removeUserFromGroup",
            "resetUserPassword", // ✅ add this

      ]),
  ],
});
