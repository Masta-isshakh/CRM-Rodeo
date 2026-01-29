import { a, defineData, type ClientSchema } from "@aws-amplify/backend";

import { inviteUser } from "../functions/invite-user/resource";
import { setUserActive } from "../functions/set-user-active/resource";
import { deleteUser } from "../functions/delete-user/resource";

import { listDepartments } from "../functions/departments/list-departments/resource";
import { createDepartment } from "../functions/departments/create-department/resource";
import { deleteDepartment } from "../functions/departments/delete-department/resource";
import { setUserDepartment } from "../functions/departments/set-user-department/resource";
import { renameDepartment } from "../functions/departments/rename-department/resource";

const schema = a
  .schema({
    InviteUserResult: a.customType({
      email: a.string().required(),
      userSub: a.string().required(),
      username: a.string().required(),
      departmentName: a.string().required(),
      inviteLink: a.string().required(),
      message: a.string().required(),
    }),

    // -----------------------------
    // USER PROFILE (department = group)
    // -----------------------------
    UserProfile: a
      .model({
        email: a.string().required(),
        fullName: a.string().required(),

        // ✅ department is Cognito Group name (dynamic)
        departmentName: a.string(),

        isActive: a.boolean().default(true),
        createdAt: a.datetime(),

        // owner field used by allow.ownerDefinedIn
        profileOwner: a.string().required(),
      })
      .authorization((allow) => [
        allow.ownerDefinedIn("profileOwner"),
        // ✅ Only ADMIN can manage users data
        allow.group("ADMIN"),
      ]),

    // -----------------------------
    // RBAC MODELS (Roles/Policies)
    // -----------------------------
    AppRole: a
      .model({
        name: a.string().required(),
        description: a.string(),
        isActive: a.boolean().default(true),
        createdAt: a.datetime(),

        rolePolicies: a.hasMany("RolePolicy", "roleId"),
        deptLinks: a.hasMany("DepartmentRoleLink", "roleId"),
      })
      .authorization((allow) => [
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    RolePolicy: a
      .model({
        roleId: a.id().required(),
        policyKey: a.string().required(),

        canRead: a.boolean().default(false),
        canCreate: a.boolean().default(false),
        canUpdate: a.boolean().default(false),
        canDelete: a.boolean().default(false),
        canApprove: a.boolean().default(false),

        createdAt: a.datetime(),

        role: a.belongsTo("AppRole", "roleId"),
      })
      .authorization((allow) => [
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    // ✅ Maps Department(groupName) -> AppRole
    DepartmentRoleLink: a
      .model({
        departmentName: a.string().required(), // Cognito group name
        roleId: a.id().required(),
        createdAt: a.datetime(),

        role: a.belongsTo("AppRole", "roleId"),
      })
      .authorization((allow) => [
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    // -----------------------------
    // CRM MODELS
    // NOTE: since departments are dynamic, we cannot use allow.group("dept")
    // Use OWNER for write + authenticated read, and enforce fine-grain in UI/functions.
    // -----------------------------
    Customer: a
      .model({
        name: a.string().required(),
        lastname: a.string().required(),
        email: a.string(),
        phone: a.string(),
        company: a.string(),
        notes: a.string(),
        createdBy: a.string(),
        createdAt: a.datetime(),

        contacts: a.hasMany("Contact", "customerId"),
        deals: a.hasMany("Deal", "customerId"),
        tickets: a.hasMany("Ticket", "customerId"),
      })
      .authorization((allow) => [
        allow.owner(),
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    Employee: a
      .model({
        firstName: a.string().required(),
        lastName: a.string().required(),
        position: a.string(),
        email: a.string().required(),
        phone: a.string(),
        salary: a.integer(),
        createdAt: a.datetime(),
      })
      .authorization((allow) => [allow.group("ADMIN"), allow.authenticated().to(["read"])]),

    ActivityLog: a
      .model({
        entityType: a.string().required(),
        entityId: a.string().required(),
        action: a.string().required(),
        message: a.string().required(),
        createdAt: a.datetime().required(),
      })
      .authorization((allow) => [allow.authenticated()]),

    Contact: a
      .model({
        customerId: a.id().required(),
        fullName: a.string().required(),
        email: a.string(),
        phone: a.string(),
        position: a.string(),
        createdAt: a.datetime(),

        customer: a.belongsTo("Customer", "customerId"),
      })
      .authorization((allow) => [
        allow.owner(),
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    Deal: a
      .model({
        customerId: a.id().required(),
        title: a.string().required(),
        value: a.float(),
        stage: a.enum(["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]),
        expectedCloseDate: a.date(),
        owner: a.string(),
        createdAt: a.datetime(),

        customer: a.belongsTo("Customer", "customerId"),
      })
      .authorization((allow) => [
        allow.owner(),
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    Ticket: a
      .model({
        customerId: a.id().required(),
        title: a.string().required(),
        description: a.string(),
        status: a.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
        priority: a.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
        assignedTo: a.string(),
        createdAt: a.datetime(),

        customer: a.belongsTo("Customer", "customerId"),
        comments: a.hasMany("TicketComment", "ticketId"),
      })
      .authorization((allow) => [
        allow.owner(),
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    TicketComment: a
      .model({
        ticketId: a.id().required(),
        message: a.string().required(),
        author: a.string(),
        createdAt: a.datetime(),

        ticket: a.belongsTo("Ticket", "ticketId"),
      })
      .authorization((allow) => [
        allow.owner(),
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    // -----------------------------
    // ADMIN MUTATIONS
    // -----------------------------

    inviteUser: a
      .mutation()
      .arguments({
        email: a.string().required(),
        fullName: a.string().required(),
        departmentName: a.string().required(), // ✅ department (dynamic group)
      })
      .authorization((allow) => [allow.group("ADMIN")])
      .handler(a.handler.function(inviteUser))
      .returns(a.json()),

    adminSetUserActive: a
      .mutation()
      .arguments({
        email: a.string().required(),
        isActive: a.boolean().required(),
      })
      .authorization((allow) => [allow.group("ADMIN")])
      .handler(a.handler.function(setUserActive))
      .returns(a.json()),

    adminDeleteUser: a
      .mutation()
      .arguments({
        email: a.string().required(),
      })
      .authorization((allow) => [allow.group("ADMIN")])
      .handler(a.handler.function(deleteUser))
      .returns(a.json()),

    // ✅ Departments (Cognito Groups)
    adminListDepartments: a
      .mutation()
      .authorization((allow) => [allow.group("ADMIN")])
      .handler(a.handler.function(listDepartments))
      .returns(a.json()),

    adminCreateDepartment: a
      .mutation()
      .arguments({ departmentName: a.string().required() })
      .authorization((allow) => [allow.group("ADMIN")])
      .handler(a.handler.function(createDepartment))
      .returns(a.json()),

    adminRenameDepartment: a
      .mutation()
      .arguments({
        oldName: a.string().required(),
        newName: a.string().required(),
      })
      .authorization((allow) => [allow.group("ADMIN")])
      .handler(a.handler.function(renameDepartment))
      .returns(a.json()),

    adminDeleteDepartment: a
      .mutation()
      .arguments({ departmentName: a.string().required() })
      .authorization((allow) => [allow.group("ADMIN")])
      .handler(a.handler.function(deleteDepartment))
      .returns(a.json()),

    adminSetUserDepartment: a
      .mutation()
      .arguments({
        email: a.string().required(),
        departmentName: a.string().required(),
      })
      .authorization((allow) => [allow.group("ADMIN")])
      .handler(a.handler.function(setUserDepartment))
      .returns(a.json()),
  })
  .authorization((allow) => [
    // allow lambdas to call Data
    allow.resource(inviteUser),
    allow.resource(setUserActive),
    allow.resource(deleteUser),

    allow.resource(listDepartments),
    allow.resource(createDepartment),
    allow.resource(renameDepartment),
    allow.resource(deleteDepartment),
    allow.resource(setUserDepartment),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
