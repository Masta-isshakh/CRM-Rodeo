import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { inviteUser } from "../functions/invite-user/resource";

const schema = a
  .schema({
    // -----------------------------
    // Invite result type (optional)
    // -----------------------------
    InviteUserResult: a.customType({
      email: a.string().required(),
      userSub: a.string().required(),
      username: a.string().required(),
      role: a.string().required(),
      inviteLink: a.string().required(),
      message: a.string().required(),
    }),

    // -----------------------------
    // USER PROFILE
    // -----------------------------
    UserProfile: a
      .model({
        email: a.string().required(),
        fullName: a.string().required(),
        role: a.enum(["ADMIN", "SALES", "SALES_MANAGER", "SUPPORT"]),
        isActive: a.boolean().default(true),
        createdAt: a.datetime(),

        // critical for owner-based access
        // Format: `${sub}::${username}`
        profileOwner: a.string().required(),

        // ✅ inverse for UserDepartment.user
        departments: a.hasMany("UserDepartment", "userId"),
      })
      .authorization((allow) => [
        allow.ownerDefinedIn("profileOwner"),
        allow.group("ADMIN"),
      ]),

    // -----------------------------
    // RBAC MODELS (Departments/Roles/Policies)
    // -----------------------------

    Department: a
      .model({
        name: a.string().required(),
        isActive: a.boolean().default(true),
        createdAt: a.datetime(),

        // ✅ inverse for DepartmentRole.department
        roles: a.hasMany("DepartmentRole", "departmentId"),

        // ✅ inverse for UserDepartment.department  <-- THIS FIXES YOUR ERROR
        users: a.hasMany("UserDepartment", "departmentId"),
      })
      .authorization((allow) => [
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    // Assign users to departments
    UserDepartment: a
      .model({
        userId: a.id().required(),
        departmentId: a.id().required(),
        createdAt: a.datetime(),

        // ✅ belongsTo side
        user: a.belongsTo("UserProfile", "userId"),
        department: a.belongsTo("Department", "departmentId"),
      })
      .authorization((allow) => [
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    // AppRole (your business roles like "AccountantRole")
    AppRole: a
      .model({
        name: a.string().required(),
        description: a.string(),
        isActive: a.boolean().default(true),
        createdAt: a.datetime(),

        // ✅ inverse for RolePolicy.role
        rolePolicies: a.hasMany("RolePolicy", "roleId"),

        // ✅ inverse for DepartmentRole.role
        departments: a.hasMany("DepartmentRole", "roleId"),
      })
      .authorization((allow) => [
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    // Policy for a role (each page = a policyKey)
    RolePolicy: a
      .model({
        roleId: a.id().required(),
        policyKey: a.string().required(), // ex: "CUSTOMERS"

        canRead: a.boolean().default(false),
        canCreate: a.boolean().default(false),
        canUpdate: a.boolean().default(false),
        canDelete: a.boolean().default(false),
        canApprove: a.boolean().default(false),

        createdAt: a.datetime(),

        // ✅ belongsTo side
        role: a.belongsTo("AppRole", "roleId"),
      })
      .authorization((allow) => [
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    // Assign roles to departments
    DepartmentRole: a
      .model({
        departmentId: a.id().required(),
        roleId: a.id().required(),
        createdAt: a.datetime(),

        department: a.belongsTo("Department", "departmentId"),
        role: a.belongsTo("AppRole", "roleId"),
      })
      .authorization((allow) => [
        allow.group("ADMIN"),
        allow.authenticated().to(["read"]),
      ]),

    // -----------------------------
    // CRM MODELS (your existing ones)
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
        allow.group("SALES"),
        allow.group("SALES_MANAGER"),
        allow.group("SUPPORT").to(["read"]),
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
      .authorization((allow) => [allow.owner(), allow.group("ADMIN")]),

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
        allow.group("ADMIN"),
        allow.group("SALES"),
        allow.group("SALES_MANAGER"),
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
        allow.group("ADMIN"),
        allow.group("SALES"),
        allow.group("SALES_MANAGER"),
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
        allow.group("ADMIN"),
        allow.group("SUPPORT"),
        allow.group("SALES_MANAGER").to(["read"]),
        allow.group("SALES").to(["read"]),
      ]),

    TicketComment: a
      .model({
        ticketId: a.id().required(),
        message: a.string().required(),
        author: a.string(),
        createdAt: a.datetime(),

        ticket: a.belongsTo("Ticket", "ticketId"),
      })
      .authorization((allow) => [allow.group("ADMIN"), allow.group("SUPPORT")]),

    // -----------------------------
    // MUTATION: inviteUser (ADMIN only)
    // -----------------------------
    inviteUser: a
      .mutation()
      .arguments({
        email: a.string().required(),
        fullName: a.string().required(),
        role: a.string().required(),
      })
      .authorization((allow) => [allow.group("ADMIN")])
      .handler(a.handler.function(inviteUser))
      .returns(a.json()),
  })
  // allow lambda to call data
  .authorization((allow) => [allow.resource(inviteUser)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
