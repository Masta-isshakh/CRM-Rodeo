import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";
import { matchesSearchQuery } from "../lib/searchUtils";
import { useLanguage } from "../i18n/LanguageContext";
import "./InternalChat.css";

// ─── Types ─────────────────────────────────────────────────────────────────────
type ChatUser = { email: string; fullName: string };

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

// ─── Constants ──────────────────────────────────────────────────────────────────
const GLOBAL_KEY = "global:all";
const GLOBAL_LABEL = "All Team";
const POLL_MS = 8_000;
const RECEIPT_POLL_MS = 15_000;
const UNREAD_POLL_MS = 45_000;
export const CHAT_LAST_SEEN_STORAGE_PREFIX = "crm.chat.lastSeen.";
const CONV_LAST_READ_PREFIX = "crm.chat.convread.";
const AVATAR_COLORS = [
  "#e17055", "#00b894", "#0984e3", "#6c5ce7",
  "#fd79a8", "#00cec9", "#fdcb6e", "#74b9ff",
];

// ─── Helpers ────────────────────────────────────────────────────────────────────
function normalizeEmail(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

function conversationKeyForDirect(a: string, b: string): string {
  const x = normalizeEmail(a);
  const y = normalizeEmail(b);
  return x < y ? `direct:${x}|${y}` : `direct:${y}|${x}`;
}

function formatMsgTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}


function getDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "TODAY";
  if (d.toDateString() === yesterday.toDateString()) return "YESTERDAY";
  return d
    .toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .toUpperCase();
}

function getAvatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h << 5) - h + seed.charCodeAt(i);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function getConvLastRead(convKey: string): Date | null {
  try {
    const stored = window.localStorage.getItem(`${CONV_LAST_READ_PREFIX}${convKey}`);
    if (!stored) return null;
    const d = new Date(stored);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function markConvRead(convKey: string): void {
  try {
    window.localStorage.setItem(`${CONV_LAST_READ_PREFIX}${convKey}`, new Date().toISOString());
  } catch { /* ignore */ }
}

function markGlobalSeen(email: string): void {
  const e = normalizeEmail(email);
  if (!e) return;
  try {
    window.localStorage.setItem(`${CHAT_LAST_SEEN_STORAGE_PREFIX}${e}`, new Date().toISOString());
  } catch { /* ignore */ }
}

// ─── SVG Ticks (WhatsApp style) ─────────────────────────────────────────────────
function SingleTick() {
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden="true">
      <path
        d="M1 5.5L5.5 10L15 1"
        stroke="#8696a0"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DoubleTick({ seen }: { seen: boolean }) {
  const color = seen ? "#53bdeb" : "#8696a0";
  return (
    <svg width="22" height="11" viewBox="0 0 22 11" fill="none" aria-hidden="true">
      <path
        d="M1 5.5L5.5 10L15 1"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 5.5L12.5 10L22 1"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────
export default function InternalChat({ permissions }: PageProps) {
  const { t } = useLanguage();
  const client = useMemo(() => getDataClient(), []);
  const ChatModel = useMemo(() => (client.models as any).InternalChatMessage as any, [client]);
  const UserModel = useMemo(() => (client.models as any).UserProfile as any, [client]);
  const ReceiptModel = useMemo(() => {
    const m = (client.models as any).ChatReadReceipt;
    return m ?? null;
  }, [client]);

  // ── Core state ───────────────────────────────────────────────────────────────
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
  const [statusMsg, setStatusMsg] = useState("");

  // ── WhatsApp extras ──────────────────────────────────────────────────────────
  const [dmUnreadMap, setDmUnreadMap] = useState<Record<string, number>>({});
  const [readReceipts, setReadReceipts] = useState<Record<string, string>>({}); // email → lastReadAt ISO
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const myReceiptIds = useRef<Record<string, string | null>>({});
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string>("");
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = permissions.canCreate || permissions.canUpdate;

  // ── Initialization ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!permissions.canRead) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const authUser = await getCurrentUser();
        const loginId = String(
          authUser?.signInDetails?.loginId ?? authUser?.username ?? ""
        ).trim();
        const email = normalizeEmail(loginId);
        const owner =
          email && authUser?.userId ? `${authUser.userId}::${email}` : email;
        if (!mounted) return;
        setSelfEmail(email);
        setSelfOwner(owner);
        markGlobalSeen(email);

        if (UserModel) {
          const res = await UserModel.list({ limit: 1000 });
          const rows = (res?.data ?? []) as Array<Record<string, any>>;
          const directory = rows
            .map((r) => ({
              email: normalizeEmail(String(r?.email ?? "")),
              fullName: String(r?.fullName ?? r?.email ?? "").trim(),
            }))
            .filter((u) => !!u.email)
            .sort((a, b) => a.fullName.localeCompare(b.fullName));
          if (!mounted) return;
          setUsers(directory);
          const mine = directory.find((u) => u.email === email);
          setSelfName(mine?.fullName || email || "You");
        }
      } catch (err: any) {
        if (mounted) setStatusMsg(err?.message || t("Unable to initialize chat."));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [UserModel, permissions.canRead, t]);

  // ── Conversation list ────────────────────────────────────────────────────────
  const conversations = useMemo((): ConversationItem[] => {
    const base: ConversationItem[] = [{
      key: GLOBAL_KEY,
      label: t(GLOBAL_LABEL),
      subLabel: t("Company-wide channel"),
      channelType: "GLOBAL",
    }];
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

  const sortedConversations = useMemo(() => {
    const filtered = query.trim()
      ? conversations.filter(
          (c) => matchesSearchQuery([c.label, c.subLabel], query)
        )
      : conversations;
    return [...filtered].sort(
      (a, b) =>
        ((dmUnreadMap[b.key] ?? 0) > 0 ? 1 : 0) -
        ((dmUnreadMap[a.key] ?? 0) > 0 ? 1 : 0)
    );
  }, [conversations, query, dmUnreadMap]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.key === conversationKey) ?? conversations[0],
    [conversationKey, conversations]
  );

  // ── Load messages ────────────────────────────────────────────────────────────
  const loadMessages = useCallback(
    async (key: string) => {
      if (!ChatModel) return;
      try {
        const res = await ChatModel.list({
          filter: { conversationKey: { eq: key } },
          limit: 600,
        });
        const rows = (res?.data ?? []) as Array<Record<string, any>>;
        const ordered = rows
          .map((r) => ({
            id: String(r?.id ?? ""),
            conversationKey: String(r?.conversationKey ?? ""),
            channelType: r?.channelType as "GLOBAL" | "DIRECT" | undefined,
            senderEmail: normalizeEmail(String(r?.senderEmail ?? "")),
            senderName: String(r?.senderName ?? "").trim(),
            recipientEmail: normalizeEmail(String(r?.recipientEmail ?? "")),
            body: String(r?.body ?? ""),
            createdAt: String(r?.createdAt ?? ""),
          }))
          .filter((r) => !!r.id && !!r.createdAt)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const nextLastId = ordered[ordered.length - 1]?.id ?? "";
        if (nextLastId !== lastMessageIdRef.current) {
          lastMessageIdRef.current = nextLastId;
          setMessages(ordered);
        }
        markConvRead(key);
        markGlobalSeen(selfEmail);
        setDmUnreadMap((prev) => ({ ...prev, [key]: 0 }));
        setStatusMsg("");
      } catch (err: any) {
        setStatusMsg(err?.message || t("Failed to load messages."));
      }
    },
    [ChatModel, selfEmail, t]
  );

  // ── Read receipts ────────────────────────────────────────────────────────────
  const loadReadReceipts = useCallback(
    async (convKey: string) => {
      if (!ReceiptModel || !convKey) return;
      try {
        let rows: any[] = [];
        try {
          const res = await ReceiptModel.chatReadReceiptsByConversation?.({
            conversationKey: convKey,
            limit: 200,
          });
          rows = res?.data ?? [];
        } catch {
          const res = await ReceiptModel.list?.({
            filter: { conversationKey: { eq: convKey } },
            limit: 200,
          });
          rows = res?.data ?? [];
        }
        const map: Record<string, string> = {};
        for (const r of rows) {
          const e = normalizeEmail(String(r?.readerEmail ?? ""));
          const ra = String(r?.lastReadAt ?? "");
          if (e && ra) map[e] = ra;
        }
        setReadReceipts(map);
      } catch { /* silently ignore */ }
    },
    [ReceiptModel]
  );

  const upsertMyReceipt = useCallback(
    async (convKey: string, email: string) => {
      if (!ReceiptModel || !email || !convKey) return;
      const now = new Date().toISOString();
      const cachedId = myReceiptIds.current[convKey];
      try {
        if (cachedId) {
          await ReceiptModel.update?.({ id: cachedId, lastReadAt: now });
          return;
        }
        // Query to find existing receipt
        let rows: any[] = [];
        try {
          const res = await ReceiptModel.chatReadReceiptsByConversation?.({
            conversationKey: convKey,
            limit: 200,
          });
          rows = res?.data ?? [];
        } catch {
          const res = await ReceiptModel.list?.({
            filter: { conversationKey: { eq: convKey } },
            limit: 100,
          });
          rows = res?.data ?? [];
        }
        const mine = rows.find(
          (r: any) => normalizeEmail(String(r?.readerEmail ?? "")) === email
        );
        if (mine?.id) {
          myReceiptIds.current[convKey] = mine.id;
          await ReceiptModel.update?.({ id: mine.id, lastReadAt: now });
        } else {
          const created = await ReceiptModel.create?.({
            conversationKey: convKey,
            readerEmail: email,
            lastReadAt: now,
          });
          myReceiptIds.current[convKey] = created?.data?.id ?? null;
        }
      } catch { /* silently ignore receipt errors */ }
    },
    [ReceiptModel]
  );

  // ── Message polling ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!permissions.canRead || !conversationKey) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden) return;
      void loadMessages(conversationKey);
    };
    void loadMessages(conversationKey);
    const timer = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(timer);
  }, [ChatModel, conversationKey, permissions.canRead, loadMessages]);

  // ── Read receipt polling ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!selfEmail || !conversationKey) return;
    void upsertMyReceipt(conversationKey, selfEmail);
    void loadReadReceipts(conversationKey);
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void upsertMyReceipt(conversationKey, selfEmail);
      void loadReadReceipts(conversationKey);
    }, RECEIPT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [conversationKey, selfEmail, upsertMyReceipt, loadReadReceipts]);

  // ── Background unread poll ───────────────────────────────────────────────────
  useEffect(() => {
    if (!permissions.canRead || !selfEmail || !ChatModel || conversations.length === 0) return;
    const convSet = new Set(conversations.map((c) => c.key));
    let cancelled = false;

    const poll = async () => {
      if (cancelled || document.hidden) return;
      try {
        const res = await ChatModel.list({ limit: 800 });
        const rows = (res?.data ?? []) as Array<Record<string, any>>;
        const next: Record<string, number> = {};

        for (const conv of conversations) {
          next[conv.key] = 0;
        }

        for (const msg of rows) {
          const convKey = String(msg?.conversationKey ?? "");
          if (!convSet.has(convKey)) continue;
          if (convKey === conversationKey) continue;

          const sender = normalizeEmail(String(msg?.senderEmail ?? ""));
          if (!sender || sender === selfEmail) continue;

          const createdAtRaw = String(msg?.createdAt ?? "");
          const createdAtMs = Date.parse(createdAtRaw);
          if (!Number.isFinite(createdAtMs)) continue;

          const lastRead = getConvLastRead(convKey);
          if (lastRead && createdAtMs <= lastRead.getTime()) continue;

          next[convKey] = (next[convKey] ?? 0) + 1;
        }

        next[conversationKey] = 0;
        if (!cancelled) setDmUnreadMap(next);
      } catch {
        if (!cancelled) {
          setDmUnreadMap((prev) => ({ ...prev, [conversationKey]: 0 }));
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ChatModel, conversations, selfEmail, conversationKey, permissions.canRead]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // ── Switch conversation ──────────────────────────────────────────────────────
  const goToConversation = (key: string) => {
    markConvRead(key);
    setMessages([]);
    setReadReceipts({});
    setDmUnreadMap((prev) => ({ ...prev, [key]: 0 }));
    setConversationKey(key);
    setMobileShowChat(true);
    setTimeout(() => draftRef.current?.focus(), 120);
  };

  // ── Send message ─────────────────────────────────────────────────────────────
  const sendCurrentMessage = async () => {
    if (!canSend || sending || !draft.trim()) return;
    if (!ChatModel) {
      setStatusMsg(t("Chat backend not yet deployed."));
      return;
    }
    setSending(true);
    setStatusMsg("");
    try {
      await ChatModel.create({
        messageOwner: selfOwner || selfEmail,
        conversationKey,
        channelType: activeConversation?.channelType ?? "GLOBAL",
        senderEmail: selfEmail,
        senderName: selfName,
        recipientEmail: activeConversation?.recipientEmail,
        body: draft.trim(),
        createdAt: new Date().toISOString(),
      });
      setDraft("");
      await loadMessages(conversationKey);
    } catch (err: any) {
      setStatusMsg(err?.message || t("Message could not be sent."));
    } finally {
      setSending(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await sendCurrentMessage();
  };

  // ── Message seen status ──────────────────────────────────────────────────────
  const getMsgStatus = (msg: ChatMessage): "sent" | "seen" => {
    if (activeConversation?.channelType !== "DIRECT") return "sent";
    const recip = activeConversation?.recipientEmail;
    if (!recip) return "sent";
    const recipReadAt = readReceipts[recip];
    if (!recipReadAt) return "sent";
    try {
      return new Date(recipReadAt) >= new Date(msg.createdAt) ? "seen" : "sent";
    } catch {
      return "sent";
    }
  };

  // ── Message grouping ─────────────────────────────────────────────────────────
  type GroupMsg = ChatMessage & { isFirst: boolean; isLast: boolean };
  const groupedMessages = useMemo(
    (): GroupMsg[] =>
      messages.map((msg, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const samePrev =
          prev?.senderEmail === msg.senderEmail &&
          new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() <
            5 * 60_000;
        const sameNext =
          next?.senderEmail === msg.senderEmail &&
          new Date(next.createdAt).getTime() - new Date(msg.createdAt).getTime() <
            5 * 60_000;
        return { ...msg, isFirst: !samePrev, isLast: !sameNext };
      }),
    [messages]
  );

  // ── Permission guard ─────────────────────────────────────────────────────────
  if (!permissions.canRead) {
    return (
      <div className="wa-no-access">{t("You do not have access to this page.")}</div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const seenDays = new Set<string>();

  return (
    <div className={`wa-shell${mobileShowChat ? " mobile-chat-open" : ""}`}>

      {/* ─── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className="wa-sidebar">
        <div className="wa-sidebar-header">
          <div className="wa-sidebar-brand">
            <i className="fas fa-comments" aria-hidden="true" />
            <span>{t("Team Chat")}</span>
          </div>
          <div className="wa-member-count">
            {users.length + 1}&nbsp;{t("members")}
          </div>
        </div>

        <div className="wa-search-wrap">
          <i className="fas fa-search" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search or start new chat")}
            aria-label={t("Search conversations")}
          />
        </div>

        <div className="wa-conv-list" role="listbox" aria-label={t("Conversations")}>
          {sortedConversations.map((conv) => {
            const unread = dmUnreadMap[conv.key] ?? 0;
            const isActive = conv.key === conversationKey;
            const isGlobal = conv.channelType === "GLOBAL";
            return (
              <button
                key={conv.key}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`wa-conv-item${isActive ? " active" : ""}${unread > 0 ? " has-unread" : ""}`}
                onClick={() => goToConversation(conv.key)}
              >
                <div
                  className="wa-conv-avatar"
                  style={isGlobal ? {} : { background: getAvatarColor(conv.subLabel) }}
                >
                  {isGlobal ? (
                    <i className="fas fa-users" aria-hidden="true" />
                  ) : (
                    conv.label.charAt(0).toUpperCase()
                  )}
                </div>

                <div className="wa-conv-body">
                  <div className="wa-conv-top">
                    <span className="wa-conv-name">{conv.label}</span>
                  </div>
                  <div className="wa-conv-bottom">
                    <span className="wa-conv-sub">{conv.subLabel}</span>
                    {unread > 0 && (
                      <span className="wa-unread-badge" aria-label={`${unread} unread`}>
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ─── Chat panel ───────────────────────────────────────────────────────── */}
      <section className="wa-chat">

        {/* Header */}
        <div className="wa-chat-header">
          <button
            type="button"
            className="wa-back-btn"
            onClick={() => setMobileShowChat(false)}
            aria-label={t("Back")}
          >
            <i className="fas fa-arrow-left" aria-hidden="true" />
          </button>

          <div
            className="wa-chat-avatar"
            style={
              activeConversation?.channelType === "GLOBAL"
                ? {}
                : { background: getAvatarColor(activeConversation?.subLabel ?? "") }
            }
          >
            {activeConversation?.channelType === "GLOBAL" ? (
              <i className="fas fa-users" aria-hidden="true" />
            ) : (
              (activeConversation?.label?.charAt(0) ?? "?").toUpperCase()
            )}
          </div>

          <div className="wa-chat-header-info">
            <strong>{activeConversation?.label ?? t(GLOBAL_LABEL)}</strong>
            <span>
              {activeConversation?.channelType === "DIRECT"
                ? activeConversation.subLabel
                : `${users.length + 1} ${t("members")}`}
            </span>
          </div>

          <button
            type="button"
            className="wa-icon-btn"
            onClick={() => loadMessages(conversationKey)}
            title={t("Refresh")}
          >
            <i className="fas fa-rotate-right" aria-hidden="true" />
          </button>
        </div>

        {/* Message list */}
        <div className="wa-messages" role="log" aria-live="polite">
          {loading && (
            <div className="wa-day-sep">
              <span className="wa-day-label">{t("Loading…")}</span>
            </div>
          )}

          {!loading && messages.length === 0 && (
            <div className="wa-empty">
              <i className="fas fa-lock" aria-hidden="true" />
              <p>{t("No messages yet. Say hello!")}</p>
            </div>
          )}

          {groupedMessages.map((msg) => {
            const mine = msg.senderEmail === selfEmail;
            const dayLabel = getDayLabel(msg.createdAt);
            const showDay = !!dayLabel && !seenDays.has(dayLabel);
            if (showDay) seenDays.add(dayLabel);
            const status = mine ? getMsgStatus(msg) : null;

            return (
              <div key={msg.id}>
                {showDay && (
                  <div className="wa-day-sep" aria-hidden="true">
                    <span className="wa-day-label">{dayLabel}</span>
                  </div>
                )}

                <div
                  className={[
                    "wa-row",
                    mine ? "wa-sent" : "wa-recv",
                    msg.isFirst ? "wa-first" : "",
                    msg.isLast ? "wa-last" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {/* Receiver avatar */}
                  {!mine && (
                    <div
                      className="wa-avatar-sm"
                      style={{
                        background: getAvatarColor(msg.senderEmail),
                        visibility: msg.isLast ? "visible" : "hidden",
                      }}
                      aria-hidden="true"
                    >
                      {(msg.senderName || msg.senderEmail).charAt(0).toUpperCase()}
                    </div>
                  )}

                  {/* Bubble */}
                  <div
                    className={[
                      "wa-bubble",
                      mine ? "wa-mine" : "wa-theirs",
                      !msg.isFirst ? "wa-grouped" : "",
                      msg.isFirst ? (mine ? "wa-tail-right" : "wa-tail-left") : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {/* Sender name (group channel only) */}
                    {!mine &&
                      msg.isFirst &&
                      activeConversation?.channelType === "GLOBAL" && (
                        <div
                          className="wa-sender-name"
                          style={{ color: getAvatarColor(msg.senderEmail) }}
                        >
                          {msg.senderName || msg.senderEmail}
                        </div>
                      )}

                    <p className="wa-msg-text">{msg.body}</p>

                    <div className="wa-msg-meta">
                      <time className="wa-msg-time">{formatMsgTime(msg.createdAt)}</time>
                      {mine && (
                        <span
                          className="wa-ticks"
                          aria-label={status === "seen" ? t("Seen") : t("Sent")}
                        >
                          {activeConversation?.channelType === "DIRECT" ? (
                            <DoubleTick seen={status === "seen"} />
                          ) : (
                            <SingleTick />
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <div ref={listEndRef} />
        </div>

        {/* Status bar */}
        {statusMsg && (
          <div className="wa-status-bar" role="alert">
            {statusMsg}
          </div>
        )}

        {/* Compose bar */}
        <form className="wa-compose" onSubmit={onSubmit}>
          <textarea
            ref={draftRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={canSend ? t("Type a message") : t("View only")}
            disabled={!canSend || sending}
            rows={1}
            onInput={(e) => {
              // Auto-resize textarea
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendCurrentMessage();
              }
            }}
            aria-label={t("Message input")}
          />
          <button
            type="submit"
            className="wa-send-btn"
            disabled={!canSend || sending || !draft.trim()}
            aria-label={t("Send message")}
          >
            {sending ? (
              <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            ) : (
              <i className="fas fa-paper-plane" aria-hidden="true" />
            )}
          </button>
        </form>
      </section>
    </div>
  );
}
