import { useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

export default function AdminUsers() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"ADMIN" | "SALES" | "SUPPORT">("SALES");
  const [status, setStatus] = useState<string>("");

  const invite = async () => {
    setStatus("Inviting...");

    try {
      // Custom mutations are available on client.mutations.* (Amplify pattern)
      await client.mutations.inviteUser({
        email,
        fullName,
        role,
      });

      setStatus(`Done. Invitation sent to ${email}.`);
      setEmail("");
      setFullName("");
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Invite failed. Check console.");
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <h2>User Management</h2>
      <p>Create users (invite-only). Users will set their password on first login.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <TextField
          label="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <SelectField
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as any)}
        >
          <option value="ADMIN">ADMIN</option>
          <option value="SALES">SALES</option>
          <option value="SUPPORT">SUPPORT</option>
        </SelectField>

        <Button variation="primary" onClick={invite}>
          Invite usser 
        </Button>

        {status && <p>{status}</p>}
      </div>
    </div>
  );
}
