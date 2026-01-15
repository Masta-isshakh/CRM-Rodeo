import { defineAuth } from "@aws-amplify/backend";
import { inviteUser } from "../functions/invite-user/resource";
import { customMessage } from "./custom-message/resource";

// NEW imports:
import { updateUserRole } from "../functions/update-user-role/resource";
import { setUserActive } from "../functions/set-user-active/resource";
import { deleteUser } from "../functions/delete-user/resource";

export const auth = defineAuth({
  loginWith: { email: true },

  triggers: { customMessage },

  groups: ["ADMIN", "SALES", "SALES_MANAGER", "SUPPORT"],

  access: (allow) => [
    // invite
    allow.resource(inviteUser).to(["createUser", "addUserToGroup", "getUser"]),

    // role change needs: list groups, remove old group(s), add new group
    allow
      .resource(updateUserRole)
      .to(["listGroupsForUser", "removeUserFromGroup", "addUserToGroup"]),

    // disable/enable needs:
    allow.resource(setUserActive).to(["disableUser", "enableUser"]),

    // delete needs:
    allow.resource(deleteUser).to(["deleteUser"]),
  ],
});
