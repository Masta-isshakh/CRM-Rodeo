import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import "./employees.css";
import { logActivity } from "../utils/activityLogger";
import type { PageProps } from "../lib/PageProps";
import PermissionGate from "./PermissionGate";
import { useLanguage } from "../i18n/LanguageContext";

const client = generateClient<Schema>();

type EmployeeRow = Schema["Employee"]["type"];

type EmployeeForm = {
  firstName: string;
  lastName: string;
  position: string;
  email: string;
  phone: string;
  salary: string;
};

type FormErrors = Partial<Record<keyof EmployeeForm, string>>;

export default function Employees({ permissions }: PageProps) {
  const { t } = useLanguage();

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeRow | null>(null);
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});

  const [formData, setFormData] = useState<EmployeeForm>({
    firstName: "",
    lastName: "",
    position: "",
    email: "",
    phone: "",
    salary: "",
  });

  useEffect(() => {
    void fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const { data } = await client.models.Employee.list({ limit: 2000 });
      setEmployees(data ?? []);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ firstName: "", lastName: "", position: "", email: "", phone: "", salary: "" });
    setEditingEmployee(null);
    setErrors({});
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const field = e.target.name as keyof EmployeeForm;
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const validate = () => {
    const next: FormErrors = {};
    if (!formData.firstName.trim()) next.firstName = t("First name is required.");
    if (!formData.lastName.trim()) next.lastName = t("Last name is required.");
    if (!formData.email.trim()) next.email = t("Email is required.");
    if (formData.email && !/^\S+@\S+\.\S+$/.test(formData.email.trim())) {
      next.email = t("Enter a valid email address.");
    }
    if (formData.salary && Number(formData.salary) < 0) {
      next.salary = t("Salary must be a positive number.");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const filteredEmployees = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => {
      const fullName = `${e.firstName ?? ""} ${e.lastName ?? ""}`.toLowerCase();
      const fields = [
        fullName,
        String(e.position ?? "").toLowerCase(),
        String(e.email ?? "").toLowerCase(),
        String(e.phone ?? "").toLowerCase(),
      ];
      return fields.some((f) => f.includes(q));
    });
  }, [employees, query]);

  const handleSubmit = async () => {
    const isEdit = !!editingEmployee;

    if (isEdit && !permissions.canUpdate) return;
    if (!isEdit && !permissions.canCreate) return;
    if (!validate()) return;

    setSaving(true);
    try {
      if (editingEmployee) {
        const result = await client.models.Employee.update({
          id: editingEmployee.id,
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          position: formData.position.trim() || undefined,
          email: formData.email.trim(),
          phone: formData.phone.trim() || undefined,
          salary: Number(formData.salary) || 0,
        });

        if (!result.data) throw new Error("Employee not updated");

        setEmployees((prev) => prev.map((row) => (row.id === result.data!.id ? result.data! : row)));

        void logActivity(
          "Employee",
          editingEmployee.id,
          "UPDATE",
          `Employee ${formData.firstName.trim()} ${formData.lastName.trim()} updated`
        );
      } else {
        const result = await client.models.Employee.create({
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          position: formData.position.trim() || undefined,
          email: formData.email.trim(),
          phone: formData.phone.trim() || undefined,
          salary: Number(formData.salary) || 0,
          createdAt: new Date().toISOString(),
        });

        if (!result.data) throw new Error("Employee not created");

        setEmployees((prev) => [result.data!, ...prev]);

        void logActivity(
          "Employee",
          result.data.id,
          "CREATE",
          `Employee ${formData.firstName.trim()} ${formData.lastName.trim()} created`
        );
      }

      resetForm();
      setShowModal(false);
    } catch (error) {
      console.error("Employee operation failed:", error);
      window.alert(t("Operation failed. Check console for details."));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (employee: EmployeeRow) => {
    if (!permissions.canUpdate) return;

    setEditingEmployee(employee);
    setFormData({
      firstName: employee.firstName || "",
      lastName: employee.lastName || "",
      position: employee.position || "",
      email: employee.email || "",
      phone: employee.phone || "",
      salary: employee.salary?.toString() || "",
    });
    setShowModal(true);
  };

  const handleDelete = async () => {
    const employee = deleteTarget;
    if (!employee) return;
    if (!permissions.canDelete) return;

    setSaving(true);
    try {
      await client.models.Employee.delete({ id: employee.id });
      setEmployees((prev) => prev.filter((row) => row.id !== employee.id));
      void logActivity("Employee", employee.id, "DELETE", `Employee ${employee.firstName} ${employee.lastName} deleted`);
      setDeleteTarget(null);
    } catch (error) {
      console.error("Delete failed:", error);
      window.alert(t("Failed to delete employee."));
    } finally {
      setSaving(false);
    }
  };

  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>{t("You don't have access to this page.")}</div>;
  }

  return (
    <div className="employees-page">
      <div className="employees-hero">
        <div className="employees-hero-overlay" aria-hidden="true" />
        <div className="employees-hero-lines" aria-hidden="true" />
        <div className="employees-hero-top-row">
          <div className="employees-title-wrap">
            <h1 className="employees-title">{t("Employees")}</h1>
            <p className="employees-subtitle">{t("Manage team profiles with Customer-style visual parity")}</p>
          </div>
          <div className="employees-actions">
            <div className="employees-search-wrap">
              <i className="fas fa-search" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search employees")}
                className="employees-search"
              />
            </div>
            <PermissionGate moduleId="employees" optionId="employees_refresh">
              <button className="employees-btn employees-btn-secondary" onClick={() => void fetchEmployees()} type="button" disabled={loading}>
                <i className="fas fa-rotate" aria-hidden="true" /> {loading ? t("Refreshing...") : t("Refresh")}
              </button>
            </PermissionGate>
            {permissions.canCreate && (
              <PermissionGate moduleId="employees" optionId="employees_add">
                <button
                  className="employees-btn employees-btn-primary"
                  onClick={() => {
                    resetForm();
                    setShowModal(true);
                  }}
                  type="button"
                >
                  <i className="fas fa-plus" aria-hidden="true" /> {t("Add Employee")}
                </button>
              </PermissionGate>
            )}
          </div>
        </div>
      </div>

      <div className="employees-section-head">
        <div className="employees-section-title-wrap">
          <span className="employees-kicker">{t("Workforce")}</span>
          <h2>{t("Employee Directory")}</h2>
        </div>
        <span className="employees-meta">{filteredEmployees.length} {t("records")}</span>
      </div>

      <div className="employees-table-shell">
        <table className="employees-table" role="table">
          <thead>
            <tr>
              <th>{t("Employee Name")}</th>
              <th>{t("Position")}</th>
              <th>{t("Email")}</th>
              <th>{t("Phone")}</th>
              <th>{t("Salary")}</th>
              <th className="employees-actions-col">{t("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6}>
                  <div className="employees-empty">{t("Loading employees...")}</div>
                </td>
              </tr>
            )}
            {!loading && !filteredEmployees.length && (
              <tr>
                <td colSpan={6}>
                  <div className="employees-empty">{t("No employees found.")}</div>
                </td>
              </tr>
            )}
            {!loading && filteredEmployees.map((e, idx) => (
              <tr key={e.id} className={idx % 2 === 0 ? "even" : "odd"}>
                <td>
                  <span className="employees-cell-primary">{e.firstName} {e.lastName}</span>
                </td>
                <td>{e.position || t("Employee")}</td>
                <td>{e.email || "-"}</td>
                <td>{e.phone || "-"}</td>
                <td>{typeof e.salary === "number" ? e.salary.toLocaleString() : "-"}</td>
                <td className="employees-actions-col">
                  <div className="employees-row-actions">
                    {permissions.canUpdate && (
                      <PermissionGate moduleId="employees" optionId="employees_edit">
                        <button className="employees-btn employees-btn-row" type="button" onClick={() => handleEdit(e)}>
                          <i className="fas fa-pen" aria-hidden="true" /> {t("Edit")}
                        </button>
                      </PermissionGate>
                    )}
                    {permissions.canDelete && (
                      <PermissionGate moduleId="employees" optionId="employees_delete">
                        <button
                          className="employees-btn employees-btn-row employees-btn-danger"
                          type="button"
                          onClick={() => setDeleteTarget(e)}
                        >
                          <i className="fas fa-trash" aria-hidden="true" /> {t("Delete")}
                        </button>
                      </PermissionGate>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="employees-modal-overlay">
          <div className="employees-modal" role="dialog" aria-modal="true">
            <div className="employees-modal-accent" aria-hidden="true" />
            <div className="employees-modal-header">
              <div className="employees-modal-title-wrap">
                <div className="employees-modal-icon">
                  <i className={`fas ${editingEmployee ? "fa-user-pen" : "fa-user-plus"}`} aria-hidden="true" />
                </div>
                <h3>{editingEmployee ? t("Edit Employee") : t("New Employee")}</h3>
              </div>
              <button
                className="employees-modal-close"
                type="button"
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
                disabled={saving}
              >
                <i className="fas fa-times" aria-hidden="true" />
              </button>
            </div>

            <div className="employees-form-grid">
              <div className="employees-field">
                <label htmlFor="employee-first-name">{t("First Name")}</label>
                <input id="employee-first-name" name="firstName" value={formData.firstName} onChange={handleChange} />
                {errors.firstName && <span className="employees-field-error">{errors.firstName}</span>}
              </div>
              <div className="employees-field">
                <label htmlFor="employee-last-name">{t("Last Name")}</label>
                <input id="employee-last-name" name="lastName" value={formData.lastName} onChange={handleChange} />
                {errors.lastName && <span className="employees-field-error">{errors.lastName}</span>}
              </div>
              <div className="employees-field">
                <label htmlFor="employee-position">{t("Position")}</label>
                <input id="employee-position" name="position" value={formData.position} onChange={handleChange} />
              </div>
              <div className="employees-field">
                <label htmlFor="employee-email">{t("Email")}</label>
                <input id="employee-email" name="email" type="email" value={formData.email} onChange={handleChange} />
                {errors.email && <span className="employees-field-error">{errors.email}</span>}
              </div>
              <div className="employees-field">
                <label htmlFor="employee-phone">{t("Phone")}</label>
                <input id="employee-phone" name="phone" value={formData.phone} onChange={handleChange} />
              </div>
              <div className="employees-field">
                <label htmlFor="employee-salary">{t("Salary")}</label>
                <input id="employee-salary" name="salary" type="number" value={formData.salary} onChange={handleChange} />
                {errors.salary && <span className="employees-field-error">{errors.salary}</span>}
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="employees-btn employees-btn-secondary"
                type="button"
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
                disabled={saving}
              >
                <i className="fas fa-times" aria-hidden="true" /> {t("Cancel")}
              </button>
              {!!editingEmployee && (
                <PermissionGate moduleId="employees" optionId="employees_edit">
                  <button className="employees-btn employees-btn-primary" type="button" onClick={handleSubmit} disabled={saving || !permissions.canUpdate}>
                    <i className="fas fa-save" aria-hidden="true" /> {saving ? t("Saving...") : t("Update")}
                  </button>
                </PermissionGate>
              )}
              {!editingEmployee && (
                <PermissionGate moduleId="employees" optionId="employees_add">
                  <button className="employees-btn employees-btn-primary" type="button" onClick={handleSubmit} disabled={saving || !permissions.canCreate}>
                    <i className="fas fa-save" aria-hidden="true" /> {saving ? t("Saving...") : t("Create")}
                  </button>
                </PermissionGate>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="employees-modal-overlay">
          <div className="employees-modal employees-delete-modal" role="dialog" aria-modal="true">
            <div className="employees-modal-accent" aria-hidden="true" />
            <div className="employees-modal-header">
              <div className="employees-modal-title-wrap">
                <div className="employees-modal-icon employees-danger-icon">
                  <i className="fas fa-triangle-exclamation" aria-hidden="true" />
                </div>
                <h3>{t("Delete Employee")}</h3>
              </div>
            </div>
            <p className="employees-delete-copy">
              {t("Delete")} <strong>{deleteTarget.firstName} {deleteTarget.lastName}</strong>?
            </p>
            <div className="modal-actions">
              <button className="employees-btn employees-btn-secondary" type="button" onClick={() => setDeleteTarget(null)} disabled={saving}>
                <i className="fas fa-times" aria-hidden="true" /> {t("Cancel")}
              </button>
              <button className="employees-btn employees-btn-danger" type="button" onClick={() => void handleDelete()} disabled={saving}>
                <i className="fas fa-trash" aria-hidden="true" /> {saving ? t("Deleting...") : t("Delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
