// src/pages/serviceexecution/ServiceExecutionModule.tsx
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "./ServiceExecutionModule.css";

import ServiceSummaryCard from "./ServiceSummaryCard";
import SuccessPopup from "./SuccessPopup";

// ✅ Use your central PermissionGate
import PermissionGate from "./PermissionGate";

// ✅ Amplify Data client (Gen2)
import { getDataClient } from "../lib/amplifyClient";

// ✅ JobOrder persistence through your existing backend mutation
import {
    cancelJobOrderByOrderNumber,
    getJobOrderByOrderNumber,
    upsertJobOrder,
} from "./jobOrderRepo";

// ✅ Storage URL for downloads (docs)
import { getUrl } from "aws-amplify/storage";

// -------------------- helpers --------------------
function safeJsonParse<T>(raw: any, fallback: T): T {
    try {
        if (raw == null) return fallback;
        if (typeof raw === "string") {
            const s = raw.trim();
            if (!s) return fallback;
            return JSON.parse(s) as T;
        }
        return raw as T;
    } catch {
        return fallback;
    }
}

function errMsg(e: unknown) {
    const anyE = e as any;
    return String(anyE?.message ?? anyE?.errors?.[0]?.message ?? anyE ?? "Unknown error");
}

function normalizeServices(services: any[]) {
    return (services || []).map((s: any, idx: number) => ({
        ...s,
        id: String(s.id || `SVC-${idx + 1}-${Date.now()}`),
        order: Number(s.order ?? idx + 1),
        status: String(s.status ?? "Pending"),
        assignedTo: s.assignedTo ?? null,
        technicians: Array.isArray(s.technicians) ? s.technicians : [],
        // keep both styles for UI compatibility
        startTime: s.startTime ?? null,
        endTime: s.endTime ?? null,
        started: s.startTime || s.started || "Not started",
        ended: s.endTime || s.ended || "Not completed",
        technician:
            s.assignedTo ||
            s.technician ||
            (Array.isArray(s.technicians) && s.technicians.length ? s.technicians[0] : "Not assigned"),
    }));
}

function pickNextActiveService(services: any[]) {
    return (services || []).find(
        (s: any) => s.status !== "Completed" && s.status !== "Cancelled" && s.status !== "Postponed"
    );
}

async function resolveMaybeStorageUrl(urlOrPath: string): Promise<string> {
    const v = String(urlOrPath || "").trim();
    if (!v) return "";
    // If it looks like an S3 key path in your bucket (your storage pattern)
    if (v.startsWith("job-orders/")) {
        const out = await getUrl({ path: v });
        return out.url.toString();
    }
    return v;
}

// -------------------- main component --------------------
const ServiceExecutionModule = ({ currentUser }: any) => {
    const client = useMemo(() => getDataClient(), []);

    // live list from backend
    const [jobs, setJobs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // user lists (optional)
    const [systemUsers, setSystemUsers] = useState<any[]>([]);
    const technicianNames = useMemo(() => systemUsers.map((u) => u.name).filter(Boolean), [systemUsers]);
    const assigneeNames = useMemo(() => {
        const base = systemUsers.map((u) => u.name).filter(Boolean);
        const me = currentUser?.name ? [currentUser.name] : [];
        return Array.from(new Set([...me, ...base]));
    }, [systemUsers, currentUser]);

    // UI state
    const [currentTab, setCurrentTab] = useState<"assigned" | "unassigned" | "team">("assigned");
    const [currentSearch, setCurrentSearch] = useState("");
    const [pageSize, setPageSize] = useState(20);
    const [currentPage, setCurrentPage] = useState(1);

    const [showDetails, setShowDetails] = useState(false);
    const [currentDetailsJob, setCurrentDetailsJob] = useState<any | null>(null);

    const [showSuccessPopup, setShowSuccessPopup] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");

    const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
    const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);

    const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

    // close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event: any) => {
            const isDropdownButton = event.target.closest(".btn-action-dropdown");
            const isDropdownMenu = event.target.closest(".action-dropdown-menu");
            if (!isDropdownButton && !isDropdownMenu) setActiveDropdown(null);
        };

        if (activeDropdown) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [activeDropdown]);

    // Load users from Amplify Data if allowed (admins can; others may not)
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await client.models.UserProfile.list({ limit: 2000 });
                if (cancelled) return;
                const mapped = (res.data ?? []).map((u: any) => ({
                    name: u.fullName || u.email,
                    email: u.email,
                }));
                setSystemUsers(mapped);
            } catch {
                // If not allowed, fallback to empty; UI still works
                setSystemUsers([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [client]);

    // Live backend list (NO localStorage, NO demoData)
    useEffect(() => {
        const sub = (client.models.JobOrder as any).observeQuery({
            limit: 2000,
            // Service execution works on "IN_PROGRESS" DB state
            filter: { status: { eq: "IN_PROGRESS" } } as any,
        }).subscribe(({ items }: any) => {
            const mapped = (items ?? []).map((row: any) => {
                const parsed = safeJsonParse<any>(row.dataJson, {});
                const roadmap = Array.isArray(parsed.roadmap) ? parsed.roadmap : [];
                const services = normalizeServices(Array.isArray(parsed.services) ? parsed.services : []);
                return {
                    _backendId: row.id,
                    id: row.orderNumber,
                    orderType: row.orderType ?? parsed.orderType ?? "Job Order",
                    customerName: row.customerName ?? parsed.customerName ?? "",
                    mobile: row.customerPhone ?? parsed.customerPhone ?? "",
                    vehiclePlate: row.plateNumber ?? parsed.plateNumber ?? "",
                    createDate: row.createdAt
                        ? new Date(String(row.createdAt)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                        : "",
                    workStatus: parsed.workStatusLabel ?? row.workStatusLabel ?? "Inprogress",
                    paymentStatus: parsed.paymentStatusLabel ?? row.paymentStatusLabel ?? "Unpaid",
                    roadmap,
                    services,
                };
            });
            setJobs(mapped);
        });

        return () => sub.unsubscribe();
    }, [client]);

    // tab/search resets
    useEffect(() => setCurrentPage(1), [currentTab, currentSearch, pageSize]);

    // filter: must be Inprogress step active
    const filteredJobs = useMemo(() => {
        const q = currentSearch.trim().toLowerCase();
        let list = [...jobs];

        list = list.filter((job) => {
            const inprogressStep = job.roadmap?.find((s: any) => s.step === "Inprogress");
            return inprogressStep && inprogressStep.stepStatus === "Active";
        });

        if (currentTab === "assigned") {
            list = list.filter((j) => {
                const nextService = pickNextActiveService(j.services);
                return nextService && nextService.assignedTo === currentUser?.name;
            });
        } else if (currentTab === "unassigned") {
            list = list.filter((j) => {
                const nextService = pickNextActiveService(j.services);
                return nextService && !nextService.assignedTo;
            });
        } else {
            list = list.filter((j) => {
                const nextService = pickNextActiveService(j.services);
                return nextService && nextService.assignedTo && nextService.assignedTo !== currentUser?.name;
            });
        }

        if (q) {
            list = list.filter((j) => {
                const hay = [
                    j.id,
                    j.customerName,
                    j.vehiclePlate,
                    j.mobile,
                ].map((x) => String(x || "").toLowerCase()).join(" ");
                return hay.includes(q);
            });
        }

        return list;
    }, [jobs, currentTab, currentSearch, currentUser]);

    const counts = useMemo(() => {
        const base = jobs.filter((job) => {
            const inprogressStep = job.roadmap?.find((s: any) => s.step === "Inprogress");
            return inprogressStep && inprogressStep.stepStatus === "Active";
        });

        const assigned = base.filter((j) => {
            const nextService = pickNextActiveService(j.services);
            return nextService && nextService.assignedTo === currentUser?.name;
        }).length;

        const unassigned = base.filter((j) => {
            const nextService = pickNextActiveService(j.services);
            return nextService && !nextService.assignedTo;
        }).length;

        const team = base.filter((j) => {
            const nextService = pickNextActiveService(j.services);
            return nextService && nextService.assignedTo && nextService.assignedTo !== currentUser?.name;
        }).length;

        return { assigned, unassigned, team };
    }, [jobs, currentUser]);

    // pagination
    const totalPages = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredJobs.length);
    const paginatedJobs = filteredJobs.slice(startIndex, endIndex);

    const openDetailsView = async (orderNumber: string) => {
        setLoading(true);
        try {
            // Detailed view uses your existing repo (includes billing, payments, etc.)
            const detailed = await getJobOrderByOrderNumber(orderNumber);
            if (!detailed?._backendId) throw new Error("Order not found in backend.");

            // Enrich details from JobOrder row (for customer/vehicle cards)
            const rowRes = await client.models.JobOrder.get({ id: detailed._backendId } as any);
            const row = (rowRes as any)?.data ?? null;

            const customerDetails: any = {};
            if (row?.customerId) {
                try {
                    const cRes = await client.models.Customer.get({ id: row.customerId } as any);
                    const c = (cRes as any)?.data;
                    if (c?.id) {
                        customerDetails.customerId = c.id;
                        customerDetails.email = c.email ?? row.customerEmail ?? null;
                        customerDetails.address = c.notes ?? row.customerNotes ?? null;
                        customerDetails.registeredVehiclesCount = 0;
                        customerDetails.completedServicesCount = 0;
                        customerDetails.customerSince = c.createdAt
                            ? new Date(String(c.createdAt)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                            : "";
                    }
                } catch {
                    // ignore
                }
            }

            const vehicleDetails: any = {
                make: row?.vehicleMake ?? null,
                model: row?.vehicleModel ?? null,
                year: row?.vehicleYear ?? null,
                type: row?.vehicleType ?? null,
                color: row?.color ?? null,
                plateNumber: row?.plateNumber ?? detailed.vehiclePlate ?? null,
                vin: row?.vin ?? null,
            };

            // ensure services are normalized + IDs preserved
            const services = normalizeServices(detailed.services || []);

            const merged = {
                ...detailed,
                customerName: row?.customerName ?? detailed.customerName,
                mobile: row?.customerPhone ?? detailed.mobile,
                vehiclePlate: row?.plateNumber ?? detailed.vehiclePlate,
                orderType: row?.orderType ?? detailed.orderType,
                customerDetails: Object.keys(customerDetails).length ? customerDetails : detailed.customerDetails,
                vehicleDetails,
                services,
            };

            setCurrentDetailsJob(merged);
            setShowDetails(true);
        } catch (e) {
            setSuccessMessage(`Load failed: ${errMsg(e)}`);
            setShowSuccessPopup(true);
        } finally {
            setLoading(false);
        }
    };

    const closeDetails = () => {
        setShowDetails(false);
        setCurrentDetailsJob(null);
    };

    // Persist helper (backend only)
    const persistJob = async (job: any, successText?: string) => {
        setLoading(true);
        try {
            await upsertJobOrder(job); // ✅ uses your jobOrderSave lambda
            if (successText) {
                setSuccessMessage(successText);
                setShowSuccessPopup(true);
            }
            // reload details after save (to reflect backend truth)
            if (job?.id) {
                const refreshed = await getJobOrderByOrderNumber(job.id);
                if (refreshed) setCurrentDetailsJob((prev: any) => ({ ...prev, ...refreshed }));
            }
        } finally {
            setLoading(false);
        }
    };

    // Service updates
    const handleServicesReorder = (reorderedServices: any[]) => {
        if (!currentDetailsJob) return;
        const updated = { ...currentDetailsJob, services: normalizeServices(reorderedServices) };
        setCurrentDetailsJob(updated);
        void persistJob(updated);
    };

    const handleServiceUpdate = (serviceId: string, updates: any) => {
        if (!currentDetailsJob) return;
        const updated = { ...currentDetailsJob };
        const services = normalizeServices(updated.services || []);
        const svc = services.find((s: any) => s.id === serviceId);
        if (!svc) return;
        Object.assign(svc, updates);
        updated.services = services;
        setCurrentDetailsJob(updated);
        void persistJob(updated);
    };

    // Add service with backend approval request (optional model)
    const handleAddService = async (serviceName: string, price: number) => {
        if (!currentDetailsJob) return;

        const newService = {
            id: `SVC-${Date.now()}`,
            order: (currentDetailsJob.services?.length ?? 0) + 1,
            name: serviceName,
            price,
            status: "Pending Approval",
            assignedTo: currentUser?.name ?? null,
            technicians: [],
            startTime: null,
            endTime: null,
            notes: "Requested from Service Execution module",
        };

        const updated = {
            ...currentDetailsJob,
            services: normalizeServices([...(currentDetailsJob.services || []), newService]),
        };

        setCurrentDetailsJob(updated);

        // Persist in JobOrder (so it is NOT local)
        await persistJob(updated);

        // Also store approval request row if you added the model
        try {
            await (client.models as any).ServiceApprovalRequest.create({
                jobOrderId: String(updated._backendId),
                orderNumber: String(updated.id),
                serviceId: newService.id,
                serviceName: serviceName,
                price: Number(price || 0),
                requestedBy: currentUser?.name ?? currentUser?.email ?? "user",
                requestedAt: new Date().toISOString(),
                status: "PENDING",
            } as any);
        } catch {
            // if model not deployed, ignore
        }

        setSuccessMessage(`Approval request created for "${serviceName}".`);
        setShowSuccessPopup(true);
    };

    // Finish work -> move roadmap to Quality Check (backend)
    const allServicesCompleted = useMemo(() => {
        const s = currentDetailsJob?.services || [];
        return s.every((x: any) => x.status === "Postponed" || x.status === "Cancelled" || x.status === "Completed");
    }, [currentDetailsJob]);

    const handleFinishWork = async () => {
        if (!currentDetailsJob) return;

        const updated = { ...currentDetailsJob };
        const now = new Date().toLocaleString();

        const roadmap = Array.isArray(updated.roadmap) ? [...updated.roadmap] : [];
        const inprogressStep = roadmap.find((s: any) => s.step === "Inprogress");
        if (inprogressStep) {
            inprogressStep.stepStatus = "Completed";
            inprogressStep.endTimestamp = now;
        }
        const qcStep = roadmap.find((s: any) => s.step === "Quality Check");
        if (qcStep) {
            qcStep.stepStatus = "Active";
            qcStep.startTimestamp = qcStep.startTimestamp || now;
        }

        updated.roadmap = roadmap;
        updated.workStatus = "Quality Check";
        updated.workStatusLabel = "Quality Check";

        setCurrentDetailsJob(updated);
        await persistJob(updated, "Work finished! Status changed to Quality Check.");
    };

    // Cancel order (backend)
    const handleShowCancelConfirmation = (orderId: string) => {
        setCancelOrderId(orderId);
        setShowCancelConfirmation(true);
        setActiveDropdown(null);
    };

    const handleCancelOrder = async () => {
        if (!cancelOrderId) return;
        setLoading(true);
        try {
            await cancelJobOrderByOrderNumber(cancelOrderId);
            setSuccessMessage(`Order ${cancelOrderId} cancelled successfully.`);
            setShowSuccessPopup(true);
        } catch (e) {
            setSuccessMessage(`Cancel failed: ${errMsg(e)}`);
            setShowSuccessPopup(true);
        } finally {
            setLoading(false);
            setShowCancelConfirmation(false);
            setCancelOrderId(null);
        }
    };

    // ---------------- DETAILS SCREEN ----------------
    if (showDetails && currentDetailsJob) {
        return (
            <div className="service-execution-wrapper">
                <div className="service-details-screen">
                    <div className="service-details-header">
                        <div className="service-details-title-container">
                            <h2>
                                <i className="fas fa-clipboard-list"></i> Job Order Details - {currentDetailsJob.id}
                            </h2>
                        </div>
                        <button className="service-btn-close-details" onClick={closeDetails}>
                            <i className="fas fa-times"></i> Close Details
                        </button>
                    </div>

                    <div className="service-details-body">
                        <div className="service-details-grid">
                            <PermissionGate moduleId="serviceexec" optionId="serviceexec_summary">
                                <JobOrderSummaryCard order={currentDetailsJob} />
                            </PermissionGate>

                            {currentDetailsJob.roadmap && currentDetailsJob.roadmap.length > 0 && (
                                <PermissionGate moduleId="serviceexec" optionId="serviceexec_roadmap">
                                    <RoadmapCard order={currentDetailsJob} />
                                </PermissionGate>
                            )}

                            <PermissionGate moduleId="serviceexec" optionId="serviceexec_customer">
                                <CustomerInfoCard order={currentDetailsJob} />
                            </PermissionGate>

                            <PermissionGate moduleId="serviceexec" optionId="serviceexec_vehicle">
                                <VehicleInfoCard order={currentDetailsJob} />
                            </PermissionGate>

                            <PermissionGate moduleId="serviceexec" optionId="serviceexec_services">
                                <ServiceSummaryCard
                                    jobId={currentDetailsJob.id}                 // UI orderNumber
                                    jobOrderBackendId={currentDetailsJob._backendId} // backend UUID
                                    orderNumber={currentDetailsJob.id}
                                    services={currentDetailsJob.services || []}
                                    onServicesReorder={handleServicesReorder}
                                    onServiceUpdate={handleServiceUpdate}
                                    onAddService={handleAddService}
                                    onFinishWork={handleFinishWork}
                                    allServicesCompleted={allServicesCompleted}
                                    editMode={false}
                                    setEditMode={() => { }}
                                    availableTechs={technicianNames}
                                    availableAssignees={assigneeNames}
                                />
                            </PermissionGate>

                            {currentDetailsJob.customerNotes && (
                                <PermissionGate moduleId="serviceexec" optionId="serviceexec_notes">
                                    <CustomerNotesCard order={currentDetailsJob} />
                                </PermissionGate>
                            )}

                            <PermissionGate moduleId="serviceexec" optionId="serviceexec_quality">
                                <QualityCheckListCard order={currentDetailsJob} />
                            </PermissionGate>

                            <PermissionGate moduleId="serviceexec" optionId="serviceexec_billing">
                                <BillingCard order={currentDetailsJob} />
                            </PermissionGate>

                            <PermissionGate moduleId="serviceexec" optionId="serviceexec_paymentlog">
                                <PaymentActivityLogCard order={currentDetailsJob} />
                            </PermissionGate>

                            <PermissionGate moduleId="serviceexec" optionId="serviceexec_exitpermit">
                                <ExitPermitDetailsCard order={currentDetailsJob} />
                            </PermissionGate>

                            <PermissionGate moduleId="serviceexec" optionId="serviceexec_documents">
                                <DocumentsCard order={currentDetailsJob} resolveUrl={resolveMaybeStorageUrl} />
                            </PermissionGate>
                        </div>
                    </div>

                    <SuccessPopup
                        isVisible={showSuccessPopup}
                        onClose={() => {
                            setShowSuccessPopup(false);
                            // keep details open; you can close if you want
                        }}
                        message={successMessage}
                    />
                </div>
            </div>
        );
    }

    // ---------------- LIST SCREEN ----------------
    const tabTitle =
        currentTab === "assigned" ? "Assigned to me" : currentTab === "unassigned" ? "Unassigned tasks" : "Team tasks";

    return (
        <div className="service-execution-wrapper">
            <div className="app-container">
                <header className="app-header">
                    <div className="header-left">
                        <h1>
                            <i className="fas fa-clipboard-check"></i> Services & Work Management
                        </h1>
                    </div>
                </header>

                <div className="task-tabs">
                    <div className={`task-tab ${currentTab === "assigned" ? "active" : ""}`} onClick={() => setCurrentTab("assigned")}>
                        <i className="fas fa-user-check"></i> Assign to me ({counts.assigned})
                    </div>
                    <div className={`task-tab ${currentTab === "unassigned" ? "active" : ""}`} onClick={() => setCurrentTab("unassigned")}>
                        <i className="fas fa-user-slash"></i> Unassigned tasks ({counts.unassigned})
                    </div>
                    <div className={`task-tab ${currentTab === "team" ? "active" : ""}`} onClick={() => setCurrentTab("team")}>
                        <i className="fas fa-users"></i> Team tasks ({counts.team})
                    </div>
                </div>

                <section className="search-section">
                    <div className="search-container">
                        <i className="fas fa-search search-icon"></i>
                        <input
                            type="text"
                            className="smart-search-input"
                            placeholder="Search by Job ID, Customer, Plate..."
                            value={currentSearch}
                            onChange={(e) => setCurrentSearch(e.target.value)}
                        />
                    </div>
                </section>

                <section className="results-section">
                    <div className="section-header">
                        <h2>
                            <i className="fas fa-tasks"></i> {tabTitle}
                        </h2>
                        <div className="pim-pagination-controls">
                            <label htmlFor="pageSizeSelect">Records per page:</label>
                            <select
                                id="pageSizeSelect"
                                className="pim-page-size-select"
                                value={pageSize}
                                onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
                            >
                                <option value="20">20</option>
                                <option value="50">50</option>
                                <option value="100">100</option>
                            </select>
                        </div>
                    </div>

                    {filteredJobs.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-text">{loading ? "Loading..." : "No tasks in this view"}</div>
                        </div>
                    ) : (
                        <>
                            <div className="table-wrapper">
                                <table className="job-order-table">
                                    <thead>
                                        <tr>
                                            <th>Create Date</th>
                                            <th>Job Card ID</th>
                                            <th>Order Type</th>
                                            <th>Customer Name</th>
                                            <th>Vehicle Plate</th>
                                            <th>Assigned To</th>
                                            <th>Assigned Service</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedJobs.map((job) => {
                                            const currentService = pickNextActiveService(job.services);
                                            const serviceDisplay = currentService
                                                ? `${currentService.name} (${currentService.status})`
                                                : "No active services";
                                            const assignedToDisplay = currentService && currentService.assignedTo ? currentService.assignedTo : "—";

                                            return (
                                                <tr key={job.id}>
                                                    <td>{job.createDate}</td>
                                                    <td><strong>{job.id}</strong></td>
                                                    <td>{job.orderType}</td>
                                                    <td>{job.customerName}</td>
                                                    <td>{job.vehiclePlate}</td>
                                                    <td>{assignedToDisplay}</td>
                                                    <td>{serviceDisplay}</td>
                                                    <td>
                                                        <PermissionGate moduleId="serviceexec" optionId="serviceexec_actions">
                                                            <div className="action-dropdown-container">
                                                                <button
                                                                    className={`btn-action-dropdown ${activeDropdown === job.id ? "active" : ""}`}
                                                                    onClick={(e) => {
                                                                        const isActive = activeDropdown === job.id;
                                                                        if (isActive) {
                                                                            setActiveDropdown(null);
                                                                            return;
                                                                        }
                                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                                        const menuHeight = 140;
                                                                        const menuWidth = 200;
                                                                        const spaceBelow = window.innerHeight - rect.bottom;
                                                                        const top = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
                                                                        const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
                                                                        setDropdownPosition({ top, left });
                                                                        setActiveDropdown(job.id);
                                                                    }}
                                                                >
                                                                    <i className="fas fa-cogs"></i> Actions <i className="fas fa-chevron-down"></i>
                                                                </button>
                                                            </div>
                                                        </PermissionGate>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>

                                {activeDropdown &&
                                    typeof document !== "undefined" &&
                                    createPortal(
                                        <PermissionGate moduleId="serviceexec" optionId="serviceexec_actions">
                                            <div
                                                className="action-dropdown-menu show action-dropdown-menu-fixed"
                                                style={{ top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }}
                                            >
                                                <button
                                                    className="dropdown-item view"
                                                    onClick={() => {
                                                        void openDetailsView(activeDropdown);
                                                        setActiveDropdown(null);
                                                    }}
                                                >
                                                    <i className="fas fa-eye"></i> View Details
                                                </button>
                                                <div className="dropdown-divider"></div>
                                                <button className="dropdown-item delete" onClick={() => handleShowCancelConfirmation(activeDropdown)}>
                                                    <i className="fas fa-times-circle"></i> Cancel Order
                                                </button>
                                            </div>
                                        </PermissionGate>,
                                        document.body
                                    )}
                            </div>

                            {totalPages > 1 && (
                                <div className="pim-pagination">
                                    <button
                                        className="pim-pagination-btn"
                                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                    >
                                        <i className="fas fa-chevron-left"></i>
                                    </button>

                                    <div className="pim-page-numbers">
                                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                            let pageNum;
                                            if (totalPages <= 5) pageNum = i + 1;
                                            else {
                                                const start = Math.max(1, currentPage - 2);
                                                const end = Math.min(totalPages, start + 4);
                                                const adjustedStart = Math.max(1, end - 4);
                                                pageNum = adjustedStart + i;
                                            }
                                            return (
                                                <button
                                                    key={pageNum}
                                                    className={`pim-pagination-btn ${pageNum === currentPage ? "active" : ""}`}
                                                    onClick={() => setCurrentPage(pageNum)}
                                                >
                                                    {pageNum}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <button
                                        className="pim-pagination-btn"
                                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                    >
                                        <i className="fas fa-chevron-right"></i>
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </section>

                <div className="service-footer">
                    <p>Service Management System © 2023 | Service Execution Module</p>
                </div>
            </div>

            {/* Cancel Confirmation Modal */}
            <PermissionGate moduleId="serviceexec" optionId="serviceexec_actions">
                <div className={`cancel-modal-overlay ${showCancelConfirmation && cancelOrderId ? "active" : ""}`}>
                    <div className="cancel-modal">
                        <div className="cancel-modal-header">
                            <h3>
                                <i className="fas fa-exclamation-triangle"></i> Confirm Cancellation
                            </h3>
                        </div>
                        <div className="cancel-modal-body">
                            <div className="cancel-warning">
                                <i className="fas fa-exclamation-circle"></i>
                                <div className="cancel-warning-text">
                                    <p>
                                        You are about to cancel order <strong>{cancelOrderId}</strong>.
                                    </p>
                                    <p>This action cannot be undone.</p>
                                </div>
                            </div>
                            <div className="cancel-modal-actions">
                                <button
                                    className="btn-cancel"
                                    onClick={() => {
                                        setShowCancelConfirmation(false);
                                        setCancelOrderId(null);
                                    }}
                                >
                                    <i className="fas fa-times"></i> Keep Order
                                </button>
                                <button className="btn-confirm-cancel" onClick={() => void handleCancelOrder()} disabled={loading}>
                                    <i className="fas fa-ban"></i> {loading ? "Cancelling..." : "Cancel Order"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </PermissionGate>

            <SuccessPopup isVisible={showSuccessPopup} onClose={() => setShowSuccessPopup(false)} message={successMessage} />
        </div>
    );
};

// -------------------- cards (keep your UI, no local storage) --------------------
function CustomerInfoCard({ order }: any) {
    return (
        <div className="epm-detail-card">
            <h3><i className="fas fa-user"></i> Customer Information</h3>
            <div className="epm-card-content">
                <div className="epm-info-item"><span className="epm-info-label">Customer ID</span><span className="epm-info-value">{order.customerDetails?.customerId || "N/A"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Customer Name</span><span className="epm-info-value">{order.customerName || "N/A"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Mobile Number</span><span className="epm-info-value">{order.mobile || "Not provided"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Email Address</span><span className="epm-info-value">{order.customerDetails?.email || "Not provided"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Home Address</span><span className="epm-info-value">{order.customerDetails?.address || "Not provided"}</span></div>
            </div>
        </div>
    );
}

function VehicleInfoCard({ order }: any) {
    return (
        <div className="epm-detail-card">
            <h3><i className="fas fa-car"></i> Vehicle Information</h3>
            <div className="epm-card-content">
                <div className="epm-info-item"><span className="epm-info-label">Make</span><span className="epm-info-value">{order.vehicleDetails?.make || "N/A"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Model</span><span className="epm-info-value">{order.vehicleDetails?.model || "N/A"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Year</span><span className="epm-info-value">{order.vehicleDetails?.year || "N/A"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Type</span><span className="epm-info-value">{order.vehicleDetails?.type || "N/A"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Color</span><span className="epm-info-value">{order.vehicleDetails?.color || "N/A"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Plate Number</span><span className="epm-info-value">{order.vehicleDetails?.plateNumber || order.vehiclePlate || "N/A"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">VIN</span><span className="epm-info-value">{order.vehicleDetails?.vin || "N/A"}</span></div>
            </div>
        </div>
    );
}

function JobOrderSummaryCard({ order }: any) {
    return (
        <div className="epm-detail-card">
            <h3><i className="fas fa-info-circle"></i> Job Order Summary</h3>
            <div className="epm-card-content">
                <div className="epm-info-item"><span className="epm-info-label">Job Order ID</span><span className="epm-info-value">{order.id}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Order Type</span><span className="epm-info-value">{order.orderType}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Request Create Date</span><span className="epm-info-value">{order.jobOrderSummary?.createDate || order.createDate}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Created By</span><span className="epm-info-value">{order.jobOrderSummary?.createdBy || "Not specified"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Expected Delivery</span><span className="epm-info-value">{order.jobOrderSummary?.expectedDelivery || "Not specified"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Work Status</span><span className="epm-info-value">{order.workStatus}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Payment Status</span><span className="epm-info-value">{order.paymentStatus}</span></div>
            </div>
        </div>
    );
}

function RoadmapCard({ order }: any) {
    if (!order.roadmap || order.roadmap.length === 0) return null;
    return (
        <div className="epm-detail-card">
            <h3><i className="fas fa-map-signs"></i> Job Order Roadmap</h3>
            <div className="sem-roadmap-container">
                <div className="sem-roadmap-steps">
                    {order.roadmap.map((step: any, idx: number) => (
                        <div key={idx} className="sem-roadmap-step">
                            <div className="sem-step-content">
                                <div className="sem-step-header">
                                    <div className="sem-step-name">{step.step}</div>
                                    <span className="sem-status-badge">{step.status}</span>
                                </div>
                                <div className="sem-step-details">
                                    <div className="sem-step-detail"><span className="sem-detail-label">Started</span><span className="sem-detail-value">{step.startTimestamp || "Not started"}</span></div>
                                    <div className="sem-step-detail"><span className="sem-detail-label">Ended</span><span className="sem-detail-value">{step.endTimestamp || "Not completed"}</span></div>
                                    <div className="sem-step-detail"><span className="sem-detail-label">Action By</span><span className="sem-detail-value">{step.actionBy || "Not assigned"}</span></div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function CustomerNotesCard({ order }: any) {
    return (
        <div className="epm-detail-card" style={{ backgroundColor: "#fffbea", borderLeft: "4px solid #f59e0b" }}>
            <h3><i className="fas fa-comment-dots"></i> Customer Notes</h3>
            <div style={{ padding: "15px 20px", whiteSpace: "pre-wrap", color: "#78350f", fontSize: "14px", lineHeight: "1.6" }}>
                {order.customerNotes}
            </div>
        </div>
    );
}

// Keep your existing BillingCard / PaymentActivityLogCard / ExitPermitDetailsCard / QualityCheckListCard
// unchanged if you already have them. If they were in this file, keep them below.
// The ONLY change needed inside DocumentsCard is: resolve storagePath to a signed URL.
function DocumentsCard({ order, resolveUrl }: any) {
    const documents = Array.isArray(order.documents) ? order.documents : [];
    if (documents.length === 0) return null;

    return (
        <div className="pim-detail-card">
            <h3><i className="fas fa-folder-open"></i> Documents</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {documents.map((doc: any, idx: number) => (
                    <div key={idx} style={{ padding: "15px", border: "1px solid #e5e7eb", borderRadius: "8px", backgroundColor: "#f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                                <i className="fas fa-file-alt" style={{ color: "#3b82f6", fontSize: "20px" }}></i>
                                <div>
                                    <div style={{ fontWeight: "600", color: "#1f2937", fontSize: "14px" }}>{doc.name}</div>
                                    <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                                        {doc.type} {doc.category ? `• ${doc.category}` : ""}
                                        {doc.paymentReference ? ` • ${doc.paymentReference}` : ""}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={async () => {
                                const raw = doc.storagePath || doc.url || "";
                                const linkUrl = await resolveUrl(raw);
                                if (!linkUrl) return;
                                const a = document.createElement("a");
                                a.href = linkUrl;
                                a.download = doc.name || "document";
                                a.click();
                            }}
                            style={{ padding: "8px 16px", backgroundColor: "#3b82f6", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "500", display: "flex", alignItems: "center", gap: "6px" }}
                        >
                            <i className="fas fa-download"></i> Download
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function QualityCheckListCard({ order }: any) {
    const services = Array.isArray(order.services) ? order.services : [];
    return (
        <div className="pim-detail-card" style={{ backgroundColor: "#e8f4f1", borderLeft: "4px solid #16a085" }}>
            <h3><i className="fas fa-clipboard-check"></i> Quality Check List</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {services.length > 0 ? (
                    services.map((service: any, idx: number) => {
                        const serviceName = service?.name || `Service ${idx + 1}`;
                        const result = service?.qualityCheckResult || service?.qcResult || "Not Evaluated";
                        return (
                            <div key={`${serviceName}-${idx}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", backgroundColor: "white", borderRadius: "6px", border: "1px solid #e5e7eb", gap: "12px" }}>
                                <span style={{ fontSize: "14px", fontWeight: "500", color: "#1f2937", flex: 1 }}>{serviceName}</span>
                                <span style={{ padding: "4px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: "600", backgroundColor: "#e5e7eb", color: "#374151" }}>
                                    {result}
                                </span>
                            </div>
                        );
                    })
                ) : (
                    <div style={{ padding: "12px", textAlign: "center", color: "#6b7280" }}>No services to evaluate</div>
                )}
            </div>
        </div>
    );
}

// Minimal placeholders (keep your originals if you have them in this file)
function BillingCard({ order }: any) {
    return (
        <div className="epm-detail-card">
            <h3><i className="fas fa-receipt"></i> Billing & Invoices</h3>
            <div className="epm-card-content">
                <div className="epm-info-item"><span className="epm-info-label">Bill ID</span><span className="epm-info-value">{order.billing?.billId || "N/A"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Total</span><span className="epm-info-value">{order.billing?.totalAmount || "N/A"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Net</span><span className="epm-info-value">{order.billing?.netAmount || "N/A"}</span></div>
                <div className="epm-info-item"><span className="epm-info-label">Balance</span><span className="epm-info-value">{order.billing?.balanceDue || "N/A"}</span></div>
            </div>
        </div>
    );
}

function PaymentActivityLogCard({ order }: any) {
    if (!order.paymentActivityLog || order.paymentActivityLog.length === 0) return null;
    return (
        <div className="pim-detail-card">
            <h3><i className="fas fa-history"></i> Payment Activity Log</h3>
            <table className="pim-payment-log-table">
                <thead>
                    <tr>
                        <th>Serial</th><th>Amount</th><th>Discount</th><th>Payment Method</th><th>Cashier</th><th>Timestamp</th>
                    </tr>
                </thead>
                <tbody>
                    {[...order.paymentActivityLog].reverse().map((p: any, idx: number) => (
                        <tr key={idx}>
                            <td>{p.serial}</td>
                            <td>{p.amount}</td>
                            <td>{p.discount}</td>
                            <td>{p.paymentMethod}</td>
                            <td>{p.cashierName}</td>
                            <td>{p.timestamp}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ExitPermitDetailsCard({ order }: any) {
    return (
        <div className="epm-detail-card">
            <h3><i className="fas fa-id-card"></i> Exit Permit Details</h3>
            <div className="epm-card-content">
                <div className="epm-info-item"><span className="epm-info-label">Status</span><span className="epm-info-value">{order.exitPermitStatus || "Not Created"}</span></div>
            </div>
        </div>
    );
}

export default ServiceExecutionModule;