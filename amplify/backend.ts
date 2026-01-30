// amplify/backend.ts
import { defineBackend } from "@aws-amplify/backend";

import { auth } from "./auth/resource";
import { data } from "./data/resource";

// functions used by auth.access + data handlers
import { inviteUser } from "./functions/invite-user/resource";
import { setUserActive } from "./functions/set-user-active/resource";
import { deleteUser } from "./functions/delete-user/resource";

import { listDepartments } from "./functions/departments/list-departments/resource";
import { createDepartment } from "./functions/departments/create-department/resource";
import { deleteDepartment } from "./functions/departments/delete-department/resource";
import { renameDepartment } from "./functions/departments/rename-department/resource";
import { setUserDepartment } from "./functions/departments/set-user-department/resource";

// NOTE: customMessage is already referenced by auth triggers; no need to add here.
defineBackend({
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
});
