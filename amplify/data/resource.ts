// amplify/data/resource.ts
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

// ✅ Payments module (separate model + audited mutations)
import { jobOrderPaymentCreate } from "../functions/job-orders/create-payment/resource";
import { jobOrderPaymentUpdate } from "../functions/job-orders/update-payment/resource";
import { jobOrderPaymentDelete } from "../functions/job-orders/delete-payment/resource";

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
      .authorization((allow) => [allow.ownerDefinedIn("profileOwner"), allow.group(ADMIN_GROUP)]),

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
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

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
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

    DepartmentRoleLink: a
      .model({
        departmentKey: a.string().required(),
        departmentName: a.string(),
        roleId: a.id().required(),
        createdAt: a.datetime(),
      })
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),


    // ✅ OPTION-LEVEL RBAC (CORRECTLY PLACED)
    RoleOptionToggle: a
      .model({
        roleId: a.id().required(),
        key: a.string().required(), // "PAYMENT::PAYMENT_PAY"
        enabled: a.boolean().default(true),
        createdAt: a.datetime(),
        updatedAt: a.datetime(),
        updatedBy: a.string(),
      })
      .secondaryIndexes((index) => [index("roleId").queryField("roleOptionTogglesByRole")])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

    RoleOptionNumber: a
      .model({
        roleId: a.id().required(),
        key: a.string().required(), // "PAYMENT::PAYMENT_DISCOUNT_PERCENT"
        value: a.float().required(),
        createdAt: a.datetime(),
        updatedAt: a.datetime(),
        updatedBy: a.string(),
      })
      .secondaryIndexes((index) => [index("roleId").queryField("roleOptionNumbersByRole")])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

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
        vehicles: a.hasMany("Vehicle", "customerId"),
      })
      .secondaryIndexes((index) => [
        index("phone").queryField("customersByPhone"),
        index("email").queryField("customersByEmail"),
        index("name").queryField("customersByName"),
        index("lastname").queryField("customersByLastname"),
      ])
      .authorization((allow) => [allow.authenticated()]),

    Vehicle: a
      .model({
        vehicleId: a.string().required(),
        customerId: a.id().required(),
        ownedBy: a.string().required(),

        make: a.string().required(),
        model: a.string().required(),
        year: a.string(),
        vehicleType: a.string(),
        color: a.string(),
        plateNumber: a.string().required(),
        vin: a.string(),
        notes: a.string(),

        completedServicesCount: a.integer().default(0),

        createdBy: a.string(),
        createdAt: a.datetime(),
        updatedAt: a.datetime(),

        customer: a.belongsTo("Customer", "customerId"),
      })
      .secondaryIndexes((index) => [
        index("customerId").queryField("vehiclesByCustomer"),
        index("plateNumber").queryField("vehiclesByPlateNumber"),
      ])
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
    // Job Orders
    // -----------------------------
    JobOrder: a
      .model({
        orderNumber: a.string().required(),
        orderType: a.string(),
        status: a.enum(["DRAFT", "OPEN", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"]),
        paymentStatus: a.enum(["UNPAID", "PARTIAL", "PAID"]),

        workStatusLabel: a.string(),
        paymentStatusLabel: a.string(),

        customerId: a.id(),
        customerName: a.string().required(),
        customerPhone: a.string(),
        customerEmail: a.string(),

        vehicleType: a.enum(["SEDAN", "SUV_4X4", "TRUCK", "MOTORBIKE", "OTHER"]),
        vehicleMake: a.string(),
        vehicleModel: a.string(),
        vehicleYear: a.string(),
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

        billId: a.string(),
        netAmount: a.float(),
        paymentMethod: a.string(),

        expectedDeliveryDate: a.date(),
        expectedDeliveryTime: a.string(),
        customerNotes: a.string(),

        notes: a.string(),
        dataJson: a.string(),

        payments: a.hasMany("JobOrderPayment", "jobOrderId"),
        servicesItems: a.hasMany("JobOrderServiceItem", "jobOrderId"),
        invoicesItems: a.hasMany("JobOrderInvoice", "jobOrderId"),
        roadmapItems: a.hasMany("JobOrderRoadmapStep", "jobOrderId"),
        docsItems: a.hasMany("JobOrderDocumentItem", "jobOrderId"),

        // ✅ REQUIRED inverse relations (fixes Inspection belongsTo CDK errors)
        inspectionStates: a.hasMany("InspectionState", "jobOrderId"),
        inspectionPhotos: a.hasMany("InspectionPhoto", "jobOrderId"),
        inspectionReports: a.hasMany("InspectionReport", "jobOrderId"),

        // ✅ Service approvals (optional but recommended)
        serviceApprovalRequests: a.hasMany("ServiceApprovalRequest", "jobOrderId"),

        createdBy: a.string(),
        createdAt: a.datetime(),
        updatedAt: a.datetime(),
      })
      .secondaryIndexes((index) => [
        index("orderNumber").queryField("jobOrdersByOrderNumber"),
        index("plateNumber").queryField("jobOrdersByPlateNumber"),
        index("status").queryField("jobOrdersByStatus"),
      ])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

    // -----------------------------
    // ✅ INSPECTION MODULE
    // -----------------------------
    InspectionConfig: a
      .model({
        configKey: a.string().required(),
        version: a.integer().default(1),
        isActive: a.boolean().default(true),
        configJson: a.string().required(),
        updatedBy: a.string(),
        updatedAt: a.datetime(),
        createdAt: a.datetime(),
      })
      .secondaryIndexes((index) => [index("configKey").queryField("inspectionConfigsByKey")])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

    InspectionState: a
      .model({
        jobOrderId: a.id().required(),
        orderNumber: a.string().required(),
        status: a.enum(["IN_PROGRESS", "PAUSED", "COMPLETED", "NOT_REQUIRED"]),
        stateJson: a.string().required(),

        startedAt: a.datetime(),
        completedAt: a.datetime(),

        createdAt: a.datetime(),
        createdBy: a.string(),
        updatedAt: a.datetime(),
        updatedBy: a.string(),

        jobOrder: a.belongsTo("JobOrder", "jobOrderId"),
      })
      .secondaryIndexes((index) => [
        index("jobOrderId").queryField("inspectionStatesByJobOrder"),
        index("orderNumber").queryField("inspectionStatesByOrderNumber"),
      ])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read", "create", "update"])]),

    InspectionPhoto: a
      .model({
        jobOrderId: a.id().required(),
        orderNumber: a.string().required(),

        sectionKey: a.string().required(),
        itemId: a.string().required(),

        storagePath: a.string().required(),
        fileName: a.string(),
        contentType: a.string(),
        size: a.integer(),

        createdAt: a.datetime(),
        createdBy: a.string(),

        jobOrder: a.belongsTo("JobOrder", "jobOrderId"),
      })
      .secondaryIndexes((index) => [
        index("jobOrderId").queryField("listInspectionPhotosByJobOrder"),
        index("orderNumber").queryField("inspectionPhotosByOrderNumber"),
      ])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read", "create", "update"])]),

    InspectionReport: a
      .model({
        jobOrderId: a.id().required(),
        orderNumber: a.string().required(),

        html: a.string().required(),
        createdAt: a.datetime(),
        createdBy: a.string(),
        updatedAt: a.datetime(),
        updatedBy: a.string(),

        jobOrder: a.belongsTo("JobOrder", "jobOrderId"),
      })
      .secondaryIndexes((index) => [
        index("jobOrderId").queryField("inspectionReportsByJobOrder"),
        index("orderNumber").queryField("inspectionReportsByOrderNumber"),
      ])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read", "create", "update"])]),

    // -----------------------------
    // ✅ SERVICE APPROVAL REQUESTS
    // -----------------------------
    ServiceApprovalRequest: a
      .model({
        jobOrderId: a.id().required(),
        orderNumber: a.string().required(),

        serviceId: a.string().required(),
        serviceName: a.string().required(),
        price: a.float().default(0),

        requestedBy: a.string(),
        requestedAt: a.datetime(),

        status: a.enum(["PENDING", "APPROVED", "REJECTED"]),

        decidedBy: a.string(),
        decidedAt: a.datetime(),
        decisionNote: a.string(),

        jobOrder: a.belongsTo("JobOrder", "jobOrderId"),
      })
      .secondaryIndexes((index) => [
        index("jobOrderId").queryField("serviceApprovalRequestsByJobOrder"),
        index("status").queryField("serviceApprovalRequestsByStatus"),
        index("orderNumber").queryField("serviceApprovalRequestsByOrderNumber"),
      ])
      .authorization((allow) => [
        allow.group(ADMIN_GROUP),
        allow.authenticated().to(["read", "create", "update"]),
      ]),

    // -----------------------------
    // JobOrderManagement normalized tables
    // -----------------------------
    JobOrderServiceItem: a
      .model({
        jobOrderId: a.id().required(),
        name: a.string().required(),
        qty: a.integer().default(1),
        unitPrice: a.float().default(0),
        price: a.float().default(0),

        status: a.string(),
        started: a.string(),
        ended: a.string(),
        duration: a.string(),
        technician: a.string(),
        notes: a.string(),

        createdAt: a.datetime(),
        updatedAt: a.datetime(),

        jobOrder: a.belongsTo("JobOrder", "jobOrderId"),
      })
      .secondaryIndexes((index) => [index("jobOrderId").queryField("listServicesByJobOrder")])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

    JobOrderInvoice: a
      .model({
        jobOrderId: a.id().required(),
        number: a.string().required(),
        amount: a.float().default(0),
        discount: a.float().default(0),
        status: a.string(),
        paymentMethod: a.string(),
        createdAt: a.datetime(),

        jobOrder: a.belongsTo("JobOrder", "jobOrderId"),
        services: a.hasMany("JobOrderInvoiceService", "invoiceId"),
      })
      .secondaryIndexes((index) => [index("jobOrderId").queryField("listInvoicesByJobOrder")])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

    JobOrderInvoiceService: a
      .model({
        invoiceId: a.id().required(),
        jobOrderId: a.id().required(),
        serviceName: a.string().required(),

        invoice: a.belongsTo("JobOrderInvoice", "invoiceId"),
      })
      .secondaryIndexes((index) => [
        index("invoiceId").queryField("listInvoiceServicesByInvoice"),
        index("jobOrderId").queryField("listInvoiceServicesByJobOrder"),
      ])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

    JobOrderRoadmapStep: a
      .model({
        jobOrderId: a.id().required(),
        step: a.string().required(),
        stepStatus: a.string(),
        startTimestamp: a.string(),
        endTimestamp: a.string(),
        actionBy: a.string(),
        status: a.string(),
        createdAt: a.datetime(),

        jobOrder: a.belongsTo("JobOrder", "jobOrderId"),
      })
      .secondaryIndexes((index) => [index("jobOrderId").queryField("listRoadmapByJobOrder")])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

    JobOrderDocumentItem: a
      .model({
        jobOrderId: a.id().required(),
        title: a.string().required(),
        url: a.string(),
        storagePath: a.string(),
        type: a.string(),
        addedAt: a.string(),
        fileName: a.string(),
        contentType: a.string(),
        size: a.integer(),
        linkedPaymentId: a.string(),
        paymentMethod: a.string(),
        createdAt: a.datetime(),

        jobOrder: a.belongsTo("JobOrder", "jobOrderId"),
      })
      .secondaryIndexes((index) => [index("jobOrderId").queryField("listDocsByJobOrder")])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

    JobOrderPayment: a
      .model({
        jobOrderId: a.id().required(),
        amount: a.float().required(),
        method: a.string(),
        reference: a.string(),
        paidAt: a.datetime().required(),
        notes: a.string(),
        createdBy: a.string(),
        createdAt: a.datetime(),
        updatedAt: a.datetime(),

        jobOrder: a.belongsTo("JobOrder", "jobOrderId"),
      })
      .secondaryIndexes((index) => [index("jobOrderId").queryField("listPaymentsByJobOrder")])
      .authorization((allow) => [allow.group(ADMIN_GROUP), allow.authenticated().to(["read"])]),

    // -----------------------------
    // Existing legacy/demo models
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
    // Job Orders mutations (RBAC enforced inside Lambda)
    // -----------------------------
    jobOrderSave: a
      .mutation()
      .arguments({ input: a.json().required() })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(jobOrderSave))
      .returns(a.json()),

    jobOrderDelete: a
      .mutation()
      .arguments({ id: a.string().required() })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(jobOrderDelete))
      .returns(a.json()),

    // -----------------------------
    // Payments mutations (RBAC enforced inside Lambda)
    // -----------------------------
    jobOrderPaymentCreate: a
      .mutation()
      .arguments({
        jobOrderId: a.string().required(),
        amount: a.float().required(),
        method: a.string(),
        reference: a.string(),
        paidAt: a.datetime(),
        notes: a.string(),
      })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(jobOrderPaymentCreate))
      .returns(a.json()),

    jobOrderPaymentUpdate: a
      .mutation()
      .arguments({
        id: a.string().required(),
        amount: a.float().required(),
        method: a.string(),
        reference: a.string(),
        paidAt: a.datetime(),
        notes: a.string(),
      })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(jobOrderPaymentUpdate))
      .returns(a.json()),

    jobOrderPaymentDelete: a
      .mutation()
      .arguments({ id: a.string().required() })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(jobOrderPaymentDelete))
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

    allow.resource(jobOrderSave),
    allow.resource(jobOrderDelete),

    allow.resource(jobOrderPaymentCreate),
    allow.resource(jobOrderPaymentUpdate),
    allow.resource(jobOrderPaymentDelete),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});