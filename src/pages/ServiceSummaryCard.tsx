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

import PermissionGate from "./PermissionGate";
import { useApprovalRequests } from "./ApprovalRequestsContext";

// -------------------------
// Types
// -------------------------
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
  customer?: string;
  vehicle?: string;

  [k: string]: unknown;
};

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
  availableAssignees?: string[];

  jobOrderBackendId?: string; // JobOrder.id (backend UUID)
  orderNumber?: string;       // JobOrder.orderNumber (JO-xxx)
};

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

function normalizeServices(jobId: string, services: unknown[]): Service[] {
  const list = Array.isArray(services) ? services : [];
  return list.map((raw: any, idx: number) => {
    const id = stableServiceId(jobId, raw, idx);
    const order = Number(raw?.order ?? idx + 1);

    const startTime = raw?.startTime ?? null;
    const endTime = raw?.endTime ?? null;

    const status: ServiceStatus =
      (raw?.status as ServiceStatus) ||
      (String(raw?.status ?? "").trim() as ServiceStatus) ||
      "Pending";

    const assignedTo = (raw?.assignedTo ?? null) as string | null;
    const technicians = Array.isArray(raw?.technicians) ? (raw.technicians as string[]) : [];

    return {
      ...raw,
      id,
      order,
      name: String(raw?.name ?? `Service ${idx + 1}`),
      status,
      assignedTo,
      technicians,
      startTime,
      endTime,
      started: raw?.started ?? (startTime ? String(startTime) : "Not started"),
      ended: raw?.ended ?? (endTime ? String(endTime) : "Not completed"),
      requestedAction: raw?.requestedAction ?? null,
      approvalStatus: raw?.approvalStatus ?? null,
      notes: raw?.notes ?? "",
      price: typeof raw?.price === "number" ? raw.price : raw?.price ? Number(raw.price) : undefined,
    };
  });
}

function getStatusClass(status: string) {
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
}

// =====================================================================
// Read-only item (NO useSortable)  ✅ prevents blank screen crash
// =====================================================================
function ReadOnlyServiceItem({ service }: { service: Service }) {
  return (
    <div className="service-item">
      <div className="service-header">
        <div className="service-name">{service.name}</div>
        <span className={`status-badge ${getStatusClass(service.status)} service-status-badge`}>
          {service.status === "Pending Approval" ? service.requestedAction || "Pending" : service.status}
        </span>
      </div>

      <div className="service-meta-row">
        <div className="meta-item">
          <span className="meta-label">Start time</span>
          <span className="meta-value start-time-display">{service.startTime || "—"}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">End time</span>
          <span className="meta-value end-time-display">{service.endTime || "—"}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Service work status</span>
          <span className="meta-value status-display">
            {service.status === "Pending Approval" ? service.requestedAction || "Pending" : service.status}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Assigned to</span>
          <span className="meta-value assigned-display">{service.assignedTo || "—"}</span>
        </div>
      </div>

      {service.notes ? (
        <div className="service-notes">
          <span className="notes-label">Notes:</span> {service.notes}
        </div>
      ) : null}

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

// =====================================================================
// Sortable item (uses useSortable) ✅ only rendered in editMode
// =====================================================================
function SortableServiceItem(props: {
  service: Service;
  onUpdate: (serviceId: string, updates: Partial<Service>) => void;
  availableTechs: string[];
  availableAssignees: string[];
  jobOrderBackendId?: string;
  orderNumber?: string;
}) {
  const { service, onUpdate, availableTechs, availableAssignees, jobOrderBackendId, orderNumber } = props;

  const approvalCtx = useApprovalRequests() as any;
  const addRequest: (req: any) => any = approvalCtx?.addRequest ?? (() => undefined);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: service.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

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

  const handleTechChange = (techName: string, checked: boolean) => {
    const updated = new Set(service.technicians || []);
    if (checked) updated.add(techName);
    else updated.delete(techName);
    onUpdate(service.id, { technicians: Array.from(updated) });
  };

  const handleAssignedToChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = String(e.target.value || "").trim();
    onUpdate(service.id, { assignedTo: v || null });
  };

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value as ServiceStatus;

    if (
      (newStatus === "Postponed" || newStatus === "Cancelled") &&
      service.status !== "Pending Approval" &&
      service.status !== newStatus
    ) {
      // optional backend request info
      addRequest({
        jobOrderId: jobOrderBackendId,
        orderNumber,
        serviceId: service.id,
        serviceName: service.name,
        price: service.price ?? 0,
        requestedBy: service.assignedTo ?? "Unknown",
        requestedAt: new Date().toISOString(),
        status: "pending",
      });

      onUpdate(service.id, {
        status: "Pending Approval",
        requestedAction: newStatus,
        approvalStatus: "pending",
      });
      return;
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

    if (service.status === "Pending Approval" && newStatus !== "Pending Approval") {
      updates.requestedAction = null;
      updates.approvalStatus = null;
    }

    onUpdate(service.id, updates);
  };

  return (
    <div ref={setNodeRef} style={style} className="service-item">
      <div className="service-header">
        <div className="service-name">
          <span {...attributes} {...listeners} className="drag-handle" title="Drag to reorder">
            <FaGripVertical />
          </span>
          {service.name}
        </div>

        <span className={`status-badge ${getStatusClass(service.status)} service-status-badge`}>
          {service.status === "Pending Approval" ? service.requestedAction || "Pending" : service.status}
        </span>
      </div>

      <div className="service-meta-row">
        <div className="meta-item">
          <span className="meta-label">Start time</span>
          <span className="meta-value start-time-display">{service.startTime || "—"}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">End time</span>
          <span className="meta-value end-time-display">{service.endTime || "—"}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Service work status</span>
          <span className="meta-value status-display">
            {service.status === "Pending Approval" ? service.requestedAction || "Pending" : service.status}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Assigned to</span>
          <span className="meta-value assigned-display">{service.assignedTo || "—"}</span>
        </div>
      </div>

      <PermissionGate moduleId="serviceexec" optionId="serviceexec_edit">
        <div className="assign-controls edit-controls">
          <div className="control-group">
            <span className="control-label">
              <FaUserTie /> Assigned to
            </span>
            <select className="assigned-select" value={service.assignedTo || ""} onChange={handleAssignedToChange}>
              <option value="">— assign —</option>
              {availableAssignees.map((assignee, idx) => (
                <option key={idx} value={assignee}>
                  {assignee}
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
              <option value="Inprogress">In Progress</option>
              <option value="Postponed">Postponed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Completed">Completed</option>
            </select>
          </div>
        </div>
      </PermissionGate>

      {service.notes ? (
        <div className="service-notes">
          <span className="notes-label">Notes:</span> {service.notes}
        </div>
      ) : null}

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

// =====================================================================
// Main Component
// =====================================================================
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
}: Props) {
  const [isAddingService, setIsAddingService] = useState(false);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  const [localServices, setLocalServices] = useState<Service[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setLocalServices(normalizeServices(jobId, services));
    setHasChanges(false);
  }, [jobId, services]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortedServices = useMemo(() => {
    return [...localServices].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [localServices]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!editMode) return;

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
    if (editMode && hasChanges) setHasChanges(false);
    setEditMode(!editMode);
  };

  const handleAddServiceClick = async () => {
    if (!editMode) return;

    const serviceName = window.prompt("Enter service name:", "Wheel Protection");
    if (!serviceName) return;

    const price = 600;

    setIsAddingService(true);
    setApprovalMessage(`📤 Approval request sent for "${serviceName}" (QAR ${price})...`);

    try {
      const approved = await onAddService(serviceName, price);
      if (approved) {
        setApprovalMessage(`✅ Approved! Service "${serviceName}" added.`);
        setHasChanges(true);
      } else {
        setApprovalMessage(`❌ Request declined. Service not added.`);
      }
    } catch {
      setApprovalMessage(`❌ Error adding service.`);
    } finally {
      setIsAddingService(false);
      setTimeout(() => setApprovalMessage(null), 2500);
    }
  };

  return (
    <div className="epm-detail-card">
      <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <i className="fas fa-concierge-bell"></i> Service Summary
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

          <PermissionGate moduleId="serviceexec" optionId="serviceexec_finish">
            <button className="btn-finish-work" onClick={onFinishWork} disabled={!allServicesCompleted}>
              <FaCheckDouble /> Finish Work
            </button>
          </PermissionGate>

          <PermissionGate moduleId="serviceexec" optionId="serviceexec_addservice">
            <button className="btn-add-service" onClick={handleAddServiceClick} disabled={isAddingService}>
              <FaPlusCircle /> Add service
            </button>
          </PermissionGate>
        </span>
      </h3>

      {editMode ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortedServices.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="services-list">
              {sortedServices.length ? (
                sortedServices.map((service) => (
                  <SortableServiceItem
                    key={service.id}
                    service={service}
                    onUpdate={handleServiceUpdate}
                    availableTechs={availableTechs}
                    availableAssignees={availableAssignees}
                    jobOrderBackendId={jobOrderBackendId}
                    orderNumber={orderNumber}
                  />
                ))
              ) : (
                <div style={{ padding: "20px", textAlign: "center", color: "#7f8c8d" }}>No services assigned yet</div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="services-list">
          {sortedServices.length ? (
            sortedServices.map((service) => <ReadOnlyServiceItem key={service.id} service={service} />)
          ) : (
            <div style={{ padding: "20px", textAlign: "center", color: "#7f8c8d" }}>No services assigned yet</div>
          )}
        </div>
      )}

      {approvalMessage && <div id="approvalMessageArea" className="approval-simulate">{approvalMessage}</div>}
    </div>
  );
}