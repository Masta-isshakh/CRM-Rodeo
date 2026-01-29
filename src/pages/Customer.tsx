// src/pages/Customer.tsx  (or Customers.tsx - match your import in MainLayout)
import { useEffect, useState, type ChangeEvent } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { Button, TextField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import "./employees.css";
import { logActivity } from "../utils/activityLogger";
import type { PageProps } from "../lib/PageProps";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient<Schema>();
type CustomerRow = Schema["Customer"]["type"];

type CustomerForm = {
  name: string;
  lastname: string;
  email: string;
  phone: string;
  company: string;
  notes: string;
};

export default function Customers({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const [items, setItems] = useState<CustomerRow[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  const [form, setForm] = useState<CustomerForm>({
    name: "",
    lastname: "",
    email: "",
    phone: "",
    company: "",
    notes: "",
  });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const res = await client.models.Customer.list({ limit: 2000 });
    setItems(res.data ?? []);
  };

  const reset = () => {
    setForm({ name: "", lastname: "", email: "", phone: "", company: "", notes: "" });
    setEditing(null);
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  };

  const submit = async () => {
    const isEdit = !!editing;

    if (isEdit && !permissions.canUpdate) return;
    if (!isEdit && !permissions.canCreate) return;

    if (!form.name.trim() || !form.lastname.trim()) {
      alert("First name and last name are required.");
      return;
    }

    try {
      if (editing) {
        await client.models.Customer.update({
          id: editing.id,
          name: form.name.trim(),
          lastname: form.lastname.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          company: form.company.trim() || undefined,
          notes: form.notes.trim() || undefined,
        });

        await logActivity("Customer", editing.id, "UPDATE", `Customer ${form.name} ${form.lastname} updated`);
      } else {
        const u = await getCurrentUser();
        const createdBy = (u.signInDetails?.loginId || u.username || "").toLowerCase();

        const created = await client.models.Customer.create({
          name: form.name.trim(),
          lastname: form.lastname.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          company: form.company.trim() || undefined,
          notes: form.notes.trim() || undefined,
          createdBy,
          createdAt: new Date().toISOString(),
        });

        if (!created.data) throw new Error("Customer not created");

        await logActivity("Customer", created.data.id, "CREATE", `Customer ${form.name} ${form.lastname} created`);
      }

      reset();
      setShowModal(false);
      await load();
    } catch (err) {
      console.error(err);
      alert("Operation failed. Check console.");
    }
  };

  const edit = (row: CustomerRow) => {
    if (!permissions.canUpdate) return;
    setEditing(row);
    setForm({
      name: row.name ?? "",
      lastname: row.lastname ?? "",
      email: row.email ?? "",
      phone: row.phone ?? "",
      company: row.company ?? "",
      notes: row.notes ?? "",
    });
    setShowModal(true);
  };

  const remove = async (row: CustomerRow) => {
    if (!permissions.canDelete) return;
    if (!confirm(`Delete customer ${row.name} ${row.lastname}?`)) return;

    try {
      await client.models.Customer.delete({ id: row.id });
      await logActivity("Customer", row.id, "DELETE", `Customer ${row.name} ${row.lastname} deleted`);
      await load();
    } catch (err) {
      console.error(err);
      alert("Delete failed.");
    }
  };

  return (
    <div className="employees-page">
      <div className="employees-header">
        <h2>Customers</h2>
        {permissions.canCreate && (
          <Button variation="primary" onClick={() => setShowModal(true)}>
            Add Customer
          </Button>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>{editing ? "Edit Customer" : "New Customer"}</h3>

            <div className="form-grid">
              <TextField label="First Name" name="name" value={form.name} onChange={onChange} />
              <TextField label="Last Name" name="lastname" value={form.lastname} onChange={onChange} />
              <TextField label="Email" name="email" type="email" value={form.email} onChange={onChange} />
              <TextField label="Phone" name="phone" value={form.phone} onChange={onChange} />
              <TextField label="Company" name="company" value={form.company} onChange={onChange} />
              <TextField label="Notes" name="notes" value={form.notes} onChange={onChange} />
            </div>

            <div className="modal-actions">
              <Button variation="link" onClick={() => { setShowModal(false); reset(); }}>Cancel</Button>
              <Button
                variation="primary"
                onClick={submit}
                isDisabled={editing ? !permissions.canUpdate : !permissions.canCreate}
              >
                {editing ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="employees-grid">
        {items.map((c) => (
          <div className="employee-card" key={c.id}>
            <h4>{c.name} {c.lastname}</h4>
            <p>Email: {c.email || "—"}</p>
            <p>Phone: {c.phone || "—"}</p>
            <p>Company: {c.company || "—"}</p>

            <div className="card-actions">
              {permissions.canUpdate && <Button size="small" onClick={() => edit(c)}>Edit</Button>}
              {permissions.canDelete && (
                <Button size="small" variation="destructive" onClick={() => remove(c)}>
                  Delete
                </Button>
              )}
            </div>
          </div>
        ))}
        {!items.length && <div style={{ opacity: 0.8 }}>No customers yet.</div>}
      </div>
    </div>
  );
}
