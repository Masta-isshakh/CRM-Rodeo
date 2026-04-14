// src/pages/RoleAccessControl.tsx
import { useEffect, useMemo, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import SuccessPopup from "./SuccessPopup";
import "./RoleAccessControl.css";
import { getDataClient } from "../lib/amplifyClient";
import { resolveActorUsername } from "../utils/actorIdentity";
import { resolvePolicyAndOp } from "./PermissionGate";

function normalizeKey(x: unknown) {
  return String(x ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

function optKey(moduleId: string, optionId: string) {
  return `${normalizeKey(moduleId)}::${normalizeKey(optionId)}`;
}

async function listAll<T>(
  listFn: (args: any) => Promise<any>,
  pageSize = 1000,
  max = 20000
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | null | undefined = undefined;

  while (out.length < max) {
    const res = await listFn({ limit: pageSize, nextToken });
    out.push(...((res?.data ?? []) as T[]));
    nextToken = res?.nextToken;
    if (!nextToken) break;
  }
  return out.slice(0, max);
}

/**
 * ✅ Add *_list options for ANY sidebar page you want to hide/show.
 * Your PermissionGate optionIds already exist for JobOrder/Payment/etc.
 */
const MODULE_DEFINITIONS = [
  {
    id: "dashboard",
    title: "Dashboard",
    icon: "fas fa-gauge-high",
    category: "core",
    options: [
      { id: "dashboard_list", label: "Show Dashboard in sidebar", prefix: "-" },
      { id: "dashboard_kpis", label: "KPI Cards", prefix: "a." },
      { id: "dashboard_quicknav", label: "Quick Navigation", prefix: "b." },
      { id: "dashboard_revenue", label: "Revenue Summary", prefix: "c." },
      { id: "dashboard_activity", label: "Activity Feed", prefix: "d." },
      { id: "dashboard_calendar", label: "Calendar Widget", prefix: "e." },
    ],
  },
{
  id: "customers",
  title: "Customers",
  icon: "fas fa-users",
  category: "core",
  options: [
    { id: "customers_list", label: "Show Customers page in sidebar", prefix: "-" },

    { id: "customers_search", label: "Search & Filter", prefix: "a." },
    { id: "customers_refresh", label: "Refresh Button", prefix: "b." },
    { id: "customers_add", label: "Add New Customer Button", prefix: "c." },

    { id: "customers_actions", label: "Row Actions Dropdown", prefix: "d." },
    { id: "customers_viewdetails", label: "View Details", prefix: "e." },
    { id: "customers_edit", label: "Edit Customer", prefix: "f." },
    { id: "customers_delete", label: "Delete Customer", prefix: "g." },

    { id: "customers_details_info", label: "Details: Customer Information Card", prefix: "-" },
    { id: "customers_details_related", label: "Details: Related Records Card", prefix: "-" },
    { id: "customers_related_contacts", label: "Related Records: Contacts Section", prefix: "-" },
    { id: "customers_related_deals", label: "Related Records: Deals Section", prefix: "-" },
    { id: "customers_related_tickets", label: "Related Records: Tickets Section", prefix: "-" },
  ],
},
  {
    id: "vehicles",
    title: "Vehicles",
    icon: "fas fa-car",
    category: "core",
    options: [
      { id: "vehicles_list", label: "Show Vehicles in sidebar", prefix: "-" },
      { id: "vehicles_search", label: "Search & Filter", prefix: "a." },
      { id: "vehicles_add", label: "Add Vehicle", prefix: "b." },
      { id: "vehicles_viewdetails", label: "View Vehicle Details", prefix: "c." },
      { id: "vehicles_edit", label: "Edit Vehicle", prefix: "d." },
      { id: "vehicles_delete", label: "Delete Vehicle", prefix: "e." },
      { id: "vehicles_verifycustomer", label: "Verify Customer", prefix: "f." },
    ],
  },
  {
    id: "tickets",
    title: "Tickets",
    icon: "fas fa-ticket",
    category: "core",
    options: [
      { id: "tickets_list", label: "Show Tickets in sidebar", prefix: "-" },
      { id: "tickets_create", label: "Create Ticket", prefix: "a." },
      { id: "tickets_refresh", label: "Refresh", prefix: "b." },
      { id: "tickets_edit", label: "Edit Ticket", prefix: "c." },
      { id: "tickets_delete", label: "Delete Ticket", prefix: "d." },
    ],
  },
  {
    id: "employees",
    title: "Employees",
    icon: "fas fa-id-badge",
    category: "core",
    options: [
      { id: "employees_list", label: "Show Employees in sidebar", prefix: "-" },
      { id: "employees_add", label: "Add Employee", prefix: "a." },
      { id: "employees_edit", label: "Edit Employee", prefix: "b." },
      { id: "employees_delete", label: "Delete Employee", prefix: "c." },
      { id: "employees_refresh", label: "Refresh", prefix: "d." },
    ],
  },
  {
    id: "activitylog",
    title: "Activity Log",
    icon: "fas fa-clipboard",
    category: "core",
    options: [
      { id: "activitylog_list", label: "Show Activity Log in sidebar", prefix: "-" },
      { id: "activitylog_view", label: "View Activity Logs", prefix: "a." },
    ],
  },
  {
    id: "calltracking",
    title: "Call Tracking",
    icon: "fas fa-phone",
    category: "core",
    options: [
      { id: "calltracking_list", label: "Show Call Tracking in sidebar", prefix: "-" },
      { id: "calltracking_create", label: "Create Call Record", prefix: "a." },
      { id: "calltracking_refresh", label: "Refresh", prefix: "b." },
      { id: "calltracking_edit", label: "Edit Call Record", prefix: "c." },
      { id: "calltracking_delete", label: "Delete Call Record", prefix: "d." },
    ],
  },

  // ✅ Job Order page (your JOB_CARDS family)
  {
    id: "joborder",
    title: "Job Order Management",
    icon: "fas fa-clipboard-list",
    category: "core",
    options: [
      { id: "joborder_list", label: "Show Job Order page in sidebar", prefix: "-" },

      { id: "joborder_add", label: "Add New Job Order Button", prefix: "a." },
      { id: "joborder_actions", label: "Action Buttons", prefix: "b." },
      { id: "joborder_viewdetails", label: "View Details", prefix: "c." },
      { id: "joborder_summary", label: "Job Order Summary", prefix: "-" },
      { id: "joborder_customer", label: "Customer Information", prefix: "-" },
      { id: "joborder_vehicle", label: "Vehicle Information", prefix: "-" },
      { id: "joborder_services", label: "Services Summary", prefix: "-" },
      { id: "joborder_billing", label: "Billing Section", prefix: "-" },
      { id: "joborder_quality", label: "Quality Section", prefix: "-" },
      { id: "joborder_delivery", label: "Delivery Section", prefix: "-" },
      { id: "joborder_paymentlog", label: "Payment Log", prefix: "-" },
      { id: "joborder_roadmap", label: "Roadmap", prefix: "-" },
      { id: "joborder_documents", label: "Documents", prefix: "-" },
      { id: "joborder_download", label: "Download Document", prefix: "-" },
      { id: "joborder_addservice", label: "Add Service Button", prefix: "-" },
      { id: "joborder_serviceprice", label: "View Service Price", prefix: "-" },
      {
        kind: "percent",
        id: "joborder_discount_percent",
        label: "Central Max Discount %",
        prefix: "-",
        defaultValue: 20,
      },

      { id: "joborder_cancel", label: "Cancel Order", prefix: "-" },
    ],
  },

  {
    id: "jobhistory",
    title: "Job History",
    icon: "fas fa-clock-rotate-left",
    category: "core",
    options: [
      { id: "jobhistory_list", label: "Show Job History page in sidebar", prefix: "-" },
      { id: "jobhistory_view", label: "View History", prefix: "a." },
      { id: "jobhistory_export", label: "Export History", prefix: "b." },
      { id: "jobhistory_summary", label: "Job Order Summary", prefix: "-" },
      { id: "jobhistory_customer", label: "Customer Information", prefix: "-" },
      { id: "jobhistory_vehicle", label: "Vehicle Information", prefix: "-" },
      { id: "jobhistory_roadmap", label: "Roadmap", prefix: "-" },
      { id: "jobhistory_services", label: "Services", prefix: "-" },
      { id: "jobhistory_notes", label: "Customer Notes", prefix: "-" },
      { id: "jobhistory_billing", label: "Billing", prefix: "-" },
      { id: "jobhistory_paymentlog", label: "Payment Log", prefix: "-" },
      { id: "jobhistory_exitpermit", label: "Exit Permit", prefix: "-" },
      { id: "jobhistory_documents", label: "Documents", prefix: "-" },
      { id: "jobhistory_download", label: "Download Document", prefix: "-" },
    ],
  },

  {
    id: "serviceexec",
    title: "Service Execution",
    icon: "fas fa-screwdriver-wrench",
    category: "core",
    options: [
      { id: "serviceexec_list", label: "Show Service Execution page in sidebar", prefix: "-" },
      { id: "serviceexec_actions", label: "Actions", prefix: "a." },
      { id: "serviceexec_unassigned_tab", label: "Unassigned Tasks Tab", prefix: "a.1" },
      { id: "serviceexec_team_tab", label: "Team Tasks Tab", prefix: "a.2" },
      { id: "serviceexec_summary", label: "Job Order Summary", prefix: "-" },
      { id: "serviceexec_roadmap", label: "Roadmap", prefix: "-" },
      { id: "serviceexec_customer", label: "Customer Information", prefix: "-" },
      { id: "serviceexec_vehicle", label: "Vehicle Information", prefix: "-" },
      { id: "serviceexec_services", label: "Services", prefix: "-" },
      { id: "serviceexec_notes", label: "Customer Notes", prefix: "-" },
      { id: "serviceexec_quality", label: "Quality", prefix: "-" },
      { id: "serviceexec_billing", label: "Billing", prefix: "-" },
      { id: "serviceexec_paymentlog", label: "Payment Log", prefix: "-" },
      { id: "serviceexec_exitpermit", label: "Exit Permit", prefix: "-" },
      { id: "serviceexec_documents", label: "Documents", prefix: "-" },
      { id: "serviceexec_edit", label: "Edit Service", prefix: "b." },
      { id: "serviceexec_assign", label: "Assign Service", prefix: "b.1" },
      { id: "serviceexec_addservice", label: "Add Service", prefix: "c." },
      { id: "serviceexec_finish", label: "Finish Service", prefix: "d." },
    ],
  },

  {
    id: "inspection",
    title: "Inspection",
    icon: "fas fa-magnifying-glass",
    category: "core",
    options: [
      { id: "inspection_list", label: "Show Inspection page in sidebar", prefix: "-" },
      { id: "inspection_actions", label: "Actions", prefix: "a." },
      { id: "inspection_viewdetails", label: "View Details", prefix: "b." },
      { id: "inspection_summary", label: "Summary", prefix: "-" },
      { id: "inspection_services", label: "Services", prefix: "-" },
      { id: "inspection_start", label: "Start", prefix: "c." },
      { id: "inspection_resume", label: "Resume", prefix: "d." },
      { id: "inspection_complete", label: "Complete", prefix: "e." },
      { id: "inspection_notrequired", label: "Not Required", prefix: "f." },
      { id: "inspection_finish", label: "Finish", prefix: "g." },
      { id: "inspection_addservice", label: "Add Service", prefix: "h." },
      { id: "inspection_cancel", label: "Cancel", prefix: "i." },
    ],
  },

  {
    id: "payment",
    title: "Payment & Invoices",
    icon: "fas fa-file-invoice-dollar",
    category: "financial",
    options: [
      { id: "payment_list", label: "Show Payment & Invoices page in sidebar", prefix: "-" },

      { id: "payment_actions", label: "Actions Dropdown", prefix: "a." },
      { id: "payment_viewdetails", label: "View Details", prefix: "b." },
      { id: "payment_pay", label: "Record Payment Button", prefix: "c." },
      { id: "payment_generatebill", label: "Generate Bill", prefix: "-" },
      { id: "payment_refund", label: "Refund", prefix: "-" },
      { id: "payment_cancel", label: "Cancel Order", prefix: "-" },

      { id: "payment_customer", label: "Customer Card", prefix: "-" },
      { id: "payment_vehicle", label: "Vehicle Card", prefix: "-" },
      { id: "payment_services", label: "Service Approvals", prefix: "-" },
      { id: "payment_billing", label: "Billing Section", prefix: "-" },
      { id: "payment_invoices", label: "Invoices Section", prefix: "-" },
      { id: "payment_paymentlog", label: "Payment Log", prefix: "-" },
      { id: "payment_documents", label: "Documents Section", prefix: "-" },
      { id: "payment_download", label: "Download Button", prefix: "-" },
    ],
  },

  {
    id: "qualitycheck",
    title: "Quality Check",
    icon: "fas fa-check-double",
    category: "core",
    options: [
      { id: "qualitycheck_list", label: "Show Quality Check page in sidebar", prefix: "-" },
      { id: "qualitycheck_actions", label: "Actions", prefix: "a." },
      { id: "qualitycheck_viewdetails", label: "View Details", prefix: "-" },
      { id: "qualitycheck_summary", label: "Summary", prefix: "-" },
      { id: "qualitycheck_roadmap", label: "Roadmap", prefix: "-" },
      { id: "qualitycheck_customer", label: "Customer Information", prefix: "-" },
      { id: "qualitycheck_vehicle", label: "Vehicle Information", prefix: "-" },
      { id: "qualitycheck_services", label: "Services", prefix: "-" },
      { id: "qualitycheck_quality", label: "Quality Checklist", prefix: "-" },
      { id: "qualitycheck_billing", label: "Billing", prefix: "-" },
      { id: "qualitycheck_paymentlog", label: "Payment Log", prefix: "-" },
      { id: "qualitycheck_documents", label: "Documents", prefix: "-" },
      { id: "qualitycheck_download", label: "Download", prefix: "-" },
      { id: "qualitycheck_finish", label: "Finish QC", prefix: "-" },
      { id: "qualitycheck_approve", label: "Approve", prefix: "-" },
      { id: "qualitycheck_reject", label: "Reject", prefix: "-" },
      { id: "qualitycheck_cancel", label: "Cancel Order", prefix: "-" },
    ],
  },

  {
    id: "exitpermit",
    title: "Exit Permit",
    icon: "fas fa-door-open",
    category: "core",
    options: [
      { id: "exitpermit_list", label: "Show Exit Permit page in sidebar", prefix: "-" },
      { id: "exitpermit_actions", label: "Actions", prefix: "a." },
      { id: "exitpermit_viewdetails", label: "View Details", prefix: "-" },
      { id: "exitpermit_summary", label: "Summary", prefix: "-" },
      { id: "exitpermit_customer", label: "Customer Information", prefix: "-" },
      { id: "exitpermit_vehicle", label: "Vehicle Information", prefix: "-" },
      { id: "exitpermit_services", label: "Services", prefix: "-" },
      { id: "exitpermit_billing", label: "Billing", prefix: "-" },
      { id: "exitpermit_quality", label: "Quality", prefix: "-" },
      { id: "exitpermit_paymentlog", label: "Payment Log", prefix: "-" },
      { id: "exitpermit_exitpermit", label: "Exit Permit Details", prefix: "-" },
      { id: "exitpermit_notes", label: "Customer Notes", prefix: "-" },
      { id: "exitpermit_roadmap", label: "Roadmap", prefix: "-" },
      { id: "exitpermit_documents", label: "Documents", prefix: "-" },
      { id: "exitpermit_download", label: "Download", prefix: "-" },
      { id: "exitpermit_create", label: "Create Exit Permit", prefix: "-" },
      { id: "exitpermit_cancelorder", label: "Cancel Order", prefix: "-" },
    ],
  },

  {
    id: "approvalhistory",
    title: "Approval History",
    icon: "fas fa-list-check",
    category: "core",
    options: [{ id: "approvalhistory_view", label: "View Approval History", prefix: "-" }],
  },

  {
    id: "inventory",
    title: "Inventory",
    icon: "fas fa-boxes-stacked",
    category: "core",
    options: [
      { id: "inventory_list",          label: "Show Inventory page in sidebar",               prefix: "-"  },
      { id: "inventory_categories",    label: "View / Manage Categories",                     prefix: "a." },
      { id: "inventory_subcategories", label: "View / Manage Subcategories",                  prefix: "b." },
      { id: "inventory_products",      label: "View Products",                                prefix: "c." },
      { id: "inventory_add_quantity",  label: "Add Products by Quantity",                     prefix: "d." },
      { id: "inventory_scan",          label: "Add Products by Scanning",                     prefix: "e." },
      { id: "inventory_fields",        label: "Manage Custom Fields",                         prefix: "f." },
      { id: "inventory_delete",        label: "Delete Categories / Subcategories / Products", prefix: "g." },
      { id: "inventory_store",         label: "Show Store (Checkout) Tab",                    prefix: "h." },
      { id: "inventory_checkout",      label: "Check Out Products from Store",                prefix: "i." },
    ],
  },

  {
    id: "admin",
    title: "Inspection Config Admin",
    icon: "fas fa-sliders",
    category: "core",
    options: [{ id: "inspection_config_admin", label: "Inspection Config Admin Access", prefix: "-" }],
  },

  {
    id: "users",
    title: "Users Admin",
    icon: "fas fa-user-gear",
    category: "core",
    options: [
      { id: "users_list", label: "Show Users page in sidebar", prefix: "-" },
      { id: "users_view", label: "View Users List", prefix: "a." },
      { id: "users_invite", label: "Invite User", prefix: "b." },
      { id: "users_edit", label: "Edit User / Department", prefix: "c." },
      { id: "users_delete", label: "Delete User", prefix: "d." },
      { id: "users_show_root_admin", label: "Show Root Admin User", prefix: "e." },
    ],
  },

  {
    id: "departments",
    title: "Departments Admin",
    icon: "fas fa-building",
    category: "core",
    options: [
      { id: "departments_list", label: "Show Departments page in sidebar", prefix: "-" },
      { id: "departments_create", label: "Create Department", prefix: "a." },
      { id: "departments_rename", label: "Rename Department", prefix: "b." },
      { id: "departments_assignrole", label: "Assign/Remove Role", prefix: "c." },
      { id: "departments_delete", label: "Delete Department", prefix: "d." },
    ],
  },

  {
    id: "rolespolicies",
    title: "Roles & Policies Admin",
    icon: "fas fa-user-shield",
    category: "core",
    options: [{ id: "rolespolicies_list", label: "Show Roles & Policies page in sidebar", prefix: "-" }],
  },
] as const;

type PermissionsState = Record<
  string,
  {
    enabled: boolean;
    options: Record<string, boolean>;
  }
>;

type CrudPermission = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
};

const EMPTY_CRUD: CrudPermission = {
  canRead: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canApprove: false,
};

function computeRolePoliciesFromOptions(state: PermissionsState): {
  computed: Record<string, CrudPermission>;
  managedPolicyKeys: Set<string>;
} {
  const computed: Record<string, CrudPermission> = {};
  const managedPolicyKeys = new Set<string>();

  for (const mod of MODULE_DEFINITIONS as any) {
    const moduleId = String(mod.id);
    const moduleEnabled = Boolean(state[moduleId]?.enabled);

    for (const opt of mod.options ?? []) {
      if (opt.kind === "percent") continue;

      const rule = resolvePolicyAndOp(moduleId, String(opt.id));
      if (!rule?.policyKey || !rule?.op) continue;

      const policyKey = normalizeKey(rule.policyKey);
      managedPolicyKeys.add(policyKey);

      const optionEnabled = moduleEnabled && Boolean(state[moduleId]?.options?.[opt.id]);
      if (!optionEnabled) continue;

      const current = computed[policyKey] ?? { ...EMPTY_CRUD };
      current[rule.op] = true;
      computed[policyKey] = current;
    }
  }

  return { computed, managedPolicyKeys };
}

const buildDefaultPermissions = (): PermissionsState => {
  const base: PermissionsState = {};
  for (const mod of MODULE_DEFINITIONS as any) {
    base[mod.id] = { enabled: true, options: {} };
    for (const opt of mod.options ?? []) {
      if (opt.kind === "percent") continue;
      base[mod.id].options[opt.id] = true;
    }
  }
  return base;
};

// ✅ percent defaults by FULL KEY
const buildPercentDefaults = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const mod of MODULE_DEFINITIONS as any) {
    for (const opt of mod.options ?? []) {
      if (opt.kind === "percent") out[optKey(mod.id, opt.id)] = Number(opt.defaultValue ?? 0);
    }
  }
  return out;
};

function clampPercent(n: any, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return Math.max(0, Math.min(100, fallback));
  return Math.max(0, Math.min(100, v));
}

async function runInBatches(
  tasks: Array<() => Promise<any>>,
  batchSize = 20,
  onProgress?: (completed: number, total: number) => void
) {
  const total = tasks.length;
  let completed = 0;

  onProgress?.(completed, total);

  for (let i = 0; i < tasks.length; i += batchSize) {
    const chunk = tasks.slice(i, i + batchSize).map((job) =>
      (async () => {
        try {
          return await job();
        } finally {
          completed += 1;
          onProgress?.(completed, total);
        }
      })()
    );
    const results = await Promise.allSettled(chunk);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) throw failed.reason;
  }
}

const OptionNode = ({
  moduleId,
  option,
  level,
  moduleEnabled,
  permissions,
  onToggleOption,
  percentValues,
  onPercentChange,
  parentEnabled,
}: any) => {
  const isPercent = option.kind === "percent";

  const parentOn = parentEnabled !== false;
  const storedToggle = Boolean(permissions?.[moduleId]?.options?.[option.id]);

  const effectiveEnabled = isPercent
    ? moduleEnabled && parentOn
    : moduleEnabled && parentOn && storedToggle;

  const disabled = !moduleEnabled || !parentOn;

  const percentKey = optKey(moduleId, option.id);
  const percentVal = percentValues[percentKey];

  return (
    <div className={`rac-option rac-level-${level} ${effectiveEnabled ? "" : "rac-disabled"}`}>
      <div className="rac-option-row">
        <div className="rac-option-label">
          {option.prefix && <span className="rac-option-prefix">{option.prefix}</span>}
          <span>{option.label}</span>
        </div>

        {!isPercent && (
          <label className="rac-toggle">
            <input
              type="checkbox"
              checked={storedToggle}
              disabled={disabled}
              onChange={(event) => onToggleOption(moduleId, option.id, event.target.checked)}
            />
            <span className="rac-slider" />
          </label>
        )}

        {isPercent && (
          <div className="rac-percent-field">
            <input
              type="number"
              min="0"
              max="100"
              value={Number.isFinite(percentVal) ? percentVal : Number(option.defaultValue ?? 0)}
              disabled={disabled}
              onChange={(event) => onPercentChange(moduleId, option.id, event.target.value)}
            />
            <span>%</span>
          </div>
        )}
      </div>

      {option.children && (
        <div className="rac-children">
          {option.children.map((child: any) => (
            <OptionNode
              key={child.id}
              moduleId={moduleId}
              option={child}
              level={level + 1}
              moduleEnabled={moduleEnabled}
              permissions={permissions}
              onToggleOption={onToggleOption}
              percentValues={percentValues}
              onPercentChange={onPercentChange}
              parentEnabled={effectiveEnabled}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function RoleAccessControl() {
  const client = useMemo(() => getDataClient(), []);
  const [loading, setLoading] = useState(false);

  const [roles, setRoles] = useState<any[]>([]);
  const [currentRoleId, setCurrentRoleId] = useState<string>("");

  const [permissions, setPermissions] = useState<PermissionsState>(() => buildDefaultPermissions());
  const [percentValues, setPercentValues] = useState<Record<string, number>>(() => buildPercentDefaults());
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

  const [activeCategory, setActiveCategory] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  // ✅ Create Role UI
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [saveProgress, setSaveProgress] = useState({ active: false, completed: 0, total: 0 });

  const showMsg = (msg: string) => {
    setSuccessMessage(msg);
    setShowSuccessPopup(true);
  };

  const loadRoles = async () => {
    const res = await client.models.AppRole.list({ limit: 1000 });
    const list = res.data ?? [];
    setRoles(list);
    if (!currentRoleId && list.length) setCurrentRoleId(String(list[0].id));
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadRoles();
      } catch (e: any) {
        console.error(e);
        showMsg(`Failed to load roles: ${e?.message ?? "Unknown error"}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!currentRoleId) return;
    (async () => {
      setLoading(true);
      try {
        const [toggles, nums] = await Promise.all([
          (async () => {
            try {
              const q = await (client.models as any).RoleOptionToggle.roleOptionTogglesByRole?.({
                roleId: String(currentRoleId),
                limit: 500,
              });
              return (q?.data ?? []) as any[];
            } catch {
              return await listAll<any>(
                (args) =>
                  (client.models as any).RoleOptionToggle.list({
                    ...args,
                    filter: { roleId: { eq: currentRoleId } },
                  }),
                1000,
                20000
              );
            }
          })(),
          (async () => {
            try {
              const q = await (client.models as any).RoleOptionNumber.roleOptionNumbersByRole?.({
                roleId: String(currentRoleId),
                limit: 500,
              });
              return (q?.data ?? []) as any[];
            } catch {
              return await listAll<any>(
                (args) =>
                  (client.models as any).RoleOptionNumber.list({
                    ...args,
                    filter: { roleId: { eq: currentRoleId } },
                  }),
                1000,
                20000
              );
            }
          })(),
        ]);

        const toggleMap = new Map<string, boolean>();
        for (const t of toggles ?? []) toggleMap.set(normalizeKey(t.key), Boolean(t.enabled));

        const numMap = new Map<string, number>();
        for (const n of nums ?? []) {
          const v = Number(n.value);
          if (Number.isFinite(v)) numMap.set(normalizeKey(n.key), v);
        }

        const nextPerms = buildDefaultPermissions();
        const nextPercents = buildPercentDefaults();

        for (const mod of MODULE_DEFINITIONS as any) {
          const modEnabledKey = optKey(mod.id, "__enabled");
          if (toggleMap.has(modEnabledKey)) nextPerms[mod.id].enabled = Boolean(toggleMap.get(modEnabledKey));

          for (const opt of mod.options ?? []) {
            if (opt.kind === "percent") {
              const k = optKey(mod.id, opt.id);
              const fallback = Number(opt.defaultValue ?? 0);
              const stored = numMap.has(k) ? numMap.get(k) : nextPercents[k];
              nextPercents[k] = clampPercent(stored, fallback);
              continue;
            }

            const k = optKey(mod.id, opt.id);
            if (toggleMap.has(k)) nextPerms[mod.id].options[opt.id] = Boolean(toggleMap.get(k));
          }
        }

        setPermissions(nextPerms);
        setPercentValues(nextPercents);
        setExpandedModules({});
      } catch (e: any) {
        console.error(e);
        showMsg(`Failed to load role settings: ${e?.message ?? "Unknown error"}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentRoleId, client]);

  const selectedRole = useMemo(
    () => roles.find((r) => String(r.id) === String(currentRoleId)),
    [roles, currentRoleId]
  );

  const modulesWithSearchIndex = useMemo(() => {
    const walk = (options: any[]): string[] => {
      const out: string[] = [];
      for (const o of options ?? []) {
        out.push(String(o.label ?? "").toLowerCase());
        if (o.children) out.push(...walk(o.children));
      }
      return out;
    };

    return (MODULE_DEFINITIONS as any).map((module: any) => ({
      ...module,
      searchIndex: [String(module.title ?? "").toLowerCase(), ...walk(module.options ?? [])],
    }));
  }, []);

  const visibleModules = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return modulesWithSearchIndex.filter((module: any) => {
      const matchesCategory = activeCategory === "all" || module.category === activeCategory;
      const matchesSearch = term.length === 0 || module.searchIndex.some((label: string) => label.includes(term));
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchTerm, modulesWithSearchIndex]);

  const handleToggleModule = (moduleId: string) => {
    setExpandedModules((prev) => ({ ...prev, [moduleId]: !prev[moduleId] }));
  };

  const handleToggleModuleEnabled = (moduleId: string, enabled: boolean) => {
    setPermissions((prev) => {
      const next = { ...prev };
      next[moduleId] = { ...prev[moduleId], enabled, options: { ...prev[moduleId].options } };
      return next;
    });
  };

  const handleToggleOption = (moduleId: string, optionId: string, enabled: boolean) => {
    setPermissions((prev) => ({
      ...prev,
      [moduleId]: {
        ...prev[moduleId],
        options: { ...prev[moduleId].options, [optionId]: enabled },
      },
    }));
  };

  const handlePercentChange = (moduleId: string, optionId: string, value: any) => {
    const k = optKey(moduleId, optionId);
    const v = value === "" ? NaN : Number(value);
    setPercentValues((prev) => ({
      ...prev,
      [k]: Number.isFinite(v) ? v : prev[k],
    }));
  };

  // ✅ Create role (AppRole)
  const createRole = async () => {
    const name = String(newRoleName || "").trim();
    const description = String(newRoleDesc || "").trim();

    if (!name) {
      showMsg("Role name is required.");
      return;
    }

    setLoading(true);
    try {
      const now = new Date().toISOString();
      await client.models.AppRole.create({
        name,
        description: description || undefined,
        isActive: true,
        createdAt: now,
      } as any);

      setShowCreateRole(false);
      setNewRoleName("");
      setNewRoleDesc("");

      await loadRoles();
      showMsg(`Role created: ${name}`);
    } catch (e: any) {
      console.error(e);
      showMsg(`Create role failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  // ✅ Save to backend
  const handleSave = async () => {
    if (!currentRoleId) return;
    setLoading(true);
    setSaveProgress({ active: true, completed: 0, total: 0 });
    const startedAt = Date.now();

    try {
      const [existingToggles, existingNums, existingPolicies] = await Promise.all([
        (async () => {
          try {
            const q = await (client.models as any).RoleOptionToggle.roleOptionTogglesByRole?.({
              roleId: String(currentRoleId),
              limit: 2000,
            });
            return (q?.data ?? []) as any[];
          } catch {
            return await listAll<any>(
              (args) =>
                (client.models as any).RoleOptionToggle.list({
                  ...args,
                  filter: { roleId: { eq: currentRoleId } },
                }),
              1000,
              20000
            );
          }
        })(),
        (async () => {
          try {
            const q = await (client.models as any).RoleOptionNumber.roleOptionNumbersByRole?.({
              roleId: String(currentRoleId),
              limit: 2000,
            });
            return (q?.data ?? []) as any[];
          } catch {
            return await listAll<any>(
              (args) =>
                (client.models as any).RoleOptionNumber.list({
                  ...args,
                  filter: { roleId: { eq: currentRoleId } },
                }),
              1000,
              20000
            );
          }
        })(),
        listAll<any>(
          (args) =>
            (client.models as any).RolePolicy.list({
              ...args,
              filter: { roleId: { eq: currentRoleId } },
            }),
          1000,
          20000
        ),
      ]);

      const toggleByKey = new Map<string, any>();
      for (const t of existingToggles ?? []) toggleByKey.set(normalizeKey(t.key), t);

      const numByKey = new Map<string, any>();
      for (const n of existingNums ?? []) numByKey.set(normalizeKey(n.key), n);

      const now = new Date().toISOString();
      const me = await getCurrentUser().catch(() => null);
      const actor = resolveActorUsername(me, "admin");

      const desiredToggleKeys = new Set<string>();
      const desiredNumKeys = new Set<string>();
      const toggleWriteTasks: Array<() => Promise<any>> = [];
      const numWriteTasks: Array<() => Promise<any>> = [];
      const policyWriteTasks: Array<() => Promise<any>> = [];
      const cleanupTasks: Array<() => Promise<any>> = [];

      const { computed: computedPolicies, managedPolicyKeys } = computeRolePoliciesFromOptions(permissions);

      for (const mod of MODULE_DEFINITIONS as any) {
        // module enabled toggle
        {
          const k = optKey(mod.id, "__enabled");
          desiredToggleKeys.add(k);

          const enabled = Boolean(permissions[mod.id]?.enabled);
          const existing = toggleByKey.get(k);

          if (existing?.id) {
            const oldEnabled = Boolean(existing?.enabled);
            if (oldEnabled !== enabled) {
              toggleWriteTasks.push(() =>
                (client.models as any).RoleOptionToggle.update({
                  id: existing.id,
                  enabled,
                  updatedAt: now,
                  updatedBy: actor,
                })
              );
            }
          } else {
            toggleWriteTasks.push(() =>
              (client.models as any).RoleOptionToggle.create({
                roleId: currentRoleId,
                key: k,
                enabled,
                createdAt: now,
                updatedAt: now,
                updatedBy: actor,
              })
            );
          }
        }

        for (const opt of mod.options ?? []) {
          if (opt.kind === "percent") {
            const k = optKey(mod.id, opt.id);
            desiredNumKeys.add(k);

            const fallback = Number(opt.defaultValue ?? 0);
            const v = clampPercent(percentValues[k], fallback);

            const existing = numByKey.get(k);
            if (existing?.id) {
              const oldValue = Number(existing?.value);
              if (!Number.isFinite(oldValue) || oldValue !== v) {
                numWriteTasks.push(() =>
                  (client.models as any).RoleOptionNumber.update({
                    id: existing.id,
                    value: v,
                    updatedAt: now,
                    updatedBy: actor,
                  })
                );
              }
            } else {
              numWriteTasks.push(() =>
                (client.models as any).RoleOptionNumber.create({
                  roleId: currentRoleId,
                  key: k,
                  value: v,
                  createdAt: now,
                  updatedAt: now,
                  updatedBy: actor,
                })
              );
            }
            continue;
          }

          const k = optKey(mod.id, opt.id);
          desiredToggleKeys.add(k);

          const enabled = Boolean(permissions[mod.id]?.options?.[opt.id]);
          const existing = toggleByKey.get(k);

          if (existing?.id) {
            const oldEnabled = Boolean(existing?.enabled);
            if (oldEnabled !== enabled) {
              toggleWriteTasks.push(() =>
                (client.models as any).RoleOptionToggle.update({
                  id: existing.id,
                  enabled,
                  updatedAt: now,
                  updatedBy: actor,
                })
              );
            }
          } else {
            toggleWriteTasks.push(() =>
              (client.models as any).RoleOptionToggle.create({
                roleId: currentRoleId,
                key: k,
                enabled,
                createdAt: now,
                updatedAt: now,
                updatedBy: actor,
              })
            );
          }
        }
      }

      // delete stale rows
      for (const row of existingToggles ?? []) {
        const k = normalizeKey(row.key);
        if (!desiredToggleKeys.has(k) && row?.id) {
          cleanupTasks.push(() => (client.models as any).RoleOptionToggle.delete({ id: row.id }));
        }
      }
      for (const row of existingNums ?? []) {
        const k = normalizeKey(row.key);
        if (!desiredNumKeys.has(k) && row?.id) {
          cleanupTasks.push(() => (client.models as any).RoleOptionNumber.delete({ id: row.id }));
        }
      }

      const existingPolicyByKey = new Map<string, any>();
      for (const row of existingPolicies ?? []) {
        const key = normalizeKey(row?.policyKey);
        if (key) existingPolicyByKey.set(key, row);
      }

      for (const policyKey of managedPolicyKeys) {
        const target = computedPolicies[policyKey] ?? EMPTY_CRUD;
        const existing = existingPolicyByKey.get(policyKey);

        if (existing?.id) {
          const nextRead = Boolean(target.canRead);
          const nextCreate = Boolean(target.canCreate);
          const nextUpdate = Boolean(target.canUpdate);
          const nextDelete = Boolean(target.canDelete);
          const nextApprove = Boolean(target.canApprove);

          const changed =
            Boolean(existing?.canRead) !== nextRead ||
            Boolean(existing?.canCreate) !== nextCreate ||
            Boolean(existing?.canUpdate) !== nextUpdate ||
            Boolean(existing?.canDelete) !== nextDelete ||
            Boolean(existing?.canApprove) !== nextApprove;

          if (changed) {
            policyWriteTasks.push(() =>
              (client.models as any).RolePolicy.update({
                id: existing.id,
                canRead: nextRead,
                canCreate: nextCreate,
                canUpdate: nextUpdate,
                canDelete: nextDelete,
                canApprove: nextApprove,
              })
            );
          }
        } else {
          policyWriteTasks.push(() =>
            (client.models as any).RolePolicy.create({
              roleId: currentRoleId,
              policyKey,
              canRead: Boolean(target.canRead),
              canCreate: Boolean(target.canCreate),
              canUpdate: Boolean(target.canUpdate),
              canDelete: Boolean(target.canDelete),
              canApprove: Boolean(target.canApprove),
              createdAt: now,
            })
          );
        }
      }

      const allWriteTasks = [
        ...toggleWriteTasks,
        ...numWriteTasks,
        ...policyWriteTasks,
        ...cleanupTasks,
      ];

      if (allWriteTasks.length > 0) {
        await runInBatches(allWriteTasks, 25, (completed, total) => {
          setSaveProgress({ active: true, completed, total });
        });
      } else {
        setSaveProgress({ active: true, completed: 0, total: 0 });
      }

      window.dispatchEvent(new Event("rbac:refresh"));
      const elapsedMs = Date.now() - startedAt;
      const elapsedSec = (elapsedMs / 1000).toFixed(1);
      showMsg(`Saved role permissions for: ${selectedRole?.name ?? currentRoleId} (${elapsedSec}s)`);
    } catch (e: any) {
      console.error(e);
      showMsg(`Save failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setLoading(false);
      setSaveProgress((prev) => ({ ...prev, active: false }));
    }
  };

  // ✅ Reset: delete all role option rows
  const handleReset = async () => {
    if (!currentRoleId) return;
    const ok = window.confirm("Reset option permissions for this role (delete stored settings)?");
    if (!ok) return;

    setLoading(true);
    try {
      const [existingToggles, existingNums] = await Promise.all([
        listAll<any>(
          (args) =>
            (client.models as any).RoleOptionToggle.list({
              ...args,
              filter: { roleId: { eq: currentRoleId } },
            }),
          1000,
          20000
        ),
        listAll<any>(
          (args) =>
            (client.models as any).RoleOptionNumber.list({
              ...args,
              filter: { roleId: { eq: currentRoleId } },
            }),
          1000,
          20000
        ),
      ]);

      for (const row of existingToggles ?? []) {
        if (row?.id) await (client.models as any).RoleOptionToggle.delete({ id: row.id });
      }
      for (const row of existingNums ?? []) {
        if (row?.id) await (client.models as any).RoleOptionNumber.delete({ id: row.id });
      }

      setPermissions(buildDefaultPermissions());
      setPercentValues(buildPercentDefaults());
      setExpandedModules({});

      window.dispatchEvent(new Event("rbac:refresh"));
      showMsg("Option permissions reset to defaults (backend rows removed).");
    } catch (e: any) {
      console.error(e);
      showMsg(`Reset failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rac-page">
      <style>{`
        .rac-page, .rac-page * {
          color: #000 !important;
        }
        .rac-page .rac-create-role-btn,
        .rac-page .rac-create-role-btn * {
          color: #fff !important;
        }
      `}</style>
      <div className="rac-container">
        <header className="rac-header">
          <div>
            <h1>Role Access Control</h1>
            <p>Manage option-level permissions stored in backend (RoleOptionToggle / RoleOptionNumber)</p>
          </div>
        </header>

        <section className="rac-role-section">
          <div className="rac-role-selector">
            <div>
              <label htmlFor="rac-role-select">Select Role to Modify:</label>
              <select
                id="rac-role-select"
                value={currentRoleId}
                onChange={(e) => setCurrentRoleId(e.target.value)}
                disabled={loading}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="rac-current-role">
              <i className="fas fa-user-shield" />
              Currently editing: <span>{selectedRole?.name ?? "—"}</span>
            </div>

          </div>
        </section>

        <div className="rac-search-box">
          <i className="fas fa-search" />
          <input
            type="text"
            placeholder="Search permissions... (discount, view details, create, cancel...)"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div className="rac-tabs">
          {[
            { id: "all", label: "All Modules" },
            { id: "core", label: "Core Operations" },
            { id: "financial", label: "Financial" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rac-tab ${activeCategory === tab.id ? "active" : ""}`}
              onClick={() => setActiveCategory(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <section className="rac-modules">
          {visibleModules.map((module: any) => {
            const moduleState = permissions[module.id] || { enabled: false, options: {} };
            const isExpanded = !!expandedModules[module.id];

            return (
              <div
                key={module.id}
                className={`rac-module-card ${moduleState.enabled ? "" : "rac-module-disabled"}`}
              >
                <div
                  className={`rac-module-header ${isExpanded ? "expanded" : ""}`}
                  onClick={() => handleToggleModule(module.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleToggleModule(module.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="rac-module-title">
                    <i className={module.icon} />
                    <span>{module.title}</span>
                    <span className={`rac-status-indicator ${moduleState.enabled ? "enabled" : "disabled"}`} />
                  </div>

                  <div className="rac-module-toggle" onClick={(e) => e.stopPropagation()}>
                    <span className="rac-toggle-label">Enable/Disable</span>
                    <label className="rac-toggle">
                      <input
                        type="checkbox"
                        checked={moduleState.enabled}
                        onChange={(event) => handleToggleModuleEnabled(module.id, event.target.checked)}
                      />
                      <span className="rac-slider" />
                    </label>
                    <i className="fas fa-chevron-down rac-expand-icon" />
                  </div>
                </div>

                <div className={`rac-module-content ${isExpanded ? "expanded" : ""}`}>
                  {(module.options ?? []).map((option: any) => (
                    <OptionNode
                      key={option.id}
                      moduleId={module.id}
                      option={option}
                      level={1}
                      moduleEnabled={moduleState.enabled}
                      permissions={permissions}
                      onToggleOption={handleToggleOption}
                      percentValues={percentValues}
                      onPercentChange={handlePercentChange}
                      parentEnabled={moduleState.enabled}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <section className="rac-actions">
          <button type="button" className="rac-btn rac-btn-ghost" onClick={handleReset} disabled={loading}>
            <i className="fas fa-undo" /> Reset (delete backend rows)
          </button>

          <div className="rac-save-wrap">
            <button type="button" className="rac-btn rac-btn-primary" onClick={handleSave} disabled={loading}>
              <i className="fas fa-save" /> {loading
                ? `Saving changes... (${saveProgress.completed}/${saveProgress.total || "?"})`
                : "Save to Backend"}
            </button>

            {loading && saveProgress.active && saveProgress.total > 0 && (
              <div className="rac-save-progress" aria-live="polite">
                <div className="rac-save-progress-text">
                  Saving changes... ({saveProgress.completed}/{saveProgress.total})
                </div>
                <div className="rac-save-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={saveProgress.total} aria-valuenow={saveProgress.completed}>
                  <div
                    className="rac-save-progress-fill"
                    style={{ width: `${Math.max(0, Math.min(100, (saveProgress.completed / saveProgress.total) * 100))}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Create role modal (inline styles so you don't need new CSS) */}
      {showCreateRole && (
        <div
          onClick={() => setShowCreateRole(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              borderRadius: 16,
              border: "1px solid rgba(15,23,42,0.12)",
              background: "#ffffff",
              boxShadow: "0 18px 50px rgba(15,23,42,0.20)",
              padding: 16,
              color: "#0f172a",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Create New Role</div>
              <button
                type="button"
                onClick={() => setShowCreateRole(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "rgba(15,23,42,0.65)",
                  fontSize: 18,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: "rgba(15,23,42,0.65)", marginBottom: 6 }}>Role Name *</div>
                <input
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="e.g. Cashier"
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: 12,
                    border: "1px solid rgba(15,23,42,0.14)",
                    background: "#fff",
                    color: "#0f172a",
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, color: "rgba(15,23,42,0.65)", marginBottom: 6 }}>Description</div>
                <input
                  value={newRoleDesc}
                  onChange={(e) => setNewRoleDesc(e.target.value)}
                  placeholder="Optional"
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: 12,
                    border: "1px solid rgba(15,23,42,0.14)",
                    background: "#fff",
                    color: "#0f172a",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 6 }}>
                <button
                  type="button"
                  className="rac-btn rac-btn-ghost"
                  onClick={() => setShowCreateRole(false)}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rac-btn rac-btn-primary rac-create-role-btn"
                  onClick={() => void createRole()}
                  disabled={loading}
                >
                  <i className="fas fa-plus" /> {loading ? "Creating..." : "Create Role"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <SuccessPopup isVisible={showSuccessPopup} onClose={() => setShowSuccessPopup(false)} message={successMessage} />
    </div>
  );
}