// src/pages/serviceexecution/ServiceSummaryCard.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  FaGripVertical,
  FaUserTie,
  FaUsers,
  FaEdit,
  FaSave,
  FaCheckDouble,
  FaPlusCircle,
  FaWrench,
} from "react-icons/fa";
import "./ServiceExecutionModule.css"

import PermissionGate from "./PermissionGate";
import { useApprovalRequests } from "./ApprovalRequestsContext";

type ServiceStatus =
  | "Pending"
  | "Inprogress"
  | "Completed"
  | "Postponed"
  | "Cancelled"
  | "Pending Approval";

export type Service = {
  id: string;
  order: number;
  name: string;
  price?: number;

  status: ServiceStatus;
  priority?: "low" | "normal" | "high" | "urgent" | string;

  assignedTo: string | null;
  technicians: string[];

  startTime: string | null;
  endTime: string | null;

  started?: string;
  ended?: string;

  requestedAction?: "Postponed" | "Cancelled" | string | null;
  approvalStatus?: "pending" | "approved" | "rejected" | string | null;

  notes?: string;

  [k: string]: unknown;
};

type AssigneeOption = { value: string; label: string };

type Props = {
  jobId: string;
  services: unknown[];
  onServicesReorder: (services: Service[]) => void;
  onServiceUpdate: (serviceId: string, updates: Partial<Service>) => void;
  onAddService: (serviceName: string, price: number) => Promise<unknown>;
  onFinishWork: () => void;
  allServicesCompleted: boolean;
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  availableTechs?: string[];
  availableAssignees?: Array<string | AssigneeOption>;
  jobOrderBackendId?: string;
  orderNumber?: string;
  isAdmin?: boolean;
};

function normalizeIdentity(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function displayServiceStatus(status: string) {
  return status === "Inprogress" ? "Service_Operation" : status;
}

// -------------------------
// ErrorBoundary (prevents “blank page”)
// -------------------------
class CardErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; msg: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, msg: "" };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, msg: String(err?.message ?? err ?? "Unknown error") };
  }
  componentDidCatch(err: any) {
    console.error("ServiceSummaryCard crashed:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, border: "1px solid #ef4444", borderRadius: 10, background: "#fff5f5" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Service Summary crashed</div>
          <div style={{ fontSize: 13, color: "#7f1d1d" }}>{this.state.msg}</div>
          <div style={{ fontSize: 12, marginTop: 8, color: "#7f1d1d" }}>
            Open DevTools Console to see the full stack.
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}

// -------------------------
// Helpers
// -------------------------
function slugify(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50);
}

function stableServiceId(jobId: string, raw: any, idx: number) {
  const fromRaw = String(raw?.id ?? "").trim();
  if (fromRaw) return fromRaw;
  const name = slugify(String(raw?.name ?? `service-${idx + 1}`));
  return `SVC-${jobId}-${idx + 1}-${name || "x"}`;
}

// ✅ also fixes duplicate IDs which break DnD
function normalizeServices(jobId: string, services: unknown[]): Service[] {
  const list = Array.isArray(services) ? services : [];
  const seen = new Map<string, number>();

  return list.map((raw: any, idx: number) => {
    let id = stableServiceId(jobId, raw, idx);
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}-dup${count + 1}`;

    const order = Number(raw?.order ?? idx + 1);

    const startTime = raw?.startTime ?? null;
    const endTime = raw?.endTime ?? null;

    const status: ServiceStatus =
      (raw?.status as ServiceStatus) ||
      (String(raw?.status ?? "").trim() as ServiceStatus) ||
      "Pending";

    return {
      ...raw,
      id,
      order,
      name: String(raw?.name ?? `Service ${idx + 1}`),
      price: typeof raw?.price === "number" ? raw.price : raw?.price ? Number(raw.price) : undefined,

      status,
      assignedTo: (raw?.assignedTo ?? null) as string | null,
      technicians: Array.isArray(raw?.technicians) ? (raw.technicians as string[]) : [],

      startTime,
      endTime,
      started: raw?.started ?? (startTime ? String(startTime) : "Not started"),
      ended: raw?.ended ?? (endTime ? String(endTime) : "Not completed"),

      requestedAction: raw?.requestedAction ?? null,
      approvalStatus: raw?.approvalStatus ?? null,
      notes: raw?.notes ?? "",
    };
  });
}

// -------------------------
// Non-sortable item (safe when editMode=false)
// -------------------------
function ServiceItem({
  service,
  editMode,
  onUpdate,
  availableTechs,
  availableAssignees,
  jobOrderBackendId,
  orderNumber,
  canAssign,
}: {
  service: Service;
  editMode: boolean;
  onUpdate: (serviceId: string, updates: Partial<Service>) => void;
  availableTechs: string[];
  availableAssignees: Array<string | AssigneeOption>;
  jobOrderBackendId?: string;
  orderNumber?: string;
  canAssign: boolean;
}) {
  const approval = useApprovalRequests();

  const [techDropdownOpen, setTechDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) setTechDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const getStatusClass = (status: string) => {
    switch (status) {
      case "Inprogress":
        return "status-inprogress";
      case "Completed":
        return "status-completed";
      case "Cancelled":
        return "status-cancelled";
      case "Postponed":
        return "status-postponed";
      case "Pending Approval":
        return "status-pending-approval";
      default:
        return "status-pending";
    }
  };

  const normalizedAssigneeOptions = useMemo<AssigneeOption[]>(() => {
    const seen = new Set<string>();
    const out: AssigneeOption[] = [];

    for (const item of availableAssignees || []) {
      const value = normalizeIdentity(typeof item === "string" ? item : item?.value);
      const label = String(typeof item === "string" ? item : item?.label ?? item?.value ?? "").trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push({ value, label: label || value });
    }

    return out;
  }, [availableAssignees]);

  const assigneeLabelByValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of normalizedAssigneeOptions) {
      map.set(option.value, option.label);
    }
    return map;
  }, [normalizedAssigneeOptions]);

  const selectedAssignedValue = useMemo(() => {
    const assigned = normalizeIdentity(service.assignedTo);
    if (!assigned) return "";

    if (assigneeLabelByValue.has(assigned)) return assigned;

    const byLabel = normalizedAssigneeOptions.find((opt) => normalizeIdentity(opt.label) === assigned);
    if (byLabel) return byLabel.value;

    return assigned;
  }, [service.assignedTo, normalizedAssigneeOptions, assigneeLabelByValue]);

  const assignedDisplayName = useMemo(() => {
    const assigned = normalizeIdentity(service.assignedTo);
    if (!assigned) return "—";
    return assigneeLabelByValue.get(assigned) ?? String(service.assignedTo);
  }, [service.assignedTo, assigneeLabelByValue]);

  const handleTechChange = (techName: string, checked: boolean) => {
    const updated = new Set(service.technicians || []);
    if (checked) updated.add(techName);
    else updated.delete(techName);
    onUpdate(service.id, { technicians: Array.from(updated) });
  };

  const handleAssignedToChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = normalizeIdentity(e.target.value || "");
    onUpdate(service.id, { assignedTo: v || null });
  };

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value as ServiceStatus;

    if ((newStatus === "Postponed" || newStatus === "Cancelled") && service.status !== newStatus) {
      if (jobOrderBackendId && orderNumber) {
        try {
          await approval.addRequest({
            jobOrderId: jobOrderBackendId,
            orderNumber,
            serviceId: service.id,
            serviceName: service.name,
            price: service.price ?? 0,
            requestedBy: service.assignedTo ?? "Unknown",
          });
        } catch (err) {
          console.warn("addRequest failed (non-fatal):", err);
        }
      }
    }

    const updates: Partial<Service> = { status: newStatus };

    if (newStatus === "Inprogress" && service.status !== "Inprogress" && !service.startTime) {
      const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      updates.startTime = t;
      updates.started = t;
    }

    if (newStatus === "Completed" && service.status !== "Completed" && !service.endTime) {
      const t = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      updates.endTime = t;
      updates.ended = t;
    }

    if (newStatus === "Postponed" || newStatus === "Cancelled") {
      updates.requestedAction = newStatus;
      updates.approvalStatus = "pending";
    } else if (service.status === "Pending Approval" || service.requestedAction || service.approvalStatus) {
      updates.requestedAction = null;
      updates.approvalStatus = null;
    }

    onUpdate(service.id, updates);
  };

  return (
    <div className="service-item">
      <div className="service-header">
        <div className="service-name">
          {/* drag handle only visible in edit mode */}
          <span className="drag-handle" style={{ visibility: editMode ? "visible" : "hidden" }}>
            <FaGripVertical />
          </span>
          {service.name}
        </div>

        <span className={`status-badge ${getStatusClass(service.status)} service-status-badge`}>
          {service.status === "Pending Approval" ? service.requestedAction || "Pending" : displayServiceStatus(service.status)}
        </span>
      </div>

      <div className="service-meta-row">
        <div className="meta-item">
          <span className="meta-label">Start time</span>
          <span className="meta-value">{service.startTime || "—"}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">End time</span>
          <span className="meta-value">{service.endTime || "—"}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Status</span>
          <span className="meta-value">
            {service.status === "Pending Approval" ? service.requestedAction || "Pending" : displayServiceStatus(service.status)}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Assigned to</span>
          <span className="meta-value">{assignedDisplayName}</span>
        </div>
      </div>

      {editMode && (
        <PermissionGate moduleId="serviceexec" optionId="serviceexec_edit">
          <div className="assign-controls edit-controls">
            <div className="control-group">
              <span className="control-label">
                <FaUserTie /> Assigned to
              </span>
              <select className="assigned-select" value={selectedAssignedValue} onChange={handleAssignedToChange} disabled={!canAssign}>
                <option value="">— assign —</option>
                {normalizedAssigneeOptions.map((assignee) => (
                  <option key={assignee.value} value={assignee.value}>
                    {assignee.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="control-group">
              <span className="control-label">
                <FaUsers /> Technicians
              </span>
              <div className="tech-dropdown" ref={dropdownRef}>
                <button type="button" className="tech-dropdown-btn" onClick={() => setTechDropdownOpen((v) => !v)}>
                  <span>{service.technicians?.length ? service.technicians.join(", ") : "Select technicians"}</span>
                  <i className="fas fa-chevron-down"></i>
                </button>

                {techDropdownOpen && (
                  <div className="tech-dropdown-content show">
                    {availableTechs.map((tech, idx) => (
                      <div key={idx} className="tech-option">
                        <input
                          type="checkbox"
                          id={`tech-${service.id}-${idx}`}
                          value={tech}
                          checked={service.technicians?.includes(tech) || false}
                          onChange={(e) => handleTechChange(tech, e.target.checked)}
                        />
                        <label htmlFor={`tech-${service.id}-${idx}`}>{tech}</label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="control-group">
              <span className="control-label">Service work status</span>
              <select className="work-status-select" value={service.status} onChange={handleStatusChange}>
                <option value="Pending">Pending</option>
                <option value="Inprogress">Service_Operation</option>
                <option value="Postponed">Postponed</option>
                <option value="Cancelled">Cancelled</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>
        </PermissionGate>
      )}

      <div className="assigned-tech-section">
        <div className="assigned-tech-title">
          <FaWrench /> Assigned Technicians
        </div>
        <div className="tech-badge-list">
          {service.technicians?.length ? (
            service.technicians.map((tech) => (
              <span key={tech} className="tech-badge">
                {tech}
              </span>
            ))
          ) : (
            <span style={{ color: "var(--dark-gray)" }}>No technicians assigned</span>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------
// Sortable wrapper (only used when editMode=true)
// -------------------------
function SortableServiceItem(props: React.ComponentProps<typeof ServiceItem> & { id: string }) {
  const { id } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {/* inject listeners/attributes into the handle via CSS selector by placing them on wrapper */}
      <div {...attributes} {...listeners}>
        <ServiceItem {...props} />
      </div>
    </div>
  );
}

// -------------------------
// Main Card
// -------------------------
export default function ServiceSummaryCard({
  jobId,
  services,
  onServicesReorder,
  onServiceUpdate,
  onAddService,
  onFinishWork,
  allServicesCompleted,
  editMode,
  setEditMode,
  availableTechs = [],
  availableAssignees = [],
  jobOrderBackendId,
  orderNumber,
  isAdmin = false,
}: Props) {
  const [localServices, setLocalServices] = useState<Service[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const previousJobIdRef = useRef(jobId);

  // ✅ Add Service modal (works even if editMode=false)
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPrice, setAddPrice] = useState<number>(600);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    const jobChanged = previousJobIdRef.current !== jobId;

    if (jobChanged) {
      previousJobIdRef.current = jobId;
      setLocalServices(normalizeServices(jobId, services));
      setHasChanges(false);
      return;
    }

    if (!editMode) {
      setLocalServices(normalizeServices(jobId, services));
      setHasChanges(false);
    }
  }, [jobId, services, editMode]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortedServices = useMemo(() => {
    return [...localServices].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [localServices]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedServices.findIndex((s) => s.id === String(active.id));
    const newIndex = sortedServices.findIndex((s) => s.id === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sortedServices, oldIndex, newIndex).map((s, idx) => ({
      ...s,
      order: idx + 1,
    }));

    setLocalServices(reordered);
    onServicesReorder(reordered);
    setHasChanges(true);
  };

  const handleServiceUpdate = (serviceId: string, updates: Partial<Service>) => {
    setLocalServices((prev) => prev.map((s) => (s.id === serviceId ? ({ ...s, ...updates } as Service) : s)));
    onServiceUpdate(serviceId, updates);
    setHasChanges(true);
  };

  const toggleEditMode = () => {
    const isSavingClick = editMode;
    if (editMode && hasChanges) setHasChanges(false);
    setEditMode(!editMode);
    if (isSavingClick) setShowSavedToast(true);
  };

  useEffect(() => {
    if (!showSavedToast) return;
    const timer = window.setTimeout(() => setShowSavedToast(false), 1800);
    return () => window.clearTimeout(timer);
  }, [showSavedToast]);

  const openAddModal = () => {
    setAddError(null);
    setAddName("");
    setAddPrice(600);
    setAddOpen(true);
  };

  const submitAdd = async () => {
    const name = addName.trim();
    if (!name) {
      setAddError("Service name is required.");
      return;
    }
    const price = Number(addPrice);
    if (!Number.isFinite(price) || price < 0) {
      setAddError("Price must be a valid number.");
      return;
    }

    setAddBusy(true);
    setAddError(null);
    try {
      await onAddService(name, price);
      setAddOpen(false);
    } catch (e: any) {
      setAddError(String(e?.message ?? e ?? "Failed to add service"));
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <div className="pim-detail-card">
      <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <i className="fas fa-tasks"></i> Services Summary ({sortedServices.length || 0})
        </span>

        <span style={{ display: "flex", gap: "10px" }}>
          <PermissionGate moduleId="serviceexec" optionId="serviceexec_edit">
            <button className={`btn-edit-save ${editMode ? "edit-mode" : ""}`} onClick={toggleEditMode}>
              {editMode ? (
                <>
                  <FaSave /> Save
                </>
              ) : (
                <>
                  <FaEdit /> Edit
                </>
              )}
            </button>
          </PermissionGate>

          {isAdmin && (
            <>
              <PermissionGate moduleId="serviceexec" optionId="serviceexec_finish">
                <button className="btn-finish-work" onClick={onFinishWork} disabled={!allServicesCompleted}>
                  <FaCheckDouble /> Finish Work
                </button>
              </PermissionGate>

              <PermissionGate moduleId="serviceexec" optionId="serviceexec_addservice">
                <button className="btn-add-service" onClick={openAddModal}>
                  <FaPlusCircle /> Add service
                </button>
              </PermissionGate>
            </>
          )}
        </span>
      </h3>

      <CardErrorBoundary>
        {editMode && isAdmin && sortedServices.length > 0 ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortedServices.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="services-list">
                {sortedServices.map((service) => (
                  <SortableServiceItem
                    key={service.id}
                    id={service.id}
                    service={service}
                    editMode={editMode}
                    onUpdate={handleServiceUpdate}
                    availableTechs={availableTechs}
                    availableAssignees={availableAssignees}
                    jobOrderBackendId={jobOrderBackendId}
                    orderNumber={orderNumber}
                    canAssign={isAdmin}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="services-list">
            {sortedServices.length > 0 ? (
              sortedServices.map((service) => (
                <ServiceItem
                  key={service.id}
                  service={service}
                  editMode={editMode}
                  onUpdate={handleServiceUpdate}
                  availableTechs={availableTechs}
                  availableAssignees={availableAssignees}
                  jobOrderBackendId={jobOrderBackendId}
                  orderNumber={orderNumber}
                  canAssign={isAdmin}
                />
              ))
            ) : (
              <div style={{ padding: "20px", textAlign: "center", color: "#7f8c8d" }}>No services assigned yet</div>
            )}
          </div>
        )}
      </CardErrorBoundary>

      {showSavedToast && (
        <div className="sem-saved-toast" role="status" aria-live="polite">
          <i className="fas fa-check-circle" /> Saved successfully
        </div>
      )}

      {/* Add Service Modal */}
      {addOpen && (
        <div
          className="sem-modal-overlay"
          onClick={() => {
            if (!addBusy) setAddOpen(false);
          }}
        >
          <div className="sem-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sem-modal-header">
              <div className="sem-modal-title">Add Service</div>
              <button className="sem-modal-close" onClick={() => !addBusy && setAddOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="sem-modal-body">
              <label className="sem-field">
                <span>Service name</span>
                <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. Wheel Protection" />
              </label>

              <label className="sem-field">
                <span>Price (QAR)</span>
                <input type="number" value={addPrice} onChange={(e) => setAddPrice(Number(e.target.value))} />
              </label>

              {addError && <div className="sem-modal-error">{addError}</div>}
            </div>

            <div className="sem-modal-actions">
              <button className="sem-btn sem-btn-ghost" onClick={() => !addBusy && setAddOpen(false)}>
                Cancel
              </button>
              <button className="sem-btn sem-btn-primary" onClick={submitAdd} disabled={addBusy}>
                {addBusy ? "Adding..." : "Create approval request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}