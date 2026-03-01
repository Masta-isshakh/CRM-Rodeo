// amplify/auth/custom-message/handler.ts
import type { CustomMessageTriggerHandler, CustomMessageTriggerEvent } from "aws-lambda";

function normalizeOrigin(origin: string) {
  return (origin || "").trim().replace(/\/+$/, "");
}

function buildUrls(username: string, email: string, mode?: "first" | "reset") {
  const origin = normalizeOrigin(process.env.APP_ORIGIN || "");
  const base = origin || "";

  const safeUsername = encodeURIComponent((username || "").trim());
  const safeEmail = encodeURIComponent((email || "").trim().toLowerCase());

  const signInUrl = `${base}/`;
  const setPasswordUrl =
    mode === "reset"
      ? `${base}/set-password?mode=reset&username=${safeUsername}&email=${safeEmail}`
      : `${base}/set-password?mode=first&username=${safeUsername}&email=${safeEmail}`;

  return { signInUrl, setPasswordUrl, base };
}

export const handler: CustomMessageTriggerHandler = async (event: CustomMessageTriggerEvent & { triggerSource: string }) => {
  const email = String(event.request.userAttributes?.email ?? "").trim();
  const name =
    event.request.userAttributes?.name ||
    event.request.userAttributes?.given_name ||
    event.request.userAttributes?.["custom:fullName"] ||
    "";

  // ✅ IMPORTANT:
  // usernameParameter / codeParameter are placeholders like {username} / {####}.
  // DO NOT use usernameParameter to build your link.
  // Use event.userName (real username) instead.
  const realUsername = String((event as any).userName ?? email ?? "").trim();

  const codePlaceholder = event.request.codeParameter; // {####} (temp password or reset code)
  const usernamePlaceholder = event.request.usernameParameter; // {username}
  const { signInUrl, setPasswordUrl, base } = buildUrls(
    realUsername,
    email,
    event.triggerSource === "CustomMessage_AdminCreateUser" ? "first" : "reset"
  );

  // AdminCreateUser => temp password flow
  if (event.triggerSource === "CustomMessage_AdminCreateUser") {
    event.response.emailSubject = "You’ve been invited — Rodeo Drive CRM";

    event.response.emailMessage = [
      `Hello${name ? " " + name : ""},`,
      "",
      "Your Rodeo Drive CRM account has been created.",
      "",
      "✅ Step 1 — Set your password here:",
      setPasswordUrl,
      "",
      "✅ Step 2 — Sign in after setting password:",
      signInUrl,
      "",
      "Manual details (if needed):",
      `Username (placeholder): ${usernamePlaceholder}`,
      `Username (resolved): ${realUsername}`,
      `Temporary password: ${codePlaceholder}`,
      "",
      base ? "" : "IMPORTANT: Admin must set APP_ORIGIN, links may be broken.",
      "— Rodeo Drive CRM",
    ]
      .filter(Boolean)
      .join("\n");

    return event;
  }

  // ForgotPassword => reset code flow
  if (event.triggerSource === "CustomMessage_ForgotPassword") {
    event.response.emailSubject = "Your reset code — Rodeo Drive CRM";
    event.response.emailMessage = [
      `Hello${name ? " " + name : ""},`,
      "",
      "Use the code below to reset your password:",
      `${codePlaceholder}`,
      "",
      "Open reset page:",
      setPasswordUrl,
      "",
      "After updating password, sign in here:",
      signInUrl,
      "",
      "— Rodeo Drive CRM",
    ].join("\n");

    return event;
  }

  // AdminResetUserPassword => reset code flow (admin-triggered)
  if ((event.triggerSource as string) === "CustomMessage_AdminResetUserPassword") {
    event.response.emailSubject = "Password reset — Rodeo Drive CRM";
    event.response.emailMessage = [
      `Hello${name ? " " + name : ""},`,
      "",
      "An admin has reset your password.",
      "Use the code below to set a new password:",
      `${codePlaceholder}`,
      "",
      "Open reset page:",
      setPasswordUrl,
      "",
      "— Rodeo Drive CRM",
    ].join("\n");

    return event;
  }

  return event;
};
