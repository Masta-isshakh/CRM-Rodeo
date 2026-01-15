import { useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type Role = "ADMIN" | "SALES" | "SALES_MANAGER" | "SUPPORT";

export default function UserManagement() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("SALES");

  const [result, setResult] = useState<any>(null);
  const [status, setStatus] = useState<string>("");

  const inviteLink = useMemo(() => {
    if (!email) return "";
    return `${window.location.origin}/set-password?email=${encodeURIComponent(
      email.trim().toLowerCase()
    )}`;
  }, [email]);

  const invite = async () => {
    setStatus("");
    setResult(null);

    try {
      const e = email.trim().toLowerCase();
      const n = fullName.trim();
      if (!e || !n) throw new Error("Email and full name are required.");

      const { data } = await client.mutations.inviteUser({
        email: e,
        fullName: n,
        role,
      });

      setResult(data);
      setStatus("User invited successfully. Copy the link and send it to the user.");
    } catch (err: any) {
      setStatus(err?.message || "Invite failed.");
    }
  };

  const copy = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setStatus("Invite link copied.");
  };

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h2>User Management (Admin)</h2>
      <p style={{ opacity: 0.8 }}>
        Create internal users. No public sign-up.
      </p>

      <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
        <TextField
          label="Email"
          value={email}
          onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
        />
        <TextField
          label="Full name"
          value={fullName}
          onChange={(e) => setFullName((e.target as HTMLInputElement).value)}
        />
        <SelectField
          label="Role"
          value={role}
          onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)}
        >
          <option value="ADMIN">ADMIN</option>
          <option value="SALES">SALES</option>
          <option value="SALES_MANAGER">SALES_MANAGER</option>
          <option value="SUPPORT">SUPPORT</option>
        </SelectField>

        <Button variation="primary" onClick={invite}>
          Invite user
        </Button>

        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Invite link</div>
          <div style={{ wordBreak: "break-all", opacity: 0.85 }}>
            {inviteLink || "Enter an email to generate the invite link."}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <Button onClick={copy} isDisabled={!inviteLink}>
              Copy link
            </Button>
            <Button
              onClick={() => {
                window.location.href = "/"; // retour login
              }}
              variation="link"
            >
              Back to login
            </Button>
          </div>
        </div>

        {status && (
          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            {status}
          </div>
        )}

        {result && (
          <pre style={{ background: "#f7f7f7", padding: 12, borderRadius: 8 }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
