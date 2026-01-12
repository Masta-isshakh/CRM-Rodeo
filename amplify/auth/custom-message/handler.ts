import type { CustomMessageTriggerHandler } from "aws-lambda";
// Replace with direct access to process.env or your environment config
const env = {
  APP_ORIGIN: process.env.APP_ORIGIN || ""
};

function buildUrls(email: string) {
  const origin = (env.APP_ORIGIN || "").replace(/\/+$/, "");
  const safeEmail = encodeURIComponent(email.trim().toLowerCase());

  const signInUrl = `${origin}/`;
  const setPasswordUrl = `${origin}/set-password?email=${safeEmail}`;

  return { signInUrl, setPasswordUrl };
}

export const handler: CustomMessageTriggerHandler = async (event) => {
  const email = event.request.userAttributes?.email ?? "";
  const name =
    event.request.userAttributes?.name ||
    event.request.userAttributes?.given_name ||
    event.request.userAttributes?.["custom:fullName"] ||
    "";

  const { signInUrl, setPasswordUrl } = buildUrls(email);

  // 1) Invitation email sent by AdminCreateUser
  // Cognito requires you to include the username + code placeholders for this triggerSource. :contentReference[oaicite:3]{index=3}
  if (event.triggerSource === "CustomMessage_AdminCreateUser") {
    const usernamePlaceholder = event.request.usernameParameter; // typically {username}
    const codePlaceholder = event.request.codeParameter;         // typically {####}

    event.response.emailSubject = "You’ve been invited — Rodeo Drive CRM";

    event.response.emailMessage = [
      `Hello${name ? " " + name : ""},`,
      "",
      "Your account has been created.",
      "",
      `1) Set your password: ${setPasswordUrl}`,
      `2) Sign in here: ${signInUrl}`,
      "",
      "If you are asked for a username and temporary code/password, use:",
      `Username: ${usernamePlaceholder}`,
      `Temporary code/password: ${codePlaceholder}`,
      "",
      "After setting your password, return to the Sign-In link above.",
      "",
      "— Rodeo Drive CRM",
    ].join("\n");

    return event;
  }

  // 2) Verification email for resetPassword() (Forgot Password)
  if (event.triggerSource === "CustomMessage_ForgotPassword") {
    const codePlaceholder = event.request.codeParameter; // insert where you want the code :contentReference[oaicite:4]{index=4}

    event.response.emailSubject = "Your verification code — Rodeo Drive CRM";

    event.response.emailMessage = [
      `Hello${name ? " " + name : ""},`,
      "",
      "Use the code below to set your password:",
      `${codePlaceholder}`,
      "",
      `Open Set Password page: ${setPasswordUrl}`,
      `Sign in after update: ${signInUrl}`,
      "",
      "— Rodeo Drive CRM",
    ].join("\n");

    return event;
  }

  // default: do not modify other messages
  return event;
};
