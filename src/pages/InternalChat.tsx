import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";
import { useLanguage } from "../i18n/LanguageContext";
import "./InternalChat.css";

type ChatUser = {
  email: string;
  fullName: string;
};

type ChatMessage = {
  id: string;
  conversationKey: string;
  channelType?: "GLOBAL" | "DIRECT";
  senderEmail: string;
  senderName?: string;
  recipientEmail?: string;
  body: string;
  createdAt: string;
};

type ConversationItem = {
  key: string;
  label: string;
  subLabel: string;
  channelType: "GLOBAL" | "DIRECT";
  recipientEmail?: string;
};

const GLOBAL_KEY = "global:all";
const GLOBAL_LABEL = "All Team";
const POLL_MS = 8000;

function normalizeEmail(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

function conversationKeyForDirect(a: string, b: string): string {
  const x = normalizeEmail(a);
  const y = normalizeEmail(b);
  return x < y ? `direct:${x}|${y}` : `direct:${y}|${x}`;
}

function formatTime(value: string): string {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function InternalChat({ permissions }: PageProps) {
  const { t } = useLanguage();
  const client = useMemo(() => getDataClient(), []);
  const ChatModel = (client.models as any).InternalChatMessage as any;
  const UserModel = (client.models as any).UserProfile as any;

  const [selfEmail, setSelfEmail] = useState("");
  const [selfName, setSelfName] = useState("");
  const [selfOwner, setSelfOwner] = useState("");
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationKey, setConversationKey] = useState(GLOBAL_KEY);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const listEndRef = useRef<HTMLDivElement | null>(null);

  const canSend = permissions.canCreate || permissions.canUpdate;

  useEffect(() => {
    if (!permissions.canRead) return;

    let mounted = true;

    const init = async () => {
      setLoading(true);
      try {
        const authUser = await getCurrentUser();
        const loginId = String(authUser?.signInDetails?.loginId ?? authUser?.username ?? "").trim();
        const email = normalizeEmail(loginId);
        const owner = email && authUser?.userId ? `${authUser.userId}::${email}` : email;

        if (!mounted) return;
        setSelfEmail(email);
        setSelfOwner(owner);

        if (UserModel) {
          const profileRes = await UserModel.list({ limit: 1000 });
          const rows = (profileRes?.data ?? []) as Array<Record<string, any>>;

          const directory = rows
            .map((row) => ({
              email: normalizeEmail(String(row?.email ?? "")),
              fullName: String(row?.fullName ?? row?.email ?? "").trim(),
            }))
            .filter((u) => !!u.email)
            .sort((a, b) => a.fullName.localeCompare(b.fullName));

          if (!mounted) return;
          setUsers(directory);

          const mine = directory.find((u) => u.email === email);
          setSelfName(mine?.fullName || email || "You");
        }
      } catch (error: any) {
        if (!mounted) return;
        setStatus(error?.message || t("Unable to initialize chat."));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();
    return () => {
      mounted = false;
    };
  }, [UserModel, permissions.canRead, t]);

  const conversations = useMemo(() => {
    const base: ConversationItem[] = [
      {
        key: GLOBAL_KEY,
        label: t(GLOBAL_LABEL),
        subLabel: t("Company-wide announcements and updates"),
        channelType: "GLOBAL",
      },
    ];

    const roster = users
      .filter((u) => u.email && u.email !== selfEmail)
      .map((u) => ({
        key: conversationKeyForDirect(selfEmail, u.email),
        label: u.fullName || u.email,
        subLabel: u.email,
        channelType: "DIRECT" as const,
        recipientEmail: u.email,
      }));

    return [...base, ...roster];
  }, [selfEmail, t, users]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.key === conversationKey) ?? conversations[0],
    [conversationKey, conversations]
  );

  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => c.label.toLowerCase().includes(q) || c.subLabel.toLowerCase().includes(q)
    );
  }, [conversations, query]);

  const loadMessages = async (key: string) => {
    if (!ChatModel) {
      setStatus(t("Internal chat data model is not available. Please deploy backend changes."));
      return;
    }

    try {
      const res = await ChatModel.list({
        filter: { conversationKey: { eq: key } },
        limit: 600,
      });

      const rows = (res?.data ?? []) as Array<Record<string, any>>;
      const ordered = rows
        .map((row) => ({
          id: String(row?.id ?? ""),
          conversationKey: String(row?.conversationKey ?? ""),
          channelType: row?.channelType as "GLOBAL" | "DIRECT" | undefined,
          senderEmail: normalizeEmail(String(row?.senderEmail ?? "")),
          senderName: String(row?.senderName ?? "").trim(),
          recipientEmail: normalizeEmail(String(row?.recipientEmail ?? "")),
          body: String(row?.body ?? ""),
          createdAt: String(row?.createdAt ?? ""),
        }))
        .filter((row) => !!row.id && !!row.createdAt)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      setMessages(ordered);
      setStatus("");
    } catch (error: any) {
      setStatus(error?.message || t("Failed to load messages."));
    }
  };

  useEffect(() => {
    if (!permissions.canRead || !conversationKey) return;
    loadMessages(conversationKey);

    const timer = window.setInterval(() => {
      loadMessages(conversationKey);
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [ChatModel, conversationKey, permissions.canRead]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const sendCurrentMessage = async () => {
    if (!canSend || sending) return;

    const body = draft.trim();
    if (!body) return;
    if (!ChatModel) {
      setStatus(t("Internal chat data model is not available. Please deploy backend changes."));
      return;
    }

    setSending(true);
    setStatus("");

    try {
      await ChatModel.create({
        messageOwner: selfOwner || selfEmail,
        conversationKey,
        channelType: activeConversation?.channelType ?? "GLOBAL",
        senderEmail: selfEmail,
        senderName: selfName,
        recipientEmail: activeConversation?.recipientEmail,
        body,
        createdAt: new Date().toISOString(),
      });

      setDraft("");
      await loadMessages(conversationKey);
    } catch (error: any) {
      setStatus(error?.message || t("Message could not be sent."));
    } finally {
      setSending(false);
    }
  };

  const onSend = async (event: FormEvent) => {
    event.preventDefault();
    await sendCurrentMessage();
  };

  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>{t("You do not have access to this page.")}</div>;
  }

  return (
    <section className="chatx-shell">
      <div className="chatx-backdrop" />
      <header className="chatx-header">
        <div>
          <p className="chatx-kicker">{t("Internal Communication")}</p>
          <h2>{t("Rodeo Team Chat")}</h2>
        </div>
        <div className="chatx-badges">
          <span>{users.length + 1} {t("members")}</span>
          <span>{activeConversation?.channelType === "GLOBAL" ? t("Broadcast") : t("Direct")}</span>
        </div>
      </header>

      <div className="chatx-grid">
        <aside className="chatx-sidebar" aria-label={t("Conversations")}> 
          <div className="chatx-search-wrap">
            <i className="fas fa-search" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search people or channels")}
              aria-label={t("Search conversations")}
            />
          </div>

          <div className="chatx-conversations">
            {filteredConversations.map((conv) => (
              <button
                key={conv.key}
                type="button"
                className={conv.key === conversationKey ? "is-active" : ""}
                onClick={() => setConversationKey(conv.key)}
              >
                <span className="chatx-avatar">{conv.label.slice(0, 1).toUpperCase()}</span>
                <span className="chatx-title-wrap">
                  <strong>{conv.label}</strong>
                  <small>{conv.subLabel}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <article className="chatx-thread" aria-live="polite">
          <div className="chatx-thread-head">
            <div>
              <h3>{activeConversation?.label ?? t(GLOBAL_LABEL)}</h3>
              <p>{activeConversation?.subLabel || t("Real-time team communication")}</p>
            </div>
            <button type="button" onClick={() => loadMessages(conversationKey)}>
              <i className="fas fa-rotate-right" aria-hidden="true" /> {t("Refresh")}
            </button>
          </div>

          <div className="chatx-messages">
            {loading && <p className="chatx-empty">{t("Loading...")}</p>}
            {!loading && messages.length === 0 && (
              <p className="chatx-empty">{t("No messages yet. Start the conversation.")}</p>
            )}

            {messages.map((message) => {
              const mine = message.senderEmail === selfEmail;
              return (
                <div key={message.id} className={`chatx-msg ${mine ? "mine" : "other"}`}>
                  <div className="chatx-msg-card">
                    <div className="chatx-msg-meta">
                      <strong>{mine ? t("You") : (message.senderName || message.senderEmail)}</strong>
                      <time>{formatTime(message.createdAt)}</time>
                    </div>
                    <p>{message.body}</p>
                  </div>
                </div>
              );
            })}
            <div ref={listEndRef} />
          </div>

          <form className="chatx-compose" onSubmit={onSend}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                canSend
                  ? t("Write a message and press Enter")
                  : t("You can view messages only")
              }
              disabled={!canSend || sending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendCurrentMessage();
                }
              }}
            />
            <button type="submit" disabled={!canSend || sending || !draft.trim()}>
              <i className="fas fa-paper-plane" aria-hidden="true" /> {sending ? t("Sending...") : t("Send")}
            </button>
          </form>
        </article>
      </div>

      {status && <div className="chatx-status">{status}</div>}
    </section>
  );
}
