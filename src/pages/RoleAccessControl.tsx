import { useEffect, useMemo, useState } from "react";
import SuccessPopup from "./SuccessPopup";
import "./RoleAccessControl.css";
import { getDataClient } from "../lib/amplifyClient";

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

/* =========================
   ✅ YOUR MODULE DEFINITIONS
   (keep your huge MODULE_DEFINITIONS as-is)
========================= */

const MODULE_DEFINITIONS = [
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
      { id: "joborder_addservice", label: "Add Service Button", prefix: "-" },
      { id: "joborder_serviceprice", label: "View Service Price", prefix: "-" },
      { id: "joborder_servicediscount", label: "Service Discount", prefix: "-" },
      {
        kind: "percent",
        id: "joborder_servicediscount_percent",
        label: "Max Service Discount %",
        prefix: "-",
        defaultValue: 15,
      },
      {
        kind: "percent",
        id: "joborder_discount_percent",
        label: "Max Job Order Discount %",
        prefix: "-",
        defaultValue: 20,
      },
      { id: "joborder_cancel", label: "Cancel Order", prefix: "-" },
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
      { id: "qualitycheck_quality", label: "Quality Checklist", prefix: "-" },
      { id: "qualitycheck_finish", label: "Finish QC", prefix: "-" },
      { id: "qualitycheck_approve", label: "Approve", prefix: "-" },
      { id: "qualitycheck_reject", label: "Reject", prefix: "-" },
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
      { id: "exitpermit_create", label: "Create Exit Permit", prefix: "-" },
      { id: "exitpermit_cancelorder", label: "Cancel Order", prefix: "-" },
    ],
  },
] as const;

/* =========================
   Helpers
========================= */

type PermissionsState = Record<
  string,
  {
    enabled: boolean;
    options: Record<string, boolean>;
  }
>;

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

// ✅ IMPORTANT: store percent defaults by FULL KEY (MODULE::OPTION)
const buildPercentDefaults = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const mod of MODULE_DEFINITIONS as any) {
    for (const opt of mod.options ?? []) {
      if (opt.kind === "percent") {
        out[optKey(mod.id, opt.id)] = Number(opt.defaultValue ?? 0);
      }
    }
  }
  return out;
};

function clampPercent(n: any, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return Math.max(0, Math.min(100, fallback));
  return Math.max(0, Math.min(100, v));
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

  const parentOn = parentEnabled !== false; // default true
  const storedToggle = Boolean(permissions?.[moduleId]?.options?.[option.id]);

  // ✅ effective enabled state for styling
  const effectiveEnabled = isPercent
    ? moduleEnabled && parentOn
    : moduleEnabled && parentOn && storedToggle;

  // ✅ disable checkbox/field if module or parent is off
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

  const showSuccessMessage = (msg: string) => {
    setSuccessMessage(msg);
    setShowSuccessPopup(true);
  };

  // Load roles
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await client.models.AppRole.list({ limit: 1000 });
        const list = res.data ?? [];
        setRoles(list);

        if (!currentRoleId && list.length) {
          setCurrentRoleId(String(list[0].id));
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load settings for selected role
  useEffect(() => {
    if (!currentRoleId) return;

    (async () => {
      setLoading(true);
      try {
        // ✅ prefer index queryField if exists
        const [toggles, nums] = await Promise.all([
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
              if (numMap.has(k)) {
                nextPercents[k] = clampPercent(numMap.get(k), Number(opt.defaultValue ?? 0));
              } else {
                nextPercents[k] = clampPercent(nextPercents[k], Number(opt.defaultValue ?? 0));
              }
              continue;
            }

            const k = optKey(mod.id, opt.id);
            if (toggleMap.has(k)) nextPerms[mod.id].options[opt.id] = Boolean(toggleMap.get(k));
          }
        }

        setPermissions(nextPerms);
        setPercentValues(nextPercents);
        setExpandedModules({});
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

  const handleSave = async () => {
    if (!currentRoleId) return;
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

      const toggleByKey = new Map<string, any>();
      for (const t of existingToggles ?? []) toggleByKey.set(normalizeKey(t.key), t);

      const numByKey = new Map<string, any>();
      for (const n of existingNums ?? []) numByKey.set(normalizeKey(n.key), n);

      const now = new Date().toISOString();
      const actor = "admin";

      const desiredToggleKeys = new Set<string>();
      const desiredNumKeys = new Set<string>();

      for (const mod of MODULE_DEFINITIONS as any) {
        // module enabled toggle
        {
          const k = optKey(mod.id, "__enabled");
          desiredToggleKeys.add(k);

          const enabled = Boolean(permissions[mod.id]?.enabled);
          const existing = toggleByKey.get(k);

          if (existing?.id) {
            await (client.models as any).RoleOptionToggle.update({
              id: existing.id,
              enabled,
              updatedAt: now,
              updatedBy: actor,
            });
          } else {
            await (client.models as any).RoleOptionToggle.create({
              roleId: currentRoleId,
              key: k,
              enabled,
              createdAt: now,
              updatedAt: now,
              updatedBy: actor,
            });
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
              await (client.models as any).RoleOptionNumber.update({
                id: existing.id,
                value: v,
                updatedAt: now,
                updatedBy: actor,
              });
            } else {
              await (client.models as any).RoleOptionNumber.create({
                roleId: currentRoleId,
                key: k,
                value: v,
                createdAt: now,
                updatedAt: now,
                updatedBy: actor,
              });
            }
            continue;
          }

          const k = optKey(mod.id, opt.id);
          desiredToggleKeys.add(k);

          const enabled = Boolean(permissions[mod.id]?.options?.[opt.id]);
          const existing = toggleByKey.get(k);

          if (existing?.id) {
            await (client.models as any).RoleOptionToggle.update({
              id: existing.id,
              enabled,
              updatedAt: now,
              updatedBy: actor,
            });
          } else {
            await (client.models as any).RoleOptionToggle.create({
              roleId: currentRoleId,
              key: k,
              enabled,
              createdAt: now,
              updatedAt: now,
              updatedBy: actor,
            });
          }
        }
      }

      // delete stale rows
      for (const row of existingToggles ?? []) {
        const k = normalizeKey(row.key);
        if (!desiredToggleKeys.has(k) && row?.id) {
          await (client.models as any).RoleOptionToggle.delete({ id: row.id });
        }
      }
      for (const row of existingNums ?? []) {
        const k = normalizeKey(row.key);
        if (!desiredNumKeys.has(k) && row?.id) {
          await (client.models as any).RoleOptionNumber.delete({ id: row.id });
        }
      }

      window.dispatchEvent(new Event("rbac:refresh"));

      showSuccessMessage(`Saved option permissions for role: ${selectedRole?.name ?? currentRoleId}`);
    } catch (e: any) {
      console.error(e);
      showSuccessMessage(`Save failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

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
      showSuccessMessage("Option permissions reset to defaults (backend rows removed).");
    } catch (e: any) {
      console.error(e);
      showSuccessMessage(`Reset failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rac-page">
      <div className="rac-container">
        <header className="rac-header">
          <div>
            <h1>Role Access Control</h1>
            <p>Manage option-level permissions stored in backend (RoleOptionToggle / RoleOptionNumber)</p>
          </div>
        </header>

        <section className="rac-role-section">
          <div className="rac-role-selector">
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
            { id: "management", label: "Management" },
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
          {visibleModules.map((module: any, index: number) => {
            const moduleState = permissions[module.id] || { enabled: false, options: {} };
            const isExpanded = !!expandedModules[module.id];

            return (
              <div
                key={module.id}
                className={`rac-module-card ${moduleState.enabled ? "" : "rac-module-disabled"}`}
                style={{ animationDelay: `${index * 0.04}s` }}
              >
                <div
                  className={`rac-module-header ${isExpanded ? "expanded" : ""}`}
                  onClick={() => handleToggleModule(module.id)}
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

          <button type="button" className="rac-btn rac-btn-primary" onClick={handleSave} disabled={loading}>
            <i className="fas fa-save" /> {loading ? "Saving..." : "Save to Backend"}
          </button>
        </section>
      </div>

      <SuccessPopup
        isVisible={showSuccessPopup}
        onClose={() => setShowSuccessPopup(false)}
        message={successMessage}
      />
    </div>
  );
}