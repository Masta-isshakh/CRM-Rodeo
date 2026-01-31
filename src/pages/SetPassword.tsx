import { useMemo, useState } from "react";
import { signIn, confirmSignIn, resetPassword, confirmResetPassword } from "aws-amplify/auth";

function getParam(name: string) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name) || "";
}

export default function SetPasswordPage() {
  const emailFromLink = useMemo(() => getParam("email"), []);
  const usernameFromLink = useMemo(() => getParam("username"), []);

  // Mode: FIRST_TIME (temp password) OR RESET (code)
  const [mode, setMode] = useState<"FIRST_TIME" | "RESET">("FIRST_TIME");

  // FIRST_TIME
  const [username, setUsername] = useState(usernameFromLink || emailFromLink);
  const [tempPassword, setTempPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  // RESET
  const [resetUsername, setResetUsername] = useState(emailFromLink);
  const [code, setCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetNewPassword2, setResetNewPassword2] = useState("");

  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const goHome = () => window.location.assign("/");

  const doFirstTime = async () => {
    const u = username.trim();
    const t = tempPassword;

    if (!u || !t) throw new Error("Username and temporary password are required.");
    if (!newPassword || newPassword.length < 8) throw new Error("New password must be at least 8 characters.");
    if (newPassword !== newPassword2) throw new Error("New password confirmation does not match.");

    setStatus("Signing in with temporary password...");
    const res = await signIn({ username: u, password: t });

    // NEW_PASSWORD_REQUIRED
    if (res?.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
      setStatus("Setting your new password...");
      await confirmSignIn({ challengeResponse: newPassword });
      setStatus("Password set. Redirecting...");
      goHome();
      return;
    }

    if (res?.isSignedIn) {
      setStatus("Signed in. Redirecting...");
      goHome();
      return;
    }

    setStatus("Unexpected sign-in step. Contact admin.");
  };

  const startReset = async () => {
    const u = resetUsername.trim();
    if (!u) throw new Error("Email/username is required.");
    setStatus("Requesting reset code...");
    await resetPassword({ username: u });
    setStatus("Reset code sent. Check email and enter the code below.");
  };

  const finishReset = async () => {
    const u = resetUsername.trim();
    if (!u) throw new Error("Email/username is required.");
    if (!code.trim()) throw new Error("Verification code is required.");
    if (!resetNewPassword || resetNewPassword.length < 8) throw new Error("New password must be at least 8 characters.");
    if (resetNewPassword !== resetNewPassword2) throw new Error("New password confirmation does not match.");

    setStatus("Confirming reset...");
    await confirmResetPassword({
      username: u,
      confirmationCode: code.trim(),
      newPassword: resetNewPassword,
    });

    setStatus("Password reset. Redirecting...");
    goHome();
  };

  const onSubmit = async () => {
    setLoading(true);
    setStatus("");
    try {
      if (mode === "FIRST_TIME") await doFirstTime();
      else await finishReset();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message || "Failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "#f6f7fb" }}>
      <div style={{ width: "100%", maxWidth: 540, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 18 }}>
        <h2 style={{ marginTop: 0 }}>Set your password</h2>

        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            onClick={() => setMode("FIRST_TIME")}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: mode === "FIRST_TIME" ? "#111827" : "#fff",
              color: mode === "FIRST_TIME" ? "#fff" : "#111827",
              cursor: "pointer",
            }}
          >
            First-time setup (temp password)
          </button>

          <button
            onClick={() => setMode("RESET")}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: mode === "RESET" ? "#111827" : "#fff",
              color: mode === "RESET" ? "#fff" : "#111827",
              cursor: "pointer",
            }}
          >
            Reset password (code)
          </button>
        </div>

        {mode === "FIRST_TIME" ? (
          <>
            <label style={{ display: "block", marginTop: 10 }}>
              Username (from email)
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
                placeholder="Should already be filled from the invite link"
              />
            </label>

            <label style={{ display: "block", marginTop: 10 }}>
              Temporary password (from email)
              <input
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
              />
            </label>

            <label style={{ display: "block", marginTop: 10 }}>
              New password
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
              />
            </label>

            <label style={{ display: "block", marginTop: 10 }}>
              Confirm new password
              <input
                type="password"
                value={newPassword2}
                onChange={(e) => setNewPassword2(e.target.value)}
                style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
              />
            </label>
          </>
        ) : (
          <>
            <label style={{ display: "block", marginTop: 10 }}>
              Email / Username
              <input
                value={resetUsername}
                onChange={(e) => setResetUsername(e.target.value)}
                style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
              />
            </label>

            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  setStatus("");
                  try {
                    await startReset();
                  } catch (e: any) {
                    console.error(e);
                    setStatus(e?.message || "Failed.");
                  } finally {
                    setLoading(false);
                  }
                }}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}
              >
                Send reset code
              </button>
            </div>

            <label style={{ display: "block", marginTop: 10 }}>
              Verification code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
              />
            </label>

            <label style={{ display: "block", marginTop: 10 }}>
              New password
              <input
                type="password"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
              />
            </label>

            <label style={{ display: "block", marginTop: 10 }}>
              Confirm new password
              <input
                type="password"
                value={resetNewPassword2}
                onChange={(e) => setResetNewPassword2(e.target.value)}
                style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
              />
            </label>
          </>
        )}

        <button
          disabled={loading}
          onClick={onSubmit}
          style={{
            marginTop: 14,
            width: "100%",
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #111827",
            background: "#111827",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {loading ? "Please wait..." : mode === "FIRST_TIME" ? "Set password" : "Confirm reset"}
        </button>

        {status && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb", background: "#fafafa" }}>
            {status}
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
          If login says “incorrect”, it usually means the user is still in <b>FORCE_CHANGE_PASSWORD</b>. Use this page first.
        </div>
      </div>
    </div>
  );
}
