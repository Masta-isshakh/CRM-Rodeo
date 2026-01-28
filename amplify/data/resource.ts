import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { inviteUser } from "../functions/invite-user/resource";
import { updateUserRole } from "../functions/update-user-role/resource";
import { setUserActive } from "../functions/set-user-active/resource";
import { deleteUser } from "../functions/delete-user/resource";


// ✅ POLICY KEYS = one key per page
const POLICY_KEYS = [
  "DASHBOARD",
  "CUSTOMERS",
  "TICKETS",
  "EMPLOYEES",
  "ACTIVITY_LOG",
  "USERS_ADMIN",
  "JOB_CARDS",
  "CALL_TRACKING",
  "INSPECTION_APPROVALS",
  "DEPARTMENTS_ADMIN",
  "ROLES_POLICIES_ADMIN",
] as const;

const schema = a
  .schema({
    InviteUserResult: a.customType({
      email: a.string().required(),
      userSub: a.string().required(),
      username: a.string().required(),
      role: a.string().required(),
      inviteLink: a.string().required(),
      message: a.string().required(),
    }),

    UserProfile: a
      .model({
        email: a.string().required(),
        fullName: a.string().required(),
        role: a.enum(["ADMIN", "SALES", "SUPPORT", "SALES_MANAGER"]),
        isActive: a.boolean().default(true),
        createdAt: a.datetime(),
        profileOwner: a.string().required(),
      })
      .authorization((allow) => [
        allow.ownerDefinedIn("profileOwner"),
        allow.group("ADMIN"),
      ]),

      
  // =========================
  // ✅ NEW: Department
  // =========================
  Department: a
    .model({
      name: a.string().required(),
      isActive: a.boolean().default(true),
      createdAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.group("ADMIN"),
      allow.authenticated().to(["read"]), // users can read department name
    ]),

      // =========================
  // ✅ NEW: Role
  // =========================
  AppRole: a
    .model({
      name: a.string().required(),
      isActive: a.boolean().default(true),
      createdAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.group("ADMIN"),
      allow.authenticated().to(["read"]), // users can read roles
    ]),


      // =========================
  // ✅ NEW: Role ↔ Policy
  // Each row = 1 role + 1 policyKey + action flags
  // =========================
  RolePolicy: a
    .model({
      roleId: a.id().required(),
      policyKey: a.enum(POLICY_KEYS as any),

      canRead: a.boolean().default(false),
      canCreate: a.boolean().default(false),
      canUpdate: a.boolean().default(false),
      canDelete: a.boolean().default(false),
      canApprove: a.boolean().default(false),

      updatedAt: a.datetime(),
      role: a.belongsTo("AppRole", "roleId"),
    })
    .authorization((allow) => [
      allow.group("ADMIN"),
      allow.authenticated().to(["read"]), // users must read their role policies
    ]),


      // =========================
  // ✅ NEW: Department ↔ Role (many-to-many)
  // Assign roles to a department
  // =========================
  DepartmentRole: a
    .model({
      departmentId: a.id().required(),
      roleId: a.id().required(),

      department: a.belongsTo("Department", "departmentId"),
      role: a.belongsTo("AppRole", "roleId"),
    })
    .authorization((allow) => [
      allow.group("ADMIN"),
      allow.authenticated().to(["read"]),
    ]),

  // =========================
  // ✅ NEW: User ↔ Department assignment
  // Admin sets this; users can read only their own assignment via owner field
  // =========================
  UserDepartment: a
    .model({
      userEmail: a.string().required(),
      departmentId: a.id().required(),

      assignmentOwner: a.string().required(), // set to user profileOwner (sub::email)

      department: a.belongsTo("Department", "departmentId"),
    })
    .authorization((allow) => [
      allow.ownerDefinedIn("assignmentOwner").to(["read"]),
      allow.group("ADMIN"),
    ]),

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
        stage: a.enum([
          "LEAD",
          "QUALIFIED",
          "PROPOSAL",
          "NEGOTIATION",
          "WON",
          "LOST",
        ]),
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
        allow.group("SALES").to(["read"]),
        allow.group("SALES_MANAGER").to(["read"]),
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

    // =========================
    // NEW MODELS
    // =========================

    JobCard: a
      .model({
        title: a.string().required(),
        customerName: a.string().required(),
        customerPhone: a.string(),
        vehicle: a.string(),
        plateNumber: a.string(),
        serviceType: a.string(),
        notes: a.string(),
        status: a.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]),
        createdBy: a.string(),
        createdAt: a.datetime(),
      })
      .authorization((allow) => [
        allow.group("ADMIN"),
        allow.group("SALES"),
        allow.group("SALES_MANAGER"),
      ]),

    CallTracking: a
      .model({
        customerName: a.string().required(),
        phone: a.string().required(),
        source: a.string(),
        outcome: a.enum([
          "NO_ANSWER",
          "ANSWERED",
          "BOOKED",
          "FOLLOW_UP",
          "NOT_INTERESTED",
        ]),
        followUpAt: a.datetime(),
        notes: a.string(),
        createdBy: a.string(),
        createdAt: a.datetime(),
      })
      .authorization((allow) => [
        allow.group("ADMIN"),
        allow.group("SALES"),
        allow.group("SALES_MANAGER"),
      ]),

InspectionApproval: a
  .model({
    jobCardId: a.id(),
    customerName: a.string().required(),
    vehicle: a.string(),
    inspectionNotes: a.string(),
    amountQuoted: a.float(),
    status: a.enum(["PENDING", "APPROVED", "REJECTED"]),
    approvedBy: a.string(),
    approvedAt: a.datetime(),
    createdBy: a.string(),
    createdAt: a.datetime(),
  })
  .authorization((allow) => [
    // ADMIN full access (includes read)
    allow.group("ADMIN"),

    // SALES_MANAGER full access (includes read)
    allow.group("SALES_MANAGER"),

    // SALES read-only
    allow.group("SALES").to(["read"]),
  ]),


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


      adminUpdateUserRole: a
  .mutation()
  .arguments({
    email: a.string().required(),
    role: a.enum(["ADMIN", "SALES", "SALES_MANAGER", "SUPPORT"]),
  })
  .authorization((allow) => [allow.group("ADMIN")])
  .handler(a.handler.function(updateUserRole))
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

  })
.authorization((allow) => [
  allow.resource(inviteUser),
  allow.resource(updateUserRole),
  allow.resource(setUserActive),
  allow.resource(deleteUser),
]);


export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
