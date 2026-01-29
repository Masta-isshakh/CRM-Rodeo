// src/pages/Employees.tsx
import { useEffect, useState, type ChangeEvent } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { Button, TextField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import "./employees.css";
import { logActivity } from "../utils/activityLogger";
import type { PageProps } from "../lib/PageProps";

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

export default function Employees({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeRow | null>(null);

  const [formData, setFormData] = useState<EmployeeForm>({
    firstName: "",
    lastName: "",
    position: "",
    email: "",
    phone: "",
    salary: "",
  });

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    const { data } = await client.models.Employee.list({ limit: 2000 });
    setEmployees(data ?? []);
  };

  const resetForm = () => {
    setFormData({ firstName: "", lastName: "", position: "", email: "", phone: "", salary: "" });
    setEditingEmployee(null);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    const isEdit = !!editingEmployee;

    if (isEdit && !permissions.canUpdate) return;
    if (!isEdit && !permissions.canCreate) return;

    if (!formData.firstName || !formData.lastName || !formData.email) {
      alert("First name, last name and email are required.");
      return;
    }

    try {
      if (editingEmployee) {
        await client.models.Employee.update({
          id: editingEmployee.id,
          firstName: formData.firstName,
          lastName: formData.lastName,
          position: formData.position || undefined,
          email: formData.email,
          phone: formData.phone || undefined,
          salary: Number(formData.salary) || 0,
        });

        await logActivity("Employee", editingEmployee.id, "UPDATE", `Employee ${formData.firstName} ${formData.lastName} updated`);
      } else {
        const result = await client.models.Employee.create({
          firstName: formData.firstName,
          lastName: formData.lastName,
          position: formData.position || undefined,
          email: formData.email,
          phone: formData.phone || undefined,
          salary: Number(formData.salary) || 0,
          createdAt: new Date().toISOString(),
        });

        if (!result.data) throw new Error("Employee not created");

        await logActivity("Employee", result.data.id, "CREATE", `Employee ${formData.firstName} ${formData.lastName} created`);
      }

      resetForm();
      setShowModal(false);
      await fetchEmployees();
    } catch (error) {
      console.error("Employee operation failed:", error);
      alert("Operation failed. Check console for details.");
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

  const handleDelete = async (employee: EmployeeRow) => {
    if (!permissions.canDelete) return;
    if (!confirm(`Delete ${employee.firstName} ${employee.lastName}?`)) return;

    try {
      await client.models.Employee.delete({ id: employee.id });
      await logActivity("Employee", employee.id, "DELETE", `Employee ${employee.firstName} ${employee.lastName} deleted`);
      await fetchEmployees();
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Failed to delete employee.");
    }
  };

  return (
    <div className="employees-page">
      <div className="employees-header">
        <h2>Employees</h2>
        {permissions.canCreate && (
          <Button variation="primary" onClick={() => setShowModal(true)}>
            Add Employee
          </Button>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>{editingEmployee ? "Edit Employee" : "New Employee"}</h3>

            <div className="form-grid">
              <TextField label="First Name" name="firstName" value={formData.firstName} onChange={handleChange} />
              <TextField label="Last Name" name="lastName" value={formData.lastName} onChange={handleChange} />
              <TextField label="Position" name="position" value={formData.position} onChange={handleChange} />
              <TextField label="Email" name="email" type="email" value={formData.email} onChange={handleChange} />
              <TextField label="Phone" name="phone" value={formData.phone} onChange={handleChange} />
              <TextField label="Salary" name="salary" type="number" value={formData.salary} onChange={handleChange} />
            </div>

            <div className="modal-actions">
              <Button variation="link" onClick={() => { setShowModal(false); resetForm(); }}>
                Cancel
              </Button>
              <Button
                variation="primary"
                onClick={handleSubmit}
                isDisabled={editingEmployee ? !permissions.canUpdate : !permissions.canCreate}
              >
                {editingEmployee ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="employees-grid">
        {employees.map((e) => (
          <div className="employee-card" key={e.id}>
            <h4>{e.firstName} {e.lastName}</h4>
            <p className="position">{e.position || "Employee"}</p>
            <p>Email: {e.email}</p>
            <p>Phone: {e.phone || "N/A"}</p>
            <p>Salary: {e.salary ?? "N/A"}</p>

            <div className="card-actions">
              {permissions.canUpdate && <Button size="small" onClick={() => handleEdit(e)}>Edit</Button>}
              {permissions.canDelete && (
                <Button size="small" variation="destructive" onClick={() => handleDelete(e)}>
                  Delete
                </Button>
              )}
            </div>
          </div>
        ))}
        {!employees.length && <div style={{ opacity: 0.8 }}>No employees yet.</div>}
      </div>
    </div>
  );
}
