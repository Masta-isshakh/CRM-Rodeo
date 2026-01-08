import { useMemo, useState } from "react";
import { Button, TextField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { resetPassword, confirmResetPassword } from "aws-amplify/auth";

export default function SetPassword() {
  const emailFromUrl = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get("email") || "").trim().toLowerCase();
  }, []);

  const [email, setEmail] = useState(emailFromUrl);
  const [codeSent, setCodeSent] = useState(false);

  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [status, setStatus] = useState<string>("");

  const sendCode = async () => {
    setStatus("");
    try {
      if (!email) throw new Error("Email is required.");
      await resetPassword({ username: email });
      setCodeSent(true);
      setStatus("Verification code sent to your email.");
    } catch (e: any) {
      setStatus(e?.message || "Failed to send code.");
    }
  };

  const setPassword = async () => {
    setStatus("");
    try {
      if (!email) throw new Error("Email is required.");
      if (!code) throw new Error("Code is required.");
      if (!newPassword) throw new Error("New password is required.");

      await confirmResetPassword({
        username: email,
        confirmationCode: code,
        newPassword,
      });

      setStatus("Password set successfully. You can now go to the login page.");
    } catch (e: any) {
      setStatus(e?.message || "Failed to set password.");
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
      <h2>Set your password</h2>
      <p style={{ opacity: 0.8 }}>
        Enter your email, request a verification code, then set your new password.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <TextField
          label="Email"
          value={email}
          onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
        />

        {!codeSent ? (
          <Button variation="primary" onClick={sendCode}>
            Send verification code
          </Button>
        ) : (
          <>
            <TextField
              label="Verification code"
              value={code}
              onChange={(e) => setCode((e.target as HTMLInputElement).value)}
            />
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword((e.target as HTMLInputElement).value)}
            />
            <Button variation="primary" onClick={setPassword}>
              Set password
            </Button>
          </>
        )}

        {status && (
          <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
