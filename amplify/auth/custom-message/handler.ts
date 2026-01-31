import type { CustomMessageTriggerHandler } from "aws-lambda";

function normalizeOrigin(origin: string) {
  return (origin || "").trim().replace(/\/+$/, "");
}

function buildUrls(email: string, usernamePlaceholder: string) {
  const origin = normalizeOrigin(process.env.APP_ORIGIN || "");
  const safeEmail = encodeURIComponent((email || "").trim().toLowerCase());
  const safeUsername = encodeURIComponent((usernamePlaceholder || "").trim());

  // If APP_ORIGIN is missing, links become broken in email clients.
  // So we fail "soft" by still building relative, but you MUST set APP_ORIGIN.
  const base = origin || "";

  const signInUrl = `${base}/`;
  const setPasswordUrl = `${base}/set-password?email=${safeEmail}&username=${safeUsername}`;

  return { signInUrl, setPasswordUrl, base };
}

export const handler: CustomMessageTriggerHandler = async (event) => {
  const email = event.request.userAttributes?.email ?? "";
  const name =
    event.request.userAttributes?.name ||
    event.request.userAttributes?.given_name ||
    event.request.userAttributes?.["custom:fullName"] ||
    "";

  const usernamePlaceholder = event.request.usernameParameter ?? ""; // {username}
  const codePlaceholder = event.request.codeParameter; // {####} (temp password / code)

  const { signInUrl, setPasswordUrl, base } = buildUrls(email, usernamePlaceholder);

  if (event.triggerSource === "CustomMessage_AdminCreateUser") {
    event.response.emailSubject = "You’ve been invited — Rodeo Drive CRM";

    event.response.emailMessage = [
      `Hello${name ? " " + name : ""},`,
      "",
      "Your Rodeo Drive CRM account has been created.",
      "",
      `✅ Step 1 — Set your password here (recommended):`,
      `${setPasswordUrl}`,
      "",
      `✅ Step 2 — Sign in after setting password:`,
      `${signInUrl}`,
      "",
      "If you prefer manual entry, use:",
      `Username: ${usernamePlaceholder}`,
      `Temporary password: ${codePlaceholder}`,
      "",
      base
        ? ""
        : "IMPORTANT: Admin must configure APP_ORIGIN for correct links (your links might appear broken).",
      "— Rodeo Drive CRM",
    ]
      .filter(Boolean)
      .join("\n");

    return event;
  }

  if (event.triggerSource === "CustomMessage_ForgotPassword") {
    event.response.emailSubject = "Your verification code — Rodeo Drive CRM";
    event.response.emailMessage = [
      `Hello${name ? " " + name : ""},`,
      "",
      "Use the code below to reset your password:",
      `${codePlaceholder}`,
      "",
      `Reset page: ${setPasswordUrl}`,
      `Sign in after update: ${signInUrl}`,
      "",
      "— Rodeo Drive CRM",
    ].join("\n");

    return event;
  }

  return event;
};
