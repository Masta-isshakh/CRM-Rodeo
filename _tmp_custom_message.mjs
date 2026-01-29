// amplify/auth/custom-message/handler.ts
function normalizeOrigin(origin) {
  return (origin || "").trim().replace(/\/+$/, "");
}
function buildUrls(email) {
  const origin = normalizeOrigin(process.env.APP_ORIGIN || "");
  const safeEmail = encodeURIComponent((email || "").trim().toLowerCase());
  const signInUrl = `${origin}/`;
  const setPasswordUrl = `${origin}/set-password?email=${safeEmail}`;
  return { signInUrl, setPasswordUrl };
}
var handler = async (event) => {
  const email = event.request.userAttributes?.email ?? "";
  const name = event.request.userAttributes?.name || event.request.userAttributes?.given_name || event.request.userAttributes?.["custom:fullName"] || "";
  const { signInUrl, setPasswordUrl } = buildUrls(email);
  if (event.triggerSource === "CustomMessage_AdminCreateUser") {
    const usernamePlaceholder = event.request.usernameParameter;
    const codePlaceholder = event.request.codeParameter;
    event.response.emailSubject = "You\u2019ve been invited \u2014 Rodeo Drive CRM";
    event.response.emailMessage = [
      `Hello${name ? " " + name : ""},`,
      "",
      "Your account has been created.",
      "",
      `1) Set your password: ${setPasswordUrl}`,
      `2) Sign in here: ${signInUrl}`,
      "",
      "If you are asked for a username and temporary password/code, use:",
      `Username: ${usernamePlaceholder}`,
      `Temporary password/code: ${codePlaceholder}`,
      "",
      "\u2014 Rodeo Drive CRM"
    ].join("\n");
    return event;
  }
  if (event.triggerSource === "CustomMessage_ForgotPassword") {
    const codePlaceholder = event.request.codeParameter;
    event.response.emailSubject = "Your verification code \u2014 Rodeo Drive CRM";
    event.response.emailMessage = [
      `Hello${name ? " " + name : ""},`,
      "",
      "Use the code below to set your password:",
      `${codePlaceholder}`,
      "",
      `Open Set Password page: ${setPasswordUrl}`,
      `Sign in after update: ${signInUrl}`,
      "",
      "\u2014 Rodeo Drive CRM"
    ].join("\n");
    return event;
  }
  return event;
};
export {
  handler
};
