import { useEffect, useMemo, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { Button, TextField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import type { PageProps } from "../lib/PageProps";

const client = generateClient<Schema>();

export default function Customers({ permissions }: PageProps) {
  const [customers, setCustomers] = useState<Schema["Customer"]["type"][]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  const canCreate = permissions.canCreate;
  const canDelete = permissions.canDelete; // you can add delete UI later
  const canUpdate = permissions.canUpdate;

  const [formData, setFormData] = useState({
    name: "",
    lastname: "",
    email: "",
    phone: "",
  });

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const { data } = await client.models.Customer.list();
      setCustomers(data ?? []);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    if (!canCreate) return;

    if (!formData.name || !formData.lastname) {
      alert("First name and last name are required");
      return;
    }

    try {
      await client.models.Customer.create({
        name: formData.name,
        lastname: formData.lastname,
        email: formData.email,
        phone: formData.phone,
        createdAt: new Date().toISOString(),
      });

      setFormData({ name: "", lastname: "", email: "", phone: "" });
      setShowModal(false);
      fetchCustomers();
    } catch (error) {
      console.error("Error creating customer:", error);
      alert("Failed to create customer");
    }
  };

  // optional: future delete example
  const deleteCustomer = async (id: string) => {
    if (!canDelete) return;
    const ok = confirm("Delete customer?");
    if (!ok) return;

    try {
      await client.models.Customer.delete({ id });
      fetchCustomers();
    } catch (e) {
      console.error(e);
      alert("Delete failed");
    }
  };

  const headerNote = useMemo(() => {
    return `Permissions => Read:${permissions.canRead} Create:${permissions.canCreate} Update:${permissions.canUpdate} Delete:${permissions.canDelete}`;
  }, [permissions]);

  return (
    <div style={{ padding: 24 }}>
      <h2>Customers</h2>
      <p style={{ opacity: 0.7, marginTop: 4 }}>{headerNote}</p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <Button variation="primary" onClick={() => setShowModal(true)} isDisabled={!canCreate}>
          Add Customer
        </Button>
        <Button onClick={fetchCustomers} isLoading={loading}>
          Refresh
        </Button>
      </div>

      {/* Modal */}
      {showModal && (
        <div style={modalStyles.overlay}>
          <div style={modalStyles.modal}>
            <h3>Create New Customer</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <TextField label="First Name" name="name" value={formData.name} onChange={handleInputChange} />
              <TextField label="Last Name" name="lastname" value={formData.lastname} onChange={handleInputChange} />
              <TextField label="Email" name="email" type="email" value={formData.email} onChange={handleInputChange} />
              <TextField label="Phone" name="phone" value={formData.phone} onChange={handleInputChange} />

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button variation="link" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button variation="primary" onClick={handleSubmit} isDisabled={!canCreate}>
                  Create Customer
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Grid */}
      <div style={gridStyles.container}>
        {customers.map((c) => (
          <div key={c.id} style={gridStyles.card}>
            <h3>
              {c.name} {c.lastname}
            </h3>
            <p>
              <strong>Email:</strong> {c.email || "N/A"}
            </p>
            <p>
              <strong>Phone:</strong> {c.phone || "N/A"}
            </p>

            {/* Example delete button */}
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button size="small" isDisabled={!canUpdate}>
                Edit (later)
              </Button>
              <Button
                size="small"
                variation="destructive"
                isDisabled={!canDelete}
                onClick={() => deleteCustomer(c.id)}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {!customers.length && (
        <div style={{ marginTop: 20, opacity: 0.7 }}>
          No customers found.
        </div>
      )}
    </div>
  );
}

const modalStyles = {
  overlay: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  modal: {
    backgroundColor: "#fff",
    padding: 24,
    borderRadius: 8,
    width: 420,
    maxWidth: "92%",
  },
};

const gridStyles = {
  container: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
    gap: 16,
    marginTop: 24,
  },
  card: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    transition: "transform 0.2s",
  },
};
