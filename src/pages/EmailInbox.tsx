import { useEffect } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import "./EmailInbox.css";

const WORKMAIL_URL = "https://rodeodrive.awsapps.com/mail";

export default function EmailInbox() {
  const { t } = useLanguage();

  useEffect(() => {
    window.location.assign(WORKMAIL_URL);
  }, []);

  return (
    <section className="mailx-wrap">
      <div className="mailx-card" role="status" aria-live="polite">
        <h2>{t("Opening Email Inbox")}</h2>
        <p>
          {t("You are being redirected to Amazon WorkMail. Please sign in to manage your inbox.")}
        </p>
        <a href={WORKMAIL_URL} target="_self" rel="noreferrer">
          {t("Open WorkMail now")}
        </a>
      </div>
    </section>
  );
}
