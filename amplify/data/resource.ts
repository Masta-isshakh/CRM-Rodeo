import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { myGroups } from "../functions/auth/my-groups/resource";

// functions
import { inviteUser } from "../functions/invite-user/resource";
import { setUserActive } from "../functions/set-user-active/resource";
import { deleteUser } from "../functions/delete-user/resource";

import { listDepartments } from "../functions/departments/list-departments/resource";
import { createDepartment } from "../functions/departments/create-department/resource";
import { deleteDepartment } from "../functions/departments/delete-department/resource";
import { renameDepartment } from "../functions/departments/rename-department/resource";
import { setUserDepartment } from "../functions/departments/set-user-department/resource";

// ✅ Job Orders (Job Cards) module
import { jobOrderSave } from "../functions/job-orders/save-job-order/resource";
import { jobOrderDelete } from "../functions/job-orders/delete-job-order/resource";

// ✅ MUST MATCH your Cognito group name EXACTLY
const ADMIN_GROUP = "Admins";

const schema = a
  .schema({
    // -----------------------------
    // USER PROFILE
    // -----------------------------
    UserProfile: a
      .model({
        email: a.string().required(),
        fullName: a.string().required(),
        isActive: a.boolean().default(true),
        createdAt: a.datetime(),
        mobileNumber: a.string(),

        // owner: `${sub}::${email}`
        profileOwner: a.string().required(),

        // Department = Cognito group key
        departmentKey: a.string(),
        departmentName: a.string(),
      })
      .authorization((allow) => [
        allow.ownerDefinedIn("profileOwner"),
        allow.group(ADMIN_GROUP),
      ]),

    // -----------------------------
    // RBAC MODELS
    // -----------------------------
    AppRole: a
      .model({
        name: a.string().required(),
        description: a.string(),
        isActive: a.boolean().default(true),
        createdAt: a.datetime(),
      })
      .authorization((allow) => [
        allow.group(ADMIN_GROUP),
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
      })
      .authorization((allow) => [
        allow.group(ADMIN_GROUP),
        allow.authenticated().to(["read"]),
      ]),

    DepartmentRoleLink: a
      .model({
        departmentKey: a.string().required(), // Cognito group key
        departmentName: a.string(),
        roleId: a.id().required(),
        createdAt: a.datetime(),
      })
      .authorization((allow) => [
        allow.group(ADMIN_GROUP),
        allow.authenticated().to(["read"]),
      ]),

    // -----------------------------
    // CRM MODELS
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
      .authorization((allow) => [allow.authenticated()]),

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
      .authorization((allow) => [allow.authenticated()]),

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
      .authorization((allow) => [allow.authenticated()]),

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
      .authorization((allow) => [allow.authenticated()]),

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
      .authorization((allow) => [allow.authenticated()]),

    TicketComment: a
      .model({
        ticketId: a.id().required(),
        message: a.string().required(),
        author: a.string(),
        createdAt: a.datetime(),

        ticket: a.belongsTo("Ticket", "ticketId"),
      })
      .authorization((allow) => [allow.authenticated()]),

    // -----------------------------
    // Job Orders (Job Cards) — Read-only for users; mutations go through functions (RBAC enforced server-side)
    // -----------------------------
    JobOrder: a
      .model({
        orderNumber: a.string().required(),
        orderType: a.string(),
        status: a.enum(["DRAFT", "OPEN", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"]),
        paymentStatus: a.enum(["UNPAID", "PARTIAL", "PAID"]),

        customerId: a.id(),
        customerName: a.string().required(),
        customerPhone: a.string(),
        customerEmail: a.string(),

        vehicleType: a.enum(["SEDAN", "SUV_4X4", "TRUCK", "MOTORBIKE", "OTHER"]),
        vehicleMake: a.string(),
        vehicleModel: a.string(),
        plateNumber: a.string(),
        vin: a.string(),
        mileage: a.string(),
        color: a.string(),

        subtotal: a.float(),
        discount: a.float(),
        vatRate: a.float(),
        vatAmount: a.float(),
        totalAmount: a.float(),
        amountPaid: a.float(),
        balanceDue: a.float(),

        notes: a.string(),

        // stores the entire module payload (services, payments, docs, inspection, etc.)
        dataJson: a.string(),

        createdBy: a.string(),
        createdAt: a.datetime(),
        updatedAt: a.datetime(),
      })
      .authorization((allow) => [
        allow.group(ADMIN_GROUP),
        allow.authenticated().to(["read"]),
      ]),

    // -----------------------------
    // Call Tracking / Inspection (existing)
    // -----------------------------
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
      .authorization((allow) => [allow.authenticated()]),

    CallTracking: a
      .model({
        customerName: a.string().required(),
        phone: a.string().required(),
        source: a.string(),
        outcome: a.enum(["NO_ANSWER", "ANSWERED", "BOOKED", "FOLLOW_UP", "NOT_INTERESTED"]),
        followUpAt: a.datetime(),
        notes: a.string(),
        createdBy: a.string(),
        createdAt: a.datetime(),
      })
      .authorization((allow) => [allow.authenticated()]),

    InspectionApproval: a
      .model({
        jobCardId: a.string(),
        customerName: a.string().required(),
        vehicle: a.string(),
        inspectionNotes: a.string(),
        amountQuoted: a.float(),
        status: a.enum(["PENDING", "APPROVED", "REJECTED"]),
        createdBy: a.string(),
        createdAt: a.datetime(),
        approvedBy: a.string(),
        approvedAt: a.datetime(),
      })
      .authorization((allow) => [allow.authenticated()]),

    // -----------------------------
    // ADMIN MUTATIONS / QUERIES
    // -----------------------------
    inviteUser: a
      .mutation()
      .arguments({
        email: a.string().required(),
        fullName: a.string().required(),
        mobileNumber: a.string(),
        departmentKey: a.string().required(),
        departmentName: a.string(),
      })
      .authorization((allow) => [allow.group(ADMIN_GROUP)])
      .handler(a.handler.function(inviteUser))
      .returns(a.json()),

    adminSetUserActive: a
      .mutation()
      .arguments({
        email: a.string().required(),
        isActive: a.boolean().required(),
      })
      .authorization((allow) => [allow.group(ADMIN_GROUP)])
      .handler(a.handler.function(setUserActive))
      .returns(a.json()),

    adminDeleteUser: a
      .mutation()
      .arguments({ email: a.string().required() })
      .authorization((allow) => [allow.group(ADMIN_GROUP)])
      .handler(a.handler.function(deleteUser))
      .returns(a.json()),

    adminListDepartments: a
      .query()
      .authorization((allow) => [allow.group(ADMIN_GROUP)])
      .handler(a.handler.function(listDepartments))
      .returns(a.json()),

    adminCreateDepartment: a
      .mutation()
      .arguments({ departmentName: a.string().required() })
      .authorization((allow) => [allow.group(ADMIN_GROUP)])
      .handler(a.handler.function(createDepartment))
      .returns(a.json()),

    adminDeleteDepartment: a
      .mutation()
      .arguments({ departmentKey: a.string().required() })
      .authorization((allow) => [allow.group(ADMIN_GROUP)])
      .handler(a.handler.function(deleteDepartment))
      .returns(a.json()),

    adminRenameDepartment: a
      .mutation()
      .arguments({
        oldKey: a.string().required(),
        newName: a.string().required(),
      })
      .authorization((allow) => [allow.group(ADMIN_GROUP)])
      .handler(a.handler.function(renameDepartment))
      .returns(a.json()),

    adminSetUserDepartment: a
      .mutation()
      .arguments({
        email: a.string().required(),
        departmentKey: a.string().required(),
        departmentName: a.string(),
      })
      .authorization((allow) => [allow.group(ADMIN_GROUP)])
      .handler(a.handler.function(setUserDepartment))
      .returns(a.json()),

    myGroups: a
      .query()
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(myGroups))
      .returns(a.json()),

    // -----------------------------
    // ✅ Job Orders mutations (RBAC enforced inside Lambda)
    // Policy key expected in RolePolicy.policyKey: "JOB_CARDS"
    // -----------------------------
    jobOrderSave: a
      .mutation()
      .arguments({
        input: a.json().required(), // AWSJSON (string or object)
      })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(jobOrderSave))
      .returns(a.json()),

    jobOrderDelete: a
      .mutation()
      .arguments({
        id: a.string().required(),
      })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(jobOrderDelete))
      .returns(a.json()),
  })
  .authorization((allow) => [
    allow.resource(inviteUser),
    allow.resource(setUserActive),
    allow.resource(deleteUser),
    allow.resource(listDepartments),
    allow.resource(createDepartment),
    allow.resource(deleteDepartment),
    allow.resource(renameDepartment),
    allow.resource(setUserDepartment),
    allow.resource(myGroups),

    // job orders functions need data access
    allow.resource(jobOrderSave),
    allow.resource(jobOrderDelete),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
