import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  clearSessionSetup,
  getSessionState,
  healthcheck,
  proxyMeta,
  saveSessionSetup,
  tgBootstrap,
  tgCheckPassword,
  tgListDialogs,
  tgListMessages,
  tgRequestCode,
  tgSendMessage,
  tgSignInCode,
  type ProxyMeta,
  type SessionState,
  type TgAuthState,
  type TgDialog,
  type TgMessage,
} from "./api";
import SetupGate, { type SetupFormState } from "./SetupGate";

type ChatKind = "private" | "group" | "channel" | "bot";
type RightPanelMode = "profile" | "system";
type ChatTab = "all" | "unread" | "private" | "groups" | "channels" | "bots";

type Chat = TgDialog;
type Message = TgMessage;

const tabs: Array<{ id: ChatTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "private", label: "Direct" },
  { id: "groups", label: "Groups" },
  { id: "channels", label: "Channels" },
  { id: "bots", label: "Bots" },
];

const emptySetupForm: SetupFormState = {
  apiId: "",
  apiHash: "",
  phoneNumber: "",
  socks5Host: "",
  socks5Port: "1080",
  socks5Username: "",
  socks5Password: "",
};

function chatPassesTab(chat: Chat, tab: ChatTab): boolean {
  if (tab === "all") {
    return true;
  }

  if (tab === "unread") {
    return chat.unread > 0;
  }

  if (tab === "private") {
    return chat.kind === "private";
  }

  if (tab === "groups") {
    return chat.kind === "group";
  }

  if (tab === "channels") {
    return chat.kind === "channel";
  }

  return chat.kind === "bot";
}

function initials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function avatarColor(seed: string): string {
  const palette = [
    "var(--avatar-a)",
    "var(--avatar-b)",
    "var(--avatar-c)",
    "var(--avatar-d)",
    "var(--avatar-e)",
    "var(--avatar-f)",
  ];

  const index =
    seed
      .split("")
      .map((char) => char.charCodeAt(0))
      .reduce((acc, code) => acc + code, 0) % palette.length;

  return palette[index];
}

function toPretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function setupFormFromState(state: SessionState | null): SetupFormState {
  if (!state || !state.setupCompleted) {
    return { ...emptySetupForm };
  }

  return {
    apiId: String(state.apiId ?? ""),
    apiHash: "",
    phoneNumber: state.phoneNumber ?? "",
    socks5Host: state.socks5Host ?? "",
    socks5Port: String(state.socks5Port ?? 1080),
    socks5Username: state.socks5Username ?? "",
    socks5Password: "",
  };
}

function loginTitle(state: TgAuthState | null): string {
  switch (state?.loginState) {
    case "awaitingCode":
      return "Введите код подтверждения";
    case "awaitingPassword":
      return "Введите пароль 2FA";
    case "authorized":
      return "Авторизация завершена";
    default:
      return "Вход в Telegram";
  }
}

function chatKindLabel(kind?: ChatKind): string {
  if (!kind) {
    return "-";
  }

  if (kind === "private") {
    return "private";
  }

  if (kind === "group") {
    return "group";
  }

  if (kind === "channel") {
    return "channel";
  }

  return "bot";
}

export default function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});

  const [activeChatId, setActiveChatId] = useState("");
  const [activeTab, setActiveTab] = useState<ChatTab>("all");
  const [search, setSearch] = useState("");
  const [compose, setCompose] = useState("");
  const [sending, setSending] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");

  const [panelMode, setPanelMode] = useState<RightPanelMode>("profile");
  const [meta, setMeta] = useState<ProxyMeta | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [consoleResponse, setConsoleResponse] = useState("{}");
  const [consoleError, setConsoleError] = useState("");

  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [setupForm, setSetupForm] = useState<SetupFormState>(emptySetupForm);
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupError, setSetupError] = useState("");

  const [authState, setAuthState] = useState<TgAuthState | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");

  const setupCompleted = Boolean(sessionState?.setupCompleted);
  const authorized = Boolean(authState?.authorized);

  const visibleChats = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return chats.filter((chat) => {
      if (!chatPassesTab(chat, activeTab)) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return (
        chat.title.toLowerCase().includes(needle) ||
        chat.lastPreview.toLowerCase().includes(needle) ||
        chat.subtitle.toLowerCase().includes(needle)
      );
    });
  }, [activeTab, chats, search]);

  const activeChat =
    chats.find((chat) => chat.id === activeChatId) ?? visibleChats[0] ?? null;

  const activeMessages = activeChat ? messagesByChat[activeChat.id] ?? [] : [];

  useEffect(() => {
    void bootstrapSessionState();
  }, []);

  useEffect(() => {
    if (setupCompleted) {
      void bootstrapTelegram();
    }
  }, [setupCompleted]);

  useEffect(() => {
    if (!activeChat && visibleChats[0]) {
      setActiveChatId(visibleChats[0].id);
    }
  }, [activeChat, visibleChats]);

  useEffect(() => {
    if (!authorized || !activeChatId) {
      return;
    }

    if (messagesByChat[activeChatId]) {
      return;
    }

    void loadMessages(activeChatId);
  }, [activeChatId, authorized, messagesByChat]);

  async function bootstrapSessionState() {
    setSetupLoading(true);
    setSetupError("");

    try {
      const state = await getSessionState();
      setSessionState(state);
      setSetupForm(setupFormFromState(state));
      setPhoneInput(state.phoneNumber ?? "");
    } catch (error) {
      setSessionState(null);
      setSetupForm({ ...emptySetupForm });
      setSetupError(String(error));
    } finally {
      setSetupLoading(false);
    }
  }

  async function bootstrapTelegram() {
    setAuthLoading(true);
    setAuthError("");

    try {
      const status = await tgBootstrap();
      setAuthState(status);
      if (status.phoneNumber) {
        setPhoneInput(status.phoneNumber);
      }

      if (status.authorized) {
        await refreshDialogs();
      }
    } catch (error) {
      setAuthError(String(error));
    } finally {
      setAuthLoading(false);
    }
  }

  function updateSetupField(field: keyof SetupFormState, value: string) {
    setSetupForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  async function submitSetup(event: FormEvent) {
    event.preventDefault();

    const apiId = Number.parseInt(setupForm.apiId.trim(), 10);
    const socks5Port = Number.parseInt(setupForm.socks5Port.trim(), 10);

    if (Number.isNaN(apiId) || apiId <= 0) {
      setSetupError("API ID должен быть положительным числом");
      return;
    }

    if (setupForm.apiHash.trim().length < 8) {
      setSetupError("API Hash выглядит слишком коротким");
      return;
    }

    if (!setupForm.socks5Host.trim()) {
      setSetupError("SOCKS5 Host обязателен");
      return;
    }

    if (Number.isNaN(socks5Port) || socks5Port <= 0 || socks5Port > 65535) {
      setSetupError("SOCKS5 Port должен быть в диапазоне 1-65535");
      return;
    }

    setSetupSaving(true);
    setSetupError("");

    try {
      const next = await saveSessionSetup({
        apiId,
        apiHash: setupForm.apiHash.trim(),
        phoneNumber: setupForm.phoneNumber.trim() || undefined,
        socks5Host: setupForm.socks5Host.trim(),
        socks5Port,
        socks5Username: setupForm.socks5Username.trim() || undefined,
        socks5Password: setupForm.socks5Password.trim() || undefined,
      });

      setSessionState(next);
      setSetupForm(setupFormFromState(next));
      setPhoneInput(next.phoneNumber ?? setupForm.phoneNumber.trim());
      setConsoleError("");
    } catch (error) {
      setSetupError(String(error));
    } finally {
      setSetupSaving(false);
    }
  }

  async function resetSavedSetup() {
    if (!confirm("Удалить сохраненные API/Proxy данные и сессию?")) {
      return;
    }

    try {
      await clearSessionSetup();
      setSessionState(null);
      setAuthState(null);
      setSetupForm({ ...emptySetupForm });
      setPhoneInput("");
      setCodeInput("");
      setPasswordInput("");
      setChats([]);
      setMessagesByChat({});
      setActiveChatId("");
      setSetupError("");
      setAuthError("");
      setConsoleError("");
      setPanelMode("system");
    } catch (error) {
      setConsoleError(String(error));
    }
  }

  async function refreshSystem() {
    try {
      const [nextMeta, nextHealth, nextSession, nextAuth] = await Promise.all([
        proxyMeta(),
        healthcheck(),
        getSessionState(),
        tgBootstrap(),
      ]);

      setMeta(nextMeta);
      setHealth(nextHealth);
      setSessionState(nextSession);
      setAuthState(nextAuth);
      setConsoleResponse(toPretty(nextHealth));
      setConsoleError("");
    } catch (error) {
      setConsoleError(String(error));
    }
  }

  async function refreshDialogs() {
    try {
      const dialogs = await tgListDialogs(120);
      setChats(dialogs);
      setConsoleResponse(toPretty(dialogs.slice(0, 5)));
      setConsoleError("");

      if (dialogs.length > 0) {
        const currentExists = dialogs.some((dialog) => dialog.id === activeChatId);
        const nextChatId = currentExists ? activeChatId : dialogs[0].id;
        setActiveChatId(nextChatId);

        await loadMessages(nextChatId);
      } else {
        setActiveChatId("");
      }
    } catch (error) {
      setConsoleError(String(error));
    }
  }

  async function loadMessages(chatId: string) {
    try {
      const messages = await tgListMessages(chatId, 100);
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: messages,
      }));
    } catch (error) {
      setConsoleError(String(error));
    }
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();

    const loginState = authState?.loginState ?? "needPhone";

    setAuthSubmitting(true);
    setAuthError("");

    try {
      if (loginState === "needPhone") {
        if (!phoneInput.trim()) {
          setAuthError("Введите номер телефона в международном формате");
          return;
        }
        const next = await tgRequestCode(phoneInput.trim());
        setAuthState(next);
        setCodeInput("");
        setPasswordInput("");
        setPhoneInput(next.phoneNumber ?? phoneInput.trim());
        return;
      }

      if (loginState === "awaitingCode") {
        if (!codeInput.trim()) {
          setAuthError("Введите код подтверждения из Telegram");
          return;
        }

        const next = await tgSignInCode(codeInput.trim());
        setAuthState(next);

        if (next.authorized) {
          await refreshDialogs();
        }

        return;
      }

      if (!passwordInput) {
        setAuthError("Введите пароль 2FA");
        return;
      }

      const next = await tgCheckPassword(passwordInput);
      setAuthState(next);
      setPasswordInput("");

      if (next.authorized) {
        await refreshDialogs();
      }
    } catch (error) {
      setAuthError(String(error));
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function resendCode() {
    if (!phoneInput.trim()) {
      setAuthError("Сначала укажите номер телефона");
      return;
    }

    setAuthSubmitting(true);
    setAuthError("");

    try {
      const next = await tgRequestCode(phoneInput.trim());
      setAuthState(next);
      setCodeInput("");
      setPasswordInput("");
    } catch (error) {
      setAuthError(String(error));
    } finally {
      setAuthSubmitting(false);
    }
  }

  function markChatAsActive(chat: Chat) {
    setActiveChatId(chat.id);
    setMobileView("chat");
    void loadMessages(chat.id);
  }

  async function sendFromComposer(event: FormEvent) {
    event.preventDefault();

    if (!activeChat) {
      return;
    }

    const text = compose.trim();
    if (!text || sending) {
      return;
    }

    const optimisticId = `local-${Date.now()}`;

    const optimisticMessage: Message = {
      id: optimisticId,
      chatId: activeChat.id,
      from: "me",
      text,
      at: "now",
      status: "sending",
    };

    setCompose("");
    setSending(true);
    setConsoleError("");

    setMessagesByChat((prev) => ({
      ...prev,
      [activeChat.id]: [...(prev[activeChat.id] ?? []), optimisticMessage],
    }));

    setChats((prev) => {
      const updated = prev.map((chat) =>
        chat.id === activeChat.id
          ? {
              ...chat,
              lastPreview: text,
              lastSeen: "now",
              unread: 0,
            }
          : chat,
      );

      const currentIndex = updated.findIndex((chat) => chat.id === activeChat.id);
      if (currentIndex > 0) {
        const [current] = updated.splice(currentIndex, 1);
        updated.unshift(current);
      }

      return updated;
    });

    try {
      const sent = await tgSendMessage(activeChat.id, text);

      setMessagesByChat((prev) => ({
        ...prev,
        [activeChat.id]: (prev[activeChat.id] ?? []).map((message) =>
          message.id === optimisticId ? { ...sent, status: "sent" } : message,
        ),
      }));

      setConsoleResponse(toPretty(sent));
    } catch (error) {
      setMessagesByChat((prev) => ({
        ...prev,
        [activeChat.id]: (prev[activeChat.id] ?? []).map((message) =>
          message.id === optimisticId ? { ...message, status: "failed" } : message,
        ),
      }));
      setConsoleError(String(error));
    } finally {
      setSending(false);
    }
  }

  if (!setupCompleted) {
    return (
      <SetupGate
        loading={setupLoading}
        saving={setupSaving}
        error={setupError}
        form={setupForm}
        onChange={updateSetupField}
        onSubmit={submitSetup}
      />
    );
  }

  if (!authorized) {
    const loginState = authState?.loginState ?? "needPhone";
    const loading = authLoading || authSubmitting;

    return (
      <main className="setup-window">
        <section className="setup-card">
          <header className="setup-header">
            <span className="setup-badge">Telegram Login</span>
            <h1>{loginTitle(authState)}</h1>
            <p>
              Данные API и SOCKS5 уже сохранены. Ниже нужно пройти вход в Telegram один раз,
              после чего сессия будет восстанавливаться автоматически.
            </p>
          </header>

          <section className="setup-tutorial">
            <h2>Что делать</h2>
            <ol>
              <li>Введите номер телефона в международном формате (например, +79990001122).</li>
              <li>Нажмите кнопку отправки кода и введите код из Telegram/SMS.</li>
              <li>Если включен 2FA, введите пароль от аккаунта.</li>
            </ol>
          </section>

          <form className="setup-form" onSubmit={submitAuth}>
            <label>
              Phone number
              <input
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
                placeholder="+79990001122"
                autoComplete="off"
                disabled={loginState !== "needPhone"}
              />
            </label>

            {loginState === "awaitingCode" ? (
              <label>
                Login code
                <input
                  value={codeInput}
                  onChange={(event) => setCodeInput(event.target.value)}
                  placeholder="12345"
                  autoComplete="off"
                />
              </label>
            ) : null}

            {loginState === "awaitingPassword" ? (
              <label>
                2FA password
                <input
                  value={passwordInput}
                  onChange={(event) => setPasswordInput(event.target.value)}
                  placeholder="Your Telegram password"
                  type="password"
                  autoComplete="off"
                />
              </label>
            ) : null}

            {authState?.error ? <p className="setup-error">{authState.error}</p> : null}
            {authError ? <p className="setup-error">{authError}</p> : null}

            <button type="submit" disabled={loading}>
              {loginState === "needPhone"
                ? loading
                  ? "Отправляем код..."
                  : "Отправить код"
                : loginState === "awaitingCode"
                  ? loading
                    ? "Проверяем код..."
                    : "Войти"
                  : loading
                    ? "Проверяем пароль..."
                    : "Подтвердить 2FA"}
            </button>

            {loginState !== "needPhone" ? (
              <button type="button" onClick={resendCode} disabled={loading}>
                Отправить код заново
              </button>
            ) : null}

            <button type="button" className="danger-btn" onClick={resetSavedSetup}>
              Сбросить setup
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className={`tg-shell ${mobileView === "chat" ? "chat-open" : "list-open"}`}>
      <aside className="chat-sidebar card">
        <header className="sidebar-header">
          <div className="user-chip">
            <span className="avatar me">PT</span>
            <div>
              <strong>{authState?.meDisplayName ?? "ProxyTG"}</strong>
              <small>{authState?.mePhone ?? "Secure Telegram Wrapper"}</small>
            </div>
          </div>
          <button
            className="icon-btn"
            type="button"
            onClick={() => setPanelMode("system")}
            title="System"
          >
            Sys
          </button>
        </header>

        <div className="search-wrap">
          <input
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search dialogs"
          />
        </div>

        <div className="tab-strip" role="tablist" aria-label="chat filters">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === activeTab ? "tab active" : "tab"}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <ul className="chat-list">
          {visibleChats.map((chat, index) => (
            <li key={chat.id} style={{ animationDelay: `${index * 26}ms` }}>
              <button
                type="button"
                className={chat.id === activeChat?.id ? "chat-item active" : "chat-item"}
                onClick={() => markChatAsActive(chat)}
              >
                <span
                  className="avatar"
                  style={{ background: avatarColor(chat.title) }}
                  aria-hidden
                >
                  {initials(chat.title)}
                </span>

                <span className="chat-main">
                  <span className="chat-line title-line">
                    <strong>{chat.title}</strong>
                    {chat.verified ? <span className="verified">ver</span> : null}
                    {chat.muted ? <span className="muted">mute</span> : null}
                  </span>
                  <span className="chat-line subtitle-line">
                    <small>{chat.lastPreview || chat.subtitle}</small>
                    <time>{chat.lastSeen}</time>
                  </span>
                </span>

                <span className="chat-meta">
                  {chat.unread > 0 ? <span className="badge">{chat.unread}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="chat-pane card">
        {activeChat ? (
          <>
            <header className="chat-header">
              <div className="chat-title-wrap">
                <button
                  type="button"
                  className="icon-btn mobile-only"
                  onClick={() => setMobileView("list")}
                >
                  Back
                </button>
                <span
                  className="avatar"
                  style={{ background: avatarColor(activeChat.title) }}
                  aria-hidden
                >
                  {initials(activeChat.title)}
                </span>
                <div>
                  <strong>{activeChat.title}</strong>
                  <small>
                    {activeChat.online ? "online" : activeChat.subtitle}
                    {activeChat.pinned ? " • pinned" : ""}
                  </small>
                </div>
              </div>

              <div className="chat-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setPanelMode("profile")}
                >
                  Info
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void loadMessages(activeChat.id)}
                >
                  Refresh
                </button>
              </div>
            </header>

            <div className="message-stream">
              {activeMessages.map((message) => (
                <article
                  key={message.id}
                  className={message.from === "me" ? "bubble mine" : "bubble peer"}
                >
                  <p>{message.text}</p>
                  <footer>
                    <time>{message.at}</time>
                    {message.from === "me" && message.status ? (
                      <small className={`state ${message.status}`}>{message.status}</small>
                    ) : null}
                  </footer>
                </article>
              ))}
            </div>

            <form className="composer" onSubmit={sendFromComposer}>
              <input
                value={compose}
                onChange={(event) => setCompose(event.target.value)}
                placeholder="Write a message"
              />
              <button type="submit" disabled={sending || !compose.trim()}>
                {sending ? "Sending" : "Send"}
              </button>
            </form>
          </>
        ) : (
          <div className="empty">No chat selected</div>
        )}
      </section>

      <aside className="details-pane card">
        <div className="details-tabs">
          <button
            type="button"
            className={panelMode === "profile" ? "tab active" : "tab"}
            onClick={() => setPanelMode("profile")}
          >
            Profile
          </button>
          <button
            type="button"
            className={panelMode === "system" ? "tab active" : "tab"}
            onClick={() => setPanelMode("system")}
          >
            System
          </button>
        </div>

        {panelMode === "profile" ? (
          <section className="panel-section">
            <h2>{activeChat?.title ?? "Dialog"}</h2>
            <p>{activeChat?.subtitle ?? "No details"}</p>

            <dl className="stats-grid">
              <div>
                <dt>Type</dt>
                <dd>{chatKindLabel(activeChat?.kind)}</dd>
              </div>
              <div>
                <dt>Unread</dt>
                <dd>{activeChat?.unread ?? 0}</dd>
              </div>
              <div>
                <dt>Pinned</dt>
                <dd>{activeChat?.pinned ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt>Muted</dt>
                <dd>{activeChat?.muted ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt>Telegram ID</dt>
                <dd>{activeChat?.telegramChatId ?? "-"}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        {panelMode === "system" ? (
          <section className="panel-section">
            <h2>Session + Proxy</h2>
            <button type="button" onClick={refreshSystem}>
              Refresh
            </button>

            <button type="button" onClick={refreshDialogs}>
              Refresh dialogs
            </button>

            <h3>Auth</h3>
            <pre>{authState ? toPretty(authState) : "not loaded"}</pre>

            <h3>Saved Setup</h3>
            <pre>{sessionState ? toPretty(sessionState) : "not loaded"}</pre>

            <button type="button" className="danger-btn" onClick={resetSavedSetup}>
              Reset saved setup
            </button>

            <h3>Meta</h3>
            <pre>{meta ? toPretty(meta) : "not loaded"}</pre>

            <h3>Health</h3>
            <pre>{health ? toPretty(health) : "not loaded"}</pre>

            <h3>Last response</h3>
            <pre>{consoleResponse}</pre>
          </section>
        ) : null}

        {consoleError ? <p className="error-line">{consoleError}</p> : null}
      </aside>
    </main>
  );
}
