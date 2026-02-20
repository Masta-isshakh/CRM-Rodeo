// permissionMap.ts
export type PermissionKey = `${string}.${string}`;

/**
 * Map your current UI option IDs to backend policy keys.
 * Admin can assign these policies to roles.
 */
export const PERMISSION_MAP: Record<string, PermissionKey> = {
  // --- Job Order module page access
  "joborder.joborder_viewdetails": "page.jobOrders.view",
  "joborder.joborder_actions": "jobOrder.update",
  "joborder.joborder_add": "jobOrder.create",
  "joborder.joborder_cancel": "jobOrder.update",

  // --- Details page sections
  "joborder.joborder_summary": "page.jobOrders.view",
  "joborder.joborder_customer": "page.jobOrders.view",
  "joborder.joborder_vehicle": "page.jobOrders.view",
  "joborder.joborder_services": "page.jobOrders.view",
  "joborder.joborder_billing": "page.jobOrders.view",
  "joborder.joborder_paymentlog": "page.jobOrders.view",

  // --- Add service / pricing/discount fine-grained
  "joborder.joborder_addservice": "jobOrder.update",
  "joborder.joborder_serviceprice": "jobOrder.service.price.view",
  "joborder.joborder_servicediscount": "jobOrder.service.discount.view",
  "joborder.joborder_servicediscount_percent": "jobOrder.service.discount.edit",
};