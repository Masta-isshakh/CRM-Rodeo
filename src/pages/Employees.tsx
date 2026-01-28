import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { Button, TextField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import "./employees.css";
import { logActivity } from "../utils/activityLogger";
import { PageProps } from "../lib/PageProps";

const client = generateClient<Schema>();

type EmployeeForm = {
  firstName: string;
  lastName: string;
  position: string;
  email: string;
  phone: string;
  salary: string;
};

export default function Employees({ permissions }: PageProps) {
  const [employees, setEmployees] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);

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

  /* =========================
     DATA
  ========================= */

  const fetchEmployees = async () => {
    const { data } = await client.models.Employee.list();
    setEmployees(data);
  };

  const resetForm = () => {
    setFormData({
      firstName: "",
      lastName: "",
      position: "",
      email: "",
      phone: "",
      salary: "",
    });
    setEditingEmployee(null);
  };

  /* =========================
     FORM
  ========================= */

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  /* =========================
     CREATE / UPDATE
  ========================= */

  const handleSubmit = async () => {
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
          position: formData.position,
          email: formData.email,
          phone: formData.phone,
          salary: Number(formData.salary) || 0,
        });

        await logActivity(
          "Employee",
          editingEmployee.id,
          "UPDATE",
          `Employee ${formData.firstName} ${formData.lastName} updated`
        );
      } else {
const result = await client.models.Employee.create({
  firstName: formData.firstName,
  lastName: formData.lastName,
  position: formData.position,
  email: formData.email,
  phone: formData.phone,
  salary: Number(formData.salary) || 0,
  createdAt: new Date().toISOString(),
});

if (!result.data) {
  throw new Error("Employee not created");
}

await logActivity(
  "Employee",
  result.data.id,
  "CREATE",
  `Employee ${formData.firstName} ${formData.lastName} created`
);

      }

      resetForm();
      setShowModal(false);
      fetchEmployees();
    } catch (error) {
      console.error("Employee operation failed:", error);
      alert("Operation failed. Check console for details.");
    }
  };

  /* =========================
     EDIT
  ========================= */

  const handleEdit = (employee: any) => {
    setEditingEmployee(employee);
    setFormData({
      firstName: employee.firstName,
      lastName: employee.lastName,
      position: employee.position || "",
      email: employee.email,
      phone: employee.phone || "",
      salary: employee.salary?.toString() || "",
    });
    setShowModal(true);
  };

  /* =========================
     DELETE
  ========================= */

  const handleDelete = async (employee: any) => {
    if (!confirm(`Delete ${employee.firstName} ${employee.lastName}?`)) return;

    try {
      await client.models.Employee.delete({ id: employee.id });

      await logActivity(
        "Employee",
        employee.id,
        "DELETE",
        `Employee ${employee.firstName} ${employee.lastName} deleted`
      );

      fetchEmployees();
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Failed to delete employee.");
    }
  };

  /* =========================
     UI
  ========================= */

  return (
    <div className="employees-page">
      <div className="employees-header">
        <h2>Employees</h2>
        <Button variation="primary" onClick={() => setShowModal(true)}>
          Add Employee
        </Button>
      </div>

      {/* MODAL */}
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
              <Button variation="primary" onClick={handleSubmit}>
                {editingEmployee ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* LIST */}
      <div className="employees-grid">
        {employees.map((e) => (
          <div className="employee-card" key={e.id}>
            <h4>{e.firstName} {e.lastName}</h4>
            <p className="position">{e.position || "Employee"}</p>
            <p>Email: {e.email}</p>
            <p>Phone: {e.phone || "N/A"}</p>
            <p>Salary: {e.salary ?? "N/A"}</p>

            <div className="card-actions">
              <Button size="small" onClick={() => handleEdit(e)}>Edit</Button>
              <Button size="small" variation="destructive" onClick={() => handleDelete(e)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
