import { convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ClipboardEvent as ReactClipboardEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  clearSessionSetup,
  tgForwardMessage,
  getSessionState,
  healthcheck,
  proxyMeta,
  saveSessionSetup,
  tgAddStickerSet,
  tgBootstrap,
  tgCheckPassword,
  tgListDialogs,
  tgListMessages,
  tgListStickerLibrary,
  tgMarkChatRead,
  tgMarkStoriesRead,
  tgListStories,
  tgGetPeerStories,
  tgRequestCode,
  tgSendPhoto,
  tgSendMessage,
  tgSendStickerByRef,
  tgSignInCode,
  type ProxyMeta,
  type SessionState,
  type TgAuthState,
  type TgDialog,
  type TgMediaAttachment,
  type TgMessage,
  type TgStickerItem,
  type TgStickerLibrary,
  type TgStoryItem,
  type TgStoryPeer,
} from "./api";
import SetupGate, { type SetupFormState } from "./SetupGate";

type ChatKind = "private" | "group" | "channel" | "bot";
type ChatTab = "all" | "unread" | "private" | "groups" | "channels" | "bots";
type ThemeMode = "light" | "dark";
type IconName =
  | "menu"
  | "private"
  | "chats"
  | "groups"
  | "channels"
  | "bots"
  | "settings"
  | "search"
  | "refresh"
  | "back"
  | "panelLeft"
  | "panelRight"
  | "sun"
  | "moon"
  | "more"
  | "smile"
  | "record"
  | "send"
  | "profile"
  | "wallet"
  | "newGroup"
  | "newChannel"
  | "contacts"
  | "calls"
  | "saved"
  | "close"
  | "mute"
  | "message"
  | "call"
  | "forward";

type Chat = TgDialog;
type Message = TgMessage;
type StoryPeer = TgStoryPeer;
type StoryItem = TgStoryItem;
type StickerItem = TgStickerItem;
type StickerLibrary = TgStickerLibrary;
type ComposerImageDraft = {
  base64Data: string;
  mimeType: string;
  fileName: string;
  previewUrl: string;
  sizeBytes: number;
};
type ForwardDraft = {
  sourceChatId: string;
  message: Message;
};
type TgLiveEvent = {
  kind: string;
  chatId?: string;
};

const DIALOG_PAGE_SIZE = 60;
const MESSAGE_PAGE_SIZE = 40;
const STORY_LIMIT = 24;
const STICKER_SET_LIMIT = 120;
const STICKERS_PER_SET = 120;

const emptySetupForm: SetupFormState = {
  apiId: "",
  apiHash: "",
  phoneNumber: "",
  socks5Host: "",
  socks5Port: "1080",
  socks5Username: "",
  socks5Password: "",
};

function Icon({
  name,
  className,
  size = 18,
}: {
  name: IconName;
  className?: string;
  size?: number;
}) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const dots = (points: Array<[number, number]>) => (
    <>
      {points.map(([cx, cy], idx) => (
        <circle key={`${cx}-${cy}-${idx}`} cx={cx} cy={cy} r={1.4} fill="currentColor" />
      ))}
    </>
  );

  let paths: JSX.Element;

  switch (name) {
    case "menu":
      paths = (
        <>
          <line x1="4" y1="6" x2="20" y2="6" {...stroke} />
          <line x1="4" y1="12" x2="20" y2="12" {...stroke} />
          <line x1="4" y1="18" x2="20" y2="18" {...stroke} />
        </>
      );
      break;
    case "private":
      paths = (
        <>
          <path d="M4 6.5h16v9a3 3 0 0 1-3 3H9l-4 3v-3H7a3 3 0 0 1-3-3z" {...stroke} />
          <circle cx="10" cy="11" r="1" fill="currentColor" />
          <circle cx="14" cy="11" r="1" fill="currentColor" />
        </>
      );
      break;
    case "chats":
      paths = (
        <>
          <path d="M4 6h11a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H9l-4 3v-3H7a3 3 0 0 1-3-3z" {...stroke} />
          <path d="M14.5 7.5H20a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1.5" {...stroke} />
        </>
      );
      break;
    case "groups":
      paths = (
        <>
          <circle cx="9" cy="9" r="3" {...stroke} />
          <circle cx="16.5" cy="10" r="2.5" {...stroke} />
          <path d="M4.5 18a4.5 4.5 0 0 1 9 0" {...stroke} />
          <path d="M13.5 18a3.5 3.5 0 0 1 7 0" {...stroke} />
        </>
      );
      break;
    case "channels":
      paths = (
        <>
          <path d="M4 14V10l12-4v12z" {...stroke} />
          <path d="M16 10a6 6 0 0 1 0 4" {...stroke} />
          <path d="M18.5 8.5a8.5 8.5 0 0 1 0 7" {...stroke} />
        </>
      );
      break;
    case "bots":
      paths = (
        <>
          <rect x="6" y="7" width="12" height="11" rx="3" {...stroke} />
          <line x1="12" y1="4" x2="12" y2="7" {...stroke} />
          <circle cx="10" cy="12" r="1" fill="currentColor" />
          <circle cx="14" cy="12" r="1" fill="currentColor" />
          <line x1="10" y1="16" x2="14" y2="16" {...stroke} />
        </>
      );
      break;
    case "settings":
      paths = (
        <>
          <circle cx="12" cy="12" r="3" {...stroke} />
          <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.8 5.8l1.8 1.8M16.4 16.4l1.8 1.8M18.2 5.8l-1.8 1.8M7.6 16.4l-1.8 1.8" {...stroke} />
        </>
      );
      break;
    case "search":
      paths = (
        <>
          <circle cx="11" cy="11" r="6" {...stroke} />
          <line x1="16" y1="16" x2="20.5" y2="20.5" {...stroke} />
        </>
      );
      break;
    case "refresh":
      paths = (
        <>
          <path d="M20 7v4h-4" {...stroke} />
          <path d="M4 17v-4h4" {...stroke} />
          <path d="M18 11a6 6 0 0 0-10-4" {...stroke} />
          <path d="M6 13a6 6 0 0 0 10 4" {...stroke} />
        </>
      );
      break;
    case "back":
      paths = <path d="M15 6l-6 6 6 6" {...stroke} />;
      break;
    case "panelLeft":
      paths = (
        <>
          <line x1="18" y1="4" x2="18" y2="20" {...stroke} />
          <path d="M14 7l-5 5 5 5" {...stroke} />
        </>
      );
      break;
    case "panelRight":
      paths = (
        <>
          <line x1="6" y1="4" x2="6" y2="20" {...stroke} />
          <path d="M10 7l5 5-5 5" {...stroke} />
        </>
      );
      break;
    case "sun":
      paths = (
        <>
          <circle cx="12" cy="12" r="4" {...stroke} />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" {...stroke} />
        </>
      );
      break;
    case "moon":
      paths = <path d="M14.7 3.5a8.6 8.6 0 1 0 5.8 14.8A8.9 8.9 0 0 1 14.7 3.5z" {...stroke} />;
      break;
    case "more":
      paths = dots([
        [12, 6.5],
        [12, 12],
        [12, 17.5],
      ]);
      break;
    case "smile":
      paths = (
        <>
          <circle cx="12" cy="12" r="8" {...stroke} />
          <circle cx="9" cy="10" r="1" fill="currentColor" />
          <circle cx="15" cy="10" r="1" fill="currentColor" />
          <path d="M8.5 14.5c1 1.5 2.2 2 3.5 2 1.3 0 2.5-.5 3.5-2" {...stroke} />
        </>
      );
      break;
    case "record":
      paths = (
        <>
          <circle cx="12" cy="12" r="7" {...stroke} />
          <circle cx="12" cy="12" r="3.2" fill="currentColor" />
        </>
      );
      break;
    case "send":
      paths = <path d="M3.5 11.5l17-7-5.7 15-3.8-5.4-7.5-2.6z" {...stroke} />;
      break;
    case "profile":
      paths = (
        <>
          <circle cx="12" cy="8.5" r="3.2" {...stroke} />
          <path d="M5.2 19.2a6.8 6.8 0 0 1 13.6 0" {...stroke} />
        </>
      );
      break;
    case "wallet":
      paths = (
        <>
          <rect x="4" y="7" width="16" height="11" rx="2" {...stroke} />
          <path d="M4 10h16" {...stroke} />
          <circle cx="16.3" cy="14" r="1" fill="currentColor" />
        </>
      );
      break;
    case "newGroup":
      paths = (
        <>
          <circle cx="9" cy="10" r="2.5" {...stroke} />
          <circle cx="15.5" cy="10.8" r="2" {...stroke} />
          <path d="M4.8 18a4.2 4.2 0 0 1 8.4 0" {...stroke} />
          <path d="M17.5 4.8v4M15.5 6.8h4" {...stroke} />
        </>
      );
      break;
    case "newChannel":
      paths = (
        <>
          <path d="M4 14V10l10-3.5v11z" {...stroke} />
          <path d="M14 10a5 5 0 0 1 0 4" {...stroke} />
          <path d="M18 5v4M16 7h4" {...stroke} />
        </>
      );
      break;
    case "contacts":
      paths = (
        <>
          <circle cx="10" cy="9" r="3" {...stroke} />
          <path d="M4.5 19a5.5 5.5 0 0 1 11 0" {...stroke} />
          <path d="M18 7v4M16 9h4" {...stroke} />
        </>
      );
      break;
    case "calls":
    case "call":
      paths = <path d="M7.5 4.5c2 3.9 6.1 8 10 10l2.2-2.3a1.7 1.7 0 0 1 1.7-.4l1.6.5a1.6 1.6 0 0 1 1 1.6v3.7a1.8 1.8 0 0 1-1.9 1.8C10.8 20.8 3.2 13.2 2.6 3.9A1.8 1.8 0 0 1 4.4 2h3.7a1.6 1.6 0 0 1 1.6 1l.5 1.6a1.7 1.7 0 0 1-.4 1.7z" {...stroke} />;
      break;
    case "saved":
      paths = <path d="M7 4h10a2 2 0 0 1 2 2v14l-7-4-7 4V6a2 2 0 0 1 2-2z" {...stroke} />;
      break;
    case "close":
      paths = (
        <>
          <line x1="6" y1="6" x2="18" y2="18" {...stroke} />
          <line x1="18" y1="6" x2="6" y2="18" {...stroke} />
        </>
      );
      break;
    case "mute":
      paths = (
        <>
          <path d="M5 10h3l4-4v12l-4-4H5z" {...stroke} />
          <line x1="16" y1="9" x2="21" y2="15" {...stroke} />
          <line x1="21" y1="9" x2="16" y2="15" {...stroke} />
        </>
      );
      break;
    case "message":
      paths = <path d="M4 6h16v9a3 3 0 0 1-3 3H9l-4 3v-3H7a3 3 0 0 1-3-3z" {...stroke} />;
      break;
    case "forward":
      paths = (
        <>
          <path d="M13 5l7 7-7 7" {...stroke} />
          <path d="M4 12h16" {...stroke} />
        </>
      );
      break;
    default:
      paths = <circle cx="12" cy="12" r="2.8" fill="currentColor" />;
  }

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      {paths}
    </svg>
  );
}

function fromStorageBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    if (value === null) {
      return fallback;
    }
    return value === "1";
  } catch {
    return fallback;
  }
}

function fromStorageTheme(): ThemeMode {
  try {
    const value = localStorage.getItem("proxytg-theme");
    if (value === "dark") {
      return "dark";
    }
    return "dark";
  } catch {
    return "dark";
  }
}

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

function mediaKindLabel(kind: TgMediaAttachment["kind"]): string {
  switch (kind) {
    case "voice":
      return "ГС";
    case "photo":
      return "Фото";
    case "video":
      return "Видео";
    case "gif":
      return "GIF";
    case "sticker":
      return "Стикер";
    case "audio":
      return "Аудио";
    default:
      return "Файл";
  }
}

function previewLabel(value: string): string {
  const raw = value.trim().toLowerCase();
  if (raw === "<voice message>") {
    return "ГС";
  }
  if (raw === "<photo>") {
    return "Фото";
  }
  if (raw === "<video>") {
    return "Видео";
  }
  if (raw === "<sticker>") {
    return "Стикер";
  }
  if (raw === "<gif>") {
    return "GIF";
  }
  if (raw === "<audio>") {
    return "Аудио";
  }
  if (raw === "<file>" || raw === "<media>") {
    return "Файл";
  }
  return value;
}

function messagePreviewValue(message: Message): string {
  const text = message.text.trim();
  if (text && !isSyntheticMediaText(text)) {
    return text;
  }

  if (!message.media) {
    return text || "Сообщение";
  }

  switch (message.media.kind) {
    case "voice":
      return "<voice message>";
    case "photo":
      return "<photo>";
    case "video":
      return "<video>";
    case "gif":
      return "<gif>";
    case "sticker":
      return "<sticker>";
    case "audio":
      return "<audio>";
    default:
      return "<file>";
  }
}

function sortStoryPeers(peers: StoryPeer[]): StoryPeer[] {
  return peers
    .map((peer, index) => ({ peer, index }))
    .sort((left, right) => {
      const unreadDelta =
        Number(right.peer.unreadCount > 0) - Number(left.peer.unreadCount > 0);
      if (unreadDelta !== 0) {
        return unreadDelta;
      }
      return left.index - right.index;
    })
    .map(({ peer }) => peer);
}

function truncateText(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) {
    return value;
  }
  return `${chars.slice(0, maxChars).join("")}…`;
}

function chatStatusLine(chat: Chat): string {
  if (chat.online) {
    return "online";
  }
  if (chat.subtitle.trim()) {
    return chat.subtitle;
  }
  if (chat.kind === "group") {
    return "group";
  }
  if (chat.kind === "channel") {
    return "channel";
  }
  if (chat.kind === "bot") {
    return "bot";
  }
  return "last seen recently";
}

function statusGlyph(status?: Message["status"]): string {
  if (status === "failed") {
    return "!";
  }
  if (status === "read") {
    return "✓✓";
  }
  if (status === "sent") {
    return "✓";
  }
  return "…";
}

function numericId(value?: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function effectiveMessageStatus(message: Message, chat?: Chat | null): Message["status"] {
  if (message.status === "failed" || message.status === "sending") {
    return message.status;
  }

  if (message.from !== "me") {
    return undefined;
  }

  const messageId = numericId(message.id);
  const readOutboxMaxId = numericId(chat?.readOutboxMaxId);
  if (messageId !== null && readOutboxMaxId !== null && messageId <= readOutboxMaxId) {
    return "read";
  }

  return "sent";
}

function usernameFromTitle(raw: string): string {
  const compact = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_а-яА-Я]/g, "");
  if (!compact) {
    return "@proxytg";
  }
  return `@${truncateText(compact, 18)}`;
}

function isSyntheticMediaText(value: string): boolean {
  const text = value.trim();
  return text.startsWith("<") && text.endsWith(">");
}

function formatDuration(seconds?: number): string | null {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) {
    return null;
  }

  const total = Math.round(seconds);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatBytes(bytes?: number): string | null {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    return null;
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function extensionFromMime(mimeType?: string): string {
  if (!mimeType) {
    return "png";
  }
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpg";
  }
  if (mimeType.includes("webp")) {
    return "webp";
  }
  if (mimeType.includes("gif")) {
    return "gif";
  }
  if (mimeType.includes("bmp")) {
    return "bmp";
  }
  return "png";
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать файл из буфера"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });

  const markerIndex = dataUrl.indexOf(",");
  if (markerIndex < 0) {
    throw new Error("Не удалось подготовить изображение к отправке");
  }

  return dataUrl.slice(markerIndex + 1);
}

async function clipboardFileToDraft(file: File): Promise<ComposerImageDraft> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Сейчас из буфера можно вставлять только изображения");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Изображение из буфера слишком большое");
  }

  const base64Data = await fileToBase64(file);
  const ext = extensionFromMime(file.type);
  const baseName = file.name.trim() || `clipboard-image-${Date.now()}.${ext}`;

  return {
    base64Data,
    mimeType: file.type || "image/png",
    fileName: baseName,
    previewUrl: URL.createObjectURL(file),
    sizeBytes: file.size,
  };
}

function mediaMetaText(media: TgMediaAttachment): string | null {
  const parts: string[] = [];
  const duration = formatDuration(media.durationSec);
  const size = formatBytes(media.sizeBytes);
  if (duration) {
    parts.push(duration);
  }
  if (size) {
    parts.push(size);
  }
  if (media.width && media.height) {
    parts.push(`${media.width}x${media.height}`);
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" • ");
}

function toAssetUrl(path?: string): string | undefined {
  if (!path) {
    return undefined;
  }

  if (
    path.startsWith("blob:") ||
    path.startsWith("data:") ||
    path.startsWith("http://") ||
    path.startsWith("https://")
  ) {
    return path;
  }

  try {
    return convertFileSrc(path);
  } catch {
    return undefined;
  }
}

function isVideoStickerMedia(mimeType?: string, fileName?: string): boolean {
  const lowerName = fileName?.toLowerCase();
  return Boolean(mimeType?.includes("webm") || lowerName?.endsWith(".webm"));
}

function isLottieStickerMedia(mimeType?: string, fileName?: string): boolean {
  const lowerName = fileName?.toLowerCase();
  return Boolean(
    mimeType?.includes("application/x-tgsticker") ||
      mimeType?.includes("application/gzip") ||
      lowerName?.endsWith(".tgs"),
  );
}

function normalizeStickerSetInput(raw: string): string {
  const value = raw.trim();
  if (!value) {
    return "";
  }

  const linkMatch = value.match(/(?:addstickers\/|addemoji\/)([A-Za-z0-9_]+)/i);
  if (linkMatch?.[1]) {
    return linkMatch[1];
  }

  return value
    .replace(/^@/, "")
    .replace(/^https?:\/\/t\.me\//i, "")
    .split(/[/?#]/)[0]
    .trim();
}

function renderStickerThumb(sticker: StickerItem) {
  const src = toAssetUrl(sticker.path);
  if (!src || isLottieStickerMedia(sticker.mimeType, sticker.fileName)) {
    return <span className="sticker-fallback">{sticker.emoji ?? "ST"}</span>;
  }

  if (isVideoStickerMedia(sticker.mimeType, sticker.fileName)) {
    return (
      <video
        className="sticker-thumb-video"
        src={src}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
      />
    );
  }

  return <img src={src} alt={sticker.emoji ?? "sticker"} loading="lazy" />;
}

function storyAutoplayDurationMs(story?: StoryItem): number {
  if (!story) {
    return 5_000;
  }

  const media = story.media;
  if (!media?.path) {
    return 0;
  }

  if ((media.kind === "video" || media.kind === "gif") && media.durationSec) {
    return Math.max(3_000, Math.min(15_000, Math.round(media.durationSec * 1_000)));
  }

  return 5_000;
}

function renderStoryViewerMedia(story?: StoryItem) {
  if (!story?.media) {
    return <div className="story-viewer-empty">У этой истории нет медиа.</div>;
  }

  const media = story.media;
  const src = toAssetUrl(media.path);
  if (!src) {
    return <div className="story-viewer-empty">Подгружаю медиа истории...</div>;
  }

  if (media.kind === "photo") {
    return <img className="story-viewer-image" src={src} alt="story" loading="eager" />;
  }

  if (media.kind === "video" || media.kind === "gif" || isVideoStickerMedia(media.mimeType, media.fileName)) {
    return (
      <video
        className="story-viewer-video"
        src={src}
        controls
        autoPlay
        playsInline
        preload="auto"
      />
    );
  }

  if (media.kind === "sticker" && !isLottieStickerMedia(media.mimeType, media.fileName)) {
    return <img className="story-viewer-sticker" src={src} alt="story sticker" loading="eager" />;
  }

  return (
    <div className="story-viewer-file">
      <a href={src} target="_blank" rel="noreferrer">
        Открыть файл истории
      </a>
    </div>
  );
}

function renderMedia(media?: TgMediaAttachment) {
  if (!media) {
    return null;
  }

  const src = toAssetUrl(media.path);
  if (!src) {
    return (
      <div className="media-wrap">
        <div className="media-pending">Медиа загружается...</div>
      </div>
    );
  }

  if (media.kind === "sticker") {
    return (
      <div className="media-wrap">
        {isLottieStickerMedia(media.mimeType, media.fileName) ? (
          <div className="media-pending">Animated sticker</div>
        ) : isVideoStickerMedia(media.mimeType, media.fileName) ? (
          <video
            className="media-sticker media-video-sticker"
            src={src}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
          />
        ) : (
          <img
            src={src}
            className="media-sticker"
            loading="lazy"
            alt={media.fileName ?? "sticker"}
          />
        )}
      </div>
    );
  }

  if (media.kind === "photo") {
    return (
      <div className="media-wrap">
        <img src={src} className="media-photo" loading="lazy" alt={media.fileName ?? "media"} />
      </div>
    );
  }

  if (media.kind === "gif") {
    const isImageGif = media.mimeType?.includes("gif") || media.fileName?.toLowerCase().endsWith(".gif");
    return (
      <div className="media-wrap">
        {isImageGif ? (
          <img src={src} className="media-photo" loading="lazy" alt={media.fileName ?? "gif"} />
        ) : (
          <video className="media-video" autoPlay loop muted playsInline controls preload="metadata" src={src} />
        )}
      </div>
    );
  }

  if (media.kind === "video") {
    return (
      <div className="media-wrap">
        <video className="media-video" controls playsInline preload="metadata" src={src} />
      </div>
    );
  }

  if (media.kind === "voice") {
    return (
      <div className="media-wrap">
        <div className="voice-card">
          <span className="voice-dot" aria-hidden />
          <audio className="media-audio" controls preload="metadata" src={src} />
        </div>
      </div>
    );
  }

  if (media.kind === "audio") {
    return (
      <div className="media-wrap">
        <audio className="media-audio" controls preload="metadata" src={src} />
      </div>
    );
  }

  return (
    <div className="media-wrap">
      <a className="file-chip" href={src} target="_blank" rel="noreferrer" download={media.fileName}>
        {media.fileName ?? "file"}
      </a>
    </div>
  );
}

export default function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [stories, setStories] = useState<StoryPeer[]>([]);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const chatsSnapshotRef = useRef<Record<string, { topMessageId: string; unread: number }>>({});
  const dialogsRefreshInFlightRef = useRef(false);
  const readMarkInFlightRef = useRef<Set<string>>(new Set());
  const storyReadInFlightRef = useRef<Set<string>>(new Set());
  const liveRefreshTimerRef = useRef<number | null>(null);
  const notifiedPermissionRef = useRef(false);
  const messageLoadInFlightRef = useRef<Set<string>>(new Set());
  const olderLoadInFlightRef = useRef<Set<string>>(new Set());
  const messageStreamRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const pendingPrependRestoreRef = useRef<{
    chatId: string;
    prevScrollTop: number;
    prevScrollHeight: number;
  } | null>(null);

  const [activeChatId, setActiveChatId] = useState("");
  const [activeTab, setActiveTab] = useState<ChatTab>("all");
  const [search, setSearch] = useState("");
  const [compose, setCompose] = useState("");
  const [composeImage, setComposeImage] = useState<ComposerImageDraft | null>(null);
  const [forwardDraft, setForwardDraft] = useState<ForwardDraft | null>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardingMessage, setForwardingMessage] = useState(false);
  const [sending, setSending] = useState(false);
  const [stickerSending, setStickerSending] = useState(false);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [stickerLibrary, setStickerLibrary] = useState<StickerLibrary | null>(null);
  const [stickerLibraryLoading, setStickerLibraryLoading] = useState(false);
  const [stickerLibraryReady, setStickerLibraryReady] = useState(false);
  const [activeStickerSection, setActiveStickerSection] = useState("recent");
  const [stickerPackInput, setStickerPackInput] = useState("");
  const [stickerPackAdding, setStickerPackAdding] = useState(false);
  const [storyViewerPeer, setStoryViewerPeer] = useState<StoryPeer | null>(null);
  const [storyViewerItems, setStoryViewerItems] = useState<StoryItem[]>([]);
  const [storyViewerIndex, setStoryViewerIndex] = useState(0);
  const [storyViewerLoading, setStoryViewerLoading] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [hasMoreByChat, setHasMoreByChat] = useState<Record<string, boolean>>({});
  const [loadingOlderByChat, setLoadingOlderByChat] = useState<Record<string, boolean>>({});
  const [documentVisible, setDocumentVisible] = useState<boolean>(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );

  const [theme, setTheme] = useState<ThemeMode>(() => fromStorageTheme());
  const [hideLeft, setHideLeft] = useState<boolean>(() =>
    fromStorageBoolean("proxytg-hide-left", false),
  );
  const [hideRight, setHideRight] = useState<boolean>(() =>
    fromStorageBoolean("proxytg-hide-right", true),
  );

  const [leftMenuOpen, setLeftMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selfProfileOpen, setSelfProfileOpen] = useState(false);
  const [peerProfileOpen, setPeerProfileOpen] = useState(false);
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
  const hasMoreActive = activeChat ? hasMoreByChat[activeChat.id] !== false : false;
  const loadingOlderActive = activeChat ? Boolean(loadingOlderByChat[activeChat.id]) : false;
  const storyPeers = useMemo(() => sortStoryPeers(stories).slice(0, STORY_LIMIT), [stories]);
  const stickerSections = useMemo(() => {
    const sections: Array<{ id: string; label: string; stickers: StickerItem[] }> = [];

    if (stickerLibrary?.recent.length) {
      sections.push({
        id: "recent",
        label: "Recent",
        stickers: stickerLibrary.recent,
      });
    }

    if (stickerLibrary?.favorite.length) {
      sections.push({
        id: "favorite",
        label: "Favorite",
        stickers: stickerLibrary.favorite,
      });
    }

    for (const pack of stickerLibrary?.packs ?? []) {
      sections.push({
        id: `pack:${pack.shortName}`,
        label: pack.title,
        stickers: pack.stickers,
      });
    }

    return sections;
  }, [stickerLibrary]);
  const currentStickerSection =
    stickerSections.find((section) => section.id === activeStickerSection) ?? stickerSections[0];
  const currentStickerItems = currentStickerSection?.stickers ?? [];
  const currentStoryItem = storyViewerItems[storyViewerIndex];
  const forwardTargetChats = useMemo(() => {
    const needle = forwardSearch.trim().toLowerCase();
    return chats.filter((chat) => {
      if (!needle) {
        return true;
      }
      return (
        chat.title.toLowerCase().includes(needle) ||
        chat.subtitle.toLowerCase().includes(needle) ||
        chat.lastPreview.toLowerCase().includes(needle)
      );
    });
  }, [chats, forwardSearch]);
  const activeReadMessageCount = useMemo(() => {
    if (!activeChat) {
      return 0;
    }
    const readOutboxMaxId = numericId(activeChat.readOutboxMaxId);
    if (readOutboxMaxId === null) {
      return 0;
    }

    return activeMessages.filter((message) => {
      if (message.from !== "me") {
        return false;
      }
      const id = numericId(message.id);
      return id !== null && id <= readOutboxMaxId;
    }).length;
  }, [activeChat, activeMessages]);

  const activeMediaMessages = useMemo(
    () => activeMessages.filter((message) => message.media).slice().reverse().slice(0, 8),
    [activeMessages],
  );

  const activeMediaCounts = useMemo(() => {
    const counts: Record<TgMediaAttachment["kind"], number> = {
      photo: 0,
      video: 0,
      audio: 0,
      voice: 0,
      gif: 0,
      file: 0,
      sticker: 0,
    };

    for (const message of activeMessages) {
      if (!message.media) {
        continue;
      }
      counts[message.media.kind] += 1;
    }

    return counts;
  }, [activeMessages]);

  const tabCounters = useMemo(
    () => ({
      all: chats.length,
      unread: chats.filter((chat) => chat.unread > 0).length,
      private: chats.filter((chat) => chat.kind === "private").length,
      groups: chats.filter((chat) => chat.kind === "group").length,
      channels: chats.filter((chat) => chat.kind === "channel").length,
      bots: chats.filter((chat) => chat.kind === "bot").length,
    }),
    [chats],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("proxytg-theme", theme);
    } catch {
      // ignore storage write failures
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("proxytg-hide-left", hideLeft ? "1" : "0");
      localStorage.setItem("proxytg-hide-right", hideRight ? "1" : "0");
    } catch {
      // ignore storage write failures
    }
  }, [hideLeft, hideRight]);

  useEffect(() => {
    function onVisibilityChange() {
      setDocumentVisible(document.visibilityState === "visible");
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (composeImage?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(composeImage.previewUrl);
      }
    };
  }, [composeImage]);

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

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    setStickerPickerOpen(false);
  }, [activeChatId]);

  useEffect(() => {
    if (!authorized || !stickerPickerOpen || (stickerLibraryReady && stickerLibrary)) {
      return;
    }

    void loadStickerLibrary();
  }, [authorized, stickerLibrary, stickerLibraryReady, stickerPickerOpen]);

  useEffect(() => {
    if (!stickerSections.length) {
      return;
    }

    const currentExists = stickerSections.some((section) => section.id === activeStickerSection);
    if (!currentExists) {
      setActiveStickerSection(stickerSections[0].id);
    }
  }, [activeStickerSection, stickerSections]);

  useEffect(() => {
    if (!stickerPickerOpen || !stickerLibrary) {
      return;
    }

    const hasPendingPreview = [
      ...stickerLibrary.recent,
      ...stickerLibrary.favorite,
      ...stickerLibrary.packs.flatMap((pack) => pack.stickers),
    ].some((sticker) => !sticker.path && !isLottieStickerMedia(sticker.mimeType, sticker.fileName));

    if (!hasPendingPreview) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadStickerLibrary(true);
    }, 1600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [stickerLibrary, stickerPickerOpen]);

  useEffect(() => {
    if (!authorized || typeof Notification === "undefined" || notifiedPermissionRef.current) {
      return;
    }

    notifiedPermissionRef.current = true;
    if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, [authorized]);

  useEffect(() => {
    if (!authorized) {
      return;
    }

    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    void listen<TgLiveEvent>("tg-sync", (event) => {
      if (disposed) {
        return;
      }
      scheduleLiveSync(event.payload);
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    });

    return () => {
      disposed = true;
      if (liveRefreshTimerRef.current !== null) {
        window.clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
      if (unlisten) {
        unlisten();
      }
    };
  }, [authorized, activeChatId]);

  useEffect(() => {
    if (!authorized) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshDialogs({ silent: true, loadActiveMessages: false });
    }, 45000);

    return () => {
      window.clearInterval(interval);
    };
  }, [authorized, activeChatId]);

  useEffect(() => {
    if (!activeChatId) {
      return;
    }

    const hasPendingMedia = activeMessages.some((message) => message.media && !message.media.path);
    if (!hasPendingMedia) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadMessages(activeChatId, true);
    }, 2500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeChatId, activeMessages]);

  useEffect(() => {
    if (!authorized || !activeChat || activeMessages.length === 0) {
      return;
    }
    if (!documentVisible || activeChat.unread <= 0) {
      return;
    }

    void markActiveChatRead(activeChat);
  }, [authorized, activeChat, activeMessages.length, documentVisible]);

  useEffect(() => {
    if (!storyViewerPeer || !currentStoryItem) {
      return;
    }

    void markStoryAsViewed(storyViewerPeer.chatId, currentStoryItem.id);

    if (currentStoryItem.media && !currentStoryItem.media.path) {
      const timer = window.setTimeout(() => {
        void openStoryPeer(storyViewerPeer, storyViewerIndex, true);
      }, 1400);

      return () => {
        window.clearTimeout(timer);
      };
    }

    const duration = storyAutoplayDurationMs(currentStoryItem);
    if (duration <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (storyViewerIndex < storyViewerItems.length - 1) {
        setStoryViewerIndex((prev) => prev + 1);
      } else {
        closeStoryViewer();
      }
    }, duration);

    return () => {
      window.clearTimeout(timer);
    };
  }, [currentStoryItem, storyViewerIndex, storyViewerItems.length, storyViewerPeer]);

  useEffect(() => {
    const container = messageStreamRef.current;
    if (!container || !activeChatId) {
      return;
    }

    const restore = pendingPrependRestoreRef.current;
    if (restore && restore.chatId === activeChatId) {
      const delta = container.scrollHeight - restore.prevScrollHeight;
      container.scrollTop = restore.prevScrollTop + delta;
      pendingPrependRestoreRef.current = null;
      return;
    }

    if (shouldStickToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [activeChatId, activeMessages.length]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      setLeftMenuOpen(false);
      setSettingsOpen(false);
      setSelfProfileOpen(false);
      setPeerProfileOpen(false);
      setStickerPickerOpen(false);
      closeForwardPicker();
      setStoryViewerPeer(null);
      setStoryViewerItems([]);
      setStoryViewerIndex(0);
    }

    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

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
      setStories([]);
      setMessagesByChat({});
      setActiveChatId("");
      setCompose("");
      setComposeImage(null);
      closeForwardPicker();
      setStickerLibrary(null);
      setStickerLibraryReady(false);
      setActiveStickerSection("recent");
      setStickerPackInput("");
      setStoryViewerPeer(null);
      setStoryViewerItems([]);
      setStoryViewerIndex(0);
      setSetupError("");
      setAuthError("");
      setConsoleError("");
      setLeftMenuOpen(false);
      setSettingsOpen(false);
      setSelfProfileOpen(false);
      setPeerProfileOpen(false);
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

  async function refreshStories() {
    try {
      const nextStories = await tgListStories(STORY_LIMIT);
      setStories(sortStoryPeers(nextStories));
    } catch (error) {
      setConsoleError(String(error));
    }
  }

  async function loadStickerLibrary(force = false) {
    if (stickerLibraryLoading) {
      return;
    }
    if (!force && stickerLibraryReady && stickerLibrary) {
      return;
    }

    setStickerLibraryLoading(true);
    try {
      const library = await tgListStickerLibrary(STICKER_SET_LIMIT, STICKERS_PER_SET);
      setStickerLibrary(library);
      setStickerLibraryReady(true);
      setConsoleResponse(
        toPretty({
          recent: library.recent.length,
          favorite: library.favorite.length,
          packs: library.packs.length,
        }),
      );
    } catch (error) {
      setConsoleError(String(error));
    } finally {
      setStickerLibraryLoading(false);
    }
  }

  async function refreshDialogs(options?: { silent?: boolean; loadActiveMessages?: boolean }) {
    if (dialogsRefreshInFlightRef.current) {
      return;
    }

    dialogsRefreshInFlightRef.current = true;
    try {
      const dialogs = await tgListDialogs(DIALOG_PAGE_SIZE);
      const previousChats = chats;
      const previousSnapshot = chatsSnapshotRef.current;
      const nextSnapshot: Record<string, { topMessageId: string; unread: number }> = {};

      for (const dialog of dialogs) {
        nextSnapshot[dialog.id] = {
          topMessageId: dialog.topMessageId,
          unread: dialog.unread,
        };
      }

      setChats(dialogs);

      if (!options?.silent) {
        setConsoleResponse(toPretty(dialogs.slice(0, 5)));
        setConsoleError("");
      }

      if (dialogs.length > 0) {
        const currentExists = dialogs.some((dialog) => dialog.id === activeChatId);
        const nextChatId = currentExists ? activeChatId : dialogs[0].id;
        setActiveChatId(nextChatId);

        const previousActive = previousChats.find((dialog) => dialog.id === nextChatId);
        const nextActive = dialogs.find((dialog) => dialog.id === nextChatId);
        const topChanged =
          nextActive && previousActive
            ? nextActive.topMessageId !== previousActive.topMessageId
            : Boolean(nextActive);

        if (options?.loadActiveMessages !== false && nextChatId) {
          void loadMessages(nextChatId, true);
        } else if (topChanged && nextChatId) {
          void loadMessages(nextChatId, true);
        }
      } else {
        setActiveChatId("");
      }

      if (
        options?.silent &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        for (const dialog of dialogs) {
          const prev = previousSnapshot[dialog.id];
          if (!prev) {
            continue;
          }
          if (
            dialog.topMessageId !== prev.topMessageId &&
            dialog.unread > prev.unread &&
            dialog.id !== activeChatId &&
            document.visibilityState !== "visible"
          ) {
            new Notification(dialog.title, {
              body: dialog.lastPreview || "Новое сообщение",
            });
          }
        }
      }

      chatsSnapshotRef.current = nextSnapshot;
      void refreshStories();
    } catch (error) {
      if (!options?.silent) {
        setConsoleError(String(error));
      }
    } finally {
      dialogsRefreshInFlightRef.current = false;
    }
  }

  async function loadMessages(chatId: string, force = false) {
    if (!force && messagesByChat[chatId]) {
      return;
    }
    if (messageLoadInFlightRef.current.has(chatId)) {
      return;
    }

    if (force) {
      pendingPrependRestoreRef.current = null;
      shouldStickToBottomRef.current = true;
    }

    messageLoadInFlightRef.current.add(chatId);
    try {
      const messages = await tgListMessages(chatId, MESSAGE_PAGE_SIZE);
      setMessagesByChat((prev) => ({
        ...prev,
        [chatId]: messages,
      }));
      setHasMoreByChat((prev) => ({
        ...prev,
        [chatId]: messages.length >= MESSAGE_PAGE_SIZE,
      }));
      setLoadingOlderByChat((prev) => ({
        ...prev,
        [chatId]: false,
      }));
    } catch (error) {
      setConsoleError(String(error));
    } finally {
      messageLoadInFlightRef.current.delete(chatId);
    }
  }

  async function loadOlderMessages(chatId: string) {
    if (olderLoadInFlightRef.current.has(chatId)) {
      return;
    }
    if (loadingOlderByChat[chatId]) {
      return;
    }
    if (hasMoreByChat[chatId] === false) {
      return;
    }

    const currentMessages = messagesByChat[chatId] ?? [];
    if (currentMessages.length === 0) {
      return;
    }

    const oldestMessageId = currentMessages[0]?.id;
    if (!oldestMessageId) {
      return;
    }
    const oldestNumericId = Number.parseInt(oldestMessageId, 10);
    if (!Number.isFinite(oldestNumericId)) {
      setHasMoreByChat((prev) => ({
        ...prev,
        [chatId]: false,
      }));
      return;
    }

    const container = messageStreamRef.current;
    if (container) {
      pendingPrependRestoreRef.current = {
        chatId,
        prevScrollTop: container.scrollTop,
        prevScrollHeight: container.scrollHeight,
      };
    }

    setLoadingOlderByChat((prev) => ({
      ...prev,
      [chatId]: true,
    }));
    olderLoadInFlightRef.current.add(chatId);

    try {
      const olderMessages = await tgListMessages(chatId, MESSAGE_PAGE_SIZE, String(oldestNumericId));
      const knownIds = new Set(currentMessages.map((message) => message.id));
      const freshOlder = olderMessages.filter((message) => !knownIds.has(message.id));

      if (freshOlder.length > 0) {
        setMessagesByChat((prev) => ({
          ...prev,
          [chatId]: [...freshOlder, ...(prev[chatId] ?? [])],
        }));
      } else {
        pendingPrependRestoreRef.current = null;
      }

      setHasMoreByChat((prev) => ({
        ...prev,
        [chatId]: olderMessages.length >= MESSAGE_PAGE_SIZE && freshOlder.length > 0,
      }));
    } catch (error) {
      pendingPrependRestoreRef.current = null;
      setConsoleError(String(error));
    } finally {
      olderLoadInFlightRef.current.delete(chatId);
      setLoadingOlderByChat((prev) => ({
        ...prev,
        [chatId]: false,
      }));
    }
  }

  function markChatReadLocally(chatId: string) {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              unread: 0,
              readInboxMaxId: chat.topMessageId,
            }
          : chat,
      ),
    );

    const snapshot = chatsSnapshotRef.current[chatId];
    if (snapshot) {
      chatsSnapshotRef.current = {
        ...chatsSnapshotRef.current,
        [chatId]: {
          ...snapshot,
          unread: 0,
        },
      };
    }
  }

  async function markActiveChatRead(chat: Chat) {
    if (!documentVisible || chat.unread <= 0) {
      return;
    }

    const fingerprint = `${chat.id}:${chat.topMessageId}:${chat.unread}`;
    if (readMarkInFlightRef.current.has(fingerprint)) {
      return;
    }

    readMarkInFlightRef.current.add(fingerprint);
    try {
      await tgMarkChatRead(chat.id);
      markChatReadLocally(chat.id);
    } catch (error) {
      setConsoleError(String(error));
    } finally {
      readMarkInFlightRef.current.delete(fingerprint);
    }
  }

  function markStoryViewedLocally(chatId: string, maxStoryId: number) {
    setStoryViewerItems((prev) => {
      const next = prev.map((item) => {
        const itemId = numericId(item.id);
        if (item.chatId !== chatId || itemId === null || itemId > maxStoryId || item.viewed) {
          return item;
        }
        return {
          ...item,
          viewed: true,
        };
      });

      const unreadRemaining = next.filter((item) => item.chatId === chatId && !item.viewed).length;
      setStories((current) =>
        sortStoryPeers(
          current.map((story) =>
            story.chatId === chatId
              ? {
                  ...story,
                  unreadCount: unreadRemaining,
                }
              : story,
          ),
        ),
      );

      return next;
    });
  }

  async function markStoryAsViewed(chatId: string, storyId: string) {
    const parsedId = numericId(storyId);
    if (parsedId === null) {
      return;
    }

    const fingerprint = `${chatId}:${parsedId}`;
    if (storyReadInFlightRef.current.has(fingerprint)) {
      return;
    }

    markStoryViewedLocally(chatId, parsedId);
    storyReadInFlightRef.current.add(fingerprint);
    try {
      await tgMarkStoriesRead(chatId, String(parsedId));
    } catch (error) {
      setConsoleError(String(error));
    } finally {
      storyReadInFlightRef.current.delete(fingerprint);
    }
  }

  function scheduleLiveSync(event?: TgLiveEvent) {
    if (liveRefreshTimerRef.current !== null) {
      window.clearTimeout(liveRefreshTimerRef.current);
    }

    liveRefreshTimerRef.current = window.setTimeout(() => {
      liveRefreshTimerRef.current = null;
      const shouldReloadActiveMessages =
        Boolean(event?.chatId) && event?.chatId === activeChatId && event?.kind === "message";

      void refreshDialogs({
        silent: true,
        loadActiveMessages: shouldReloadActiveMessages,
      });

      if (event?.kind === "story") {
        void refreshStories();
      }
    }, 220);
  }

  function closeForwardPicker() {
    setForwardDraft(null);
    setForwardSearch("");
    setForwardingMessage(false);
  }

  function openForwardPicker(message: Message) {
    setForwardDraft({
      sourceChatId: activeChat?.id ?? message.chatId,
      message,
    });
    setForwardSearch("");
  }

  async function forwardMessageToChat(targetChat: Chat) {
    if (!forwardDraft || forwardingMessage) {
      return;
    }

    setForwardingMessage(true);
    setConsoleError("");

    try {
      const sent = await tgForwardMessage({
        sourceChatId: forwardDraft.sourceChatId,
        messageId: forwardDraft.message.id,
        targetChatId: targetChat.id,
      });

      setMessagesByChat((prev) => {
        if (!prev[targetChat.id]) {
          return prev;
        }
        return {
          ...prev,
          [targetChat.id]: [...(prev[targetChat.id] ?? []), sent],
        };
      });
      shouldStickToBottomRef.current = activeChatId === targetChat.id;

      setChats((prev) => {
        const updated = prev.map((chat) =>
          chat.id === targetChat.id
            ? {
                ...chat,
                lastPreview: messagePreviewValue(sent),
                lastSeen: sent.at,
                unread: 0,
              }
            : chat,
        );
        const currentIndex = updated.findIndex((chat) => chat.id === targetChat.id);
        if (currentIndex > 0) {
          const [current] = updated.splice(currentIndex, 1);
          updated.unshift(current);
        }
        return updated;
      });

      setConsoleResponse(toPretty(sent));
      closeForwardPicker();
    } catch (error) {
      setConsoleError(String(error));
      setForwardingMessage(false);
    }
  }

  function handleMessageScroll() {
    const container = messageStreamRef.current;
    if (!container || !activeChat) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 96;

    if (container.scrollTop <= 120) {
      void loadOlderMessages(activeChat.id);
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
    setStickerPickerOpen(false);
    setMobileView("chat");
    void loadMessages(chat.id);
  }

  function clearComposeImage() {
    setComposeImage(null);
  }

  async function handleComposerPaste(event: ReactClipboardEvent<HTMLInputElement>) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageFile = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .find((file): file is File => Boolean(file));

    if (!imageFile) {
      return;
    }

    event.preventDefault();

    try {
      const draft = await clipboardFileToDraft(imageFile);
      setComposeImage(draft);
      setConsoleError("");
    } catch (error) {
      setConsoleError(String(error));
    }
  }

  async function openStoryPeer(story: StoryPeer, preferredIndex = 0, forceRefresh = false) {
    setActiveTab("all");
    setSearch("");
    setStoryViewerPeer(story);
    setStoryViewerLoading(true);

    try {
      const items = await tgGetPeerStories(story.chatId);
      if (items.length === 0) {
        setStoryViewerPeer(null);
        setStoryViewerItems([]);
        setStoryViewerIndex(0);
        return;
      }

      setStoryViewerItems(items);
      setStoryViewerIndex(Math.min(preferredIndex, Math.max(0, items.length - 1)));

      if (!forceRefresh) {
        setActiveChatId(story.chatId);
      }
    } catch (error) {
      setConsoleError(String(error));
      if (!forceRefresh) {
        setStoryViewerPeer(null);
        setStoryViewerItems([]);
        setStoryViewerIndex(0);
      }
    } finally {
      setStoryViewerLoading(false);
    }
  }

  async function sendFromComposer(event: FormEvent) {
    event.preventDefault();

    if (!activeChat) {
      return;
    }

    const text = compose.trim();
    const imageDraft = composeImage;
    if ((!text && !imageDraft) || sending) {
      return;
    }

    const optimisticId = `local-${Date.now()}`;
    const listPreview = imageDraft ? (text || "<photo>") : text;

    const optimisticMessage: Message = {
      id: optimisticId,
      chatId: activeChat.id,
      from: "me",
      senderName: "Вы",
      text,
      at: "now",
      status: "sending",
      media: imageDraft
        ? {
            kind: "photo",
            mimeType: imageDraft.mimeType,
            fileName: imageDraft.fileName,
            sizeBytes: imageDraft.sizeBytes,
          }
        : undefined,
    };

    setCompose("");
    setSending(true);
    setConsoleError("");

    setMessagesByChat((prev) => ({
      ...prev,
      [activeChat.id]: [...(prev[activeChat.id] ?? []), optimisticMessage],
    }));
    shouldStickToBottomRef.current = true;

    setChats((prev) => {
      const updated = prev.map((chat) =>
        chat.id === activeChat.id
          ? {
              ...chat,
              lastPreview: listPreview,
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
      const sent = imageDraft
        ? await tgSendPhoto(activeChat.id, {
            base64Data: imageDraft.base64Data,
            mimeType: imageDraft.mimeType,
            fileName: imageDraft.fileName,
            caption: text || undefined,
          })
        : await tgSendMessage(activeChat.id, text);

      setMessagesByChat((prev) => ({
        ...prev,
        [activeChat.id]: (prev[activeChat.id] ?? []).map((message) =>
          message.id === optimisticId ? { ...sent, status: "sent" } : message,
        ),
      }));

      if (imageDraft) {
        clearComposeImage();
      }
      setConsoleResponse(toPretty(sent));
    } catch (error) {
      if (text) {
        setCompose((current) => (current.trim() ? current : text));
      }
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

  async function sendStickerByItem(sticker: StickerItem) {
    if (!activeChat || stickerSending) {
      return;
    }

    setStickerSending(true);
    setConsoleError("");
    shouldStickToBottomRef.current = true;

    try {
      const sent = await tgSendStickerByRef(activeChat.id, {
        documentId: sticker.documentId,
        accessHash: sticker.accessHash,
        fileReferenceB64: sticker.fileReferenceB64,
      });
      setMessagesByChat((prev) => ({
        ...prev,
        [activeChat.id]: [...(prev[activeChat.id] ?? []), sent],
      }));

      setChats((prev) => {
        const updated = prev.map((chat) =>
          chat.id === activeChat.id
            ? {
                ...chat,
                lastPreview: "<sticker>",
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

      setConsoleResponse(toPretty(sent));
    } catch (error) {
      setConsoleError(String(error));
    } finally {
      setStickerSending(false);
    }
  }

  async function submitStickerSet(event: FormEvent) {
    event.preventDefault();

    const normalized = normalizeStickerSetInput(stickerPackInput);
    if (!normalized || stickerPackAdding) {
      return;
    }

    setStickerPackAdding(true);
    setConsoleError("");

    try {
      const response = await tgAddStickerSet(normalized);
      setStickerPackInput("");
      await loadStickerLibrary(true);
      setConsoleResponse(toPretty({ ok: true, message: response, shortName: normalized }));
    } catch (error) {
      setConsoleError(String(error));
    } finally {
      setStickerPackAdding(false);
    }
  }

  function closeStoryViewer() {
    setStoryViewerPeer(null);
    setStoryViewerItems([]);
    setStoryViewerIndex(0);
    setStoryViewerLoading(false);
  }

  function moveStoryViewer(direction: -1 | 1) {
    setStoryViewerIndex((prev) => {
      const next = prev + direction;
      if (next < 0 || next >= storyViewerItems.length) {
        return prev;
      }
      return next;
    });
  }

  function openStoryChat() {
    if (!storyViewerPeer) {
      return;
    }

    setActiveTab("all");
    setSearch("");
    setActiveChatId(storyViewerPeer.chatId);
    setMobileView("chat");
    closeStoryViewer();
    void loadMessages(storyViewerPeer.chatId);
  }

  function notifyPlannedFeature(label: string) {
    setConsoleError("");
    setConsoleResponse(
      toPretty({
        ok: true,
        note: `${label} пока в разработке; оставил пункт в UI, как в Telegram Desktop.`,
      }),
    );
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

  const ownDisplayName = authState?.meDisplayName ?? "ProxyTG";
  const ownPhone = authState?.mePhone ?? sessionState?.phoneNumber ?? "";
  const ownUsername = authState?.meUsername ? `@${authState.meUsername}` : usernameFromTitle(ownDisplayName);
  const ownAvatarUrl = toAssetUrl(authState?.meAvatarPath);
  const activeAvatarUrl = activeChat ? toAssetUrl(activeChat.avatarPath) : undefined;
  const storyViewerAvatarUrl = storyViewerPeer ? toAssetUrl(storyViewerPeer.avatarPath) : undefined;
  const activePhone =
    activeChat && activeChat.subtitle.trim().startsWith("+")
      ? activeChat.subtitle.trim()
      : "hidden";

  const railTabs: Array<{ id: ChatTab; label: string; icon: IconName; count: number }> = [
    { id: "private", label: "Личные", icon: "private", count: tabCounters.private },
    { id: "all", label: "Чаты", icon: "chats", count: tabCounters.all },
    { id: "groups", label: "Группы", icon: "groups", count: tabCounters.groups },
    { id: "channels", label: "Каналы", icon: "channels", count: tabCounters.channels },
    { id: "bots", label: "Боты", icon: "bots", count: tabCounters.bots },
  ];

  return (
    <>
      <main
        className={`td-shell ${mobileView === "chat" ? "chat-open" : "list-open"} ${hideLeft ? "left-hidden" : ""} ${hideRight ? "right-hidden" : ""}`}
      >
        <section className="td-left-column">
          <aside className="td-rail">
            <button
              type="button"
              className="td-rail-menu"
              onClick={() => setLeftMenuOpen(true)}
              title="Меню"
            >
              <Icon name="menu" />
            </button>

            <div className="td-rail-list">
              {railTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === activeTab ? "td-rail-btn active" : "td-rail-btn"}
                  onClick={() => setActiveTab(item.id)}
                  title={item.label}
                >
                  <span className="td-rail-icon" aria-hidden>
                    <Icon name={item.icon} />
                  </span>
                  <span>{item.label}</span>
                  {item.count > 0 ? <em>{item.count}</em> : null}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="td-rail-settings"
              onClick={() => setSettingsOpen(true)}
              title="Настройки"
            >
              <Icon name="settings" />
            </button>
          </aside>

          <aside className="td-dialogs">
            <header className="td-dialogs-header">
              <label className="td-search-wrap" aria-label="Поиск">
                <Icon name="search" className="td-inline-icon" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search"
                />
              </label>
              <button
                type="button"
                className="td-refresh-btn"
                title="Обновить список чатов"
                onClick={() => void refreshDialogs()}
              >
                <Icon name="refresh" />
              </button>
            </header>

            <div className="td-story-row" role="list" aria-label="Stories">
              {storyPeers.length === 0 ? (
                <div className="td-story-empty">
                  {authorized ? "У аккаунта сейчас нет активных историй." : "Истории недоступны."}
                </div>
              ) : (
                storyPeers.map((story) => {
                  const avatarUrl = toAssetUrl(story.avatarPath);
                  const linkedChat = chats.find((chat) => chat.id === story.chatId);
                  return (
                    <button
                      key={`story-${story.id}`}
                      type="button"
                      className={story.chatId === storyViewerPeer?.chatId ? "td-story active" : "td-story"}
                      onClick={() => void openStoryPeer(story)}
                      title={story.lastCaption ? `${story.title}: ${story.lastCaption}` : story.title}
                      role="listitem"
                    >
                      <span
                        className={
                          story.unreadCount > 0 ? "td-story-ring unread" : "td-story-ring"
                        }
                      >
                        <span
                          className={`avatar small ${avatarUrl ? "has-image" : ""}`}
                          style={{
                            background: avatarUrl
                              ? undefined
                              : avatarColor(linkedChat?.title ?? story.title),
                          }}
                          aria-hidden
                        >
                          {avatarUrl ? (
                            <img src={avatarUrl} alt={story.title} loading="lazy" />
                          ) : (
                            initials(story.title)
                          )}
                        </span>
                      </span>
                      <span className="td-story-label">{truncateText(story.title, 10)}</span>
                      {story.unreadCount > 0 ? (
                        <span className="td-story-badge">{story.unreadCount}</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>

            <ul className="chat-list td-dialog-list">
              {visibleChats.map((chat, index) => {
                const avatarUrl = toAssetUrl(chat.avatarPath);

                return (
                  <li key={chat.id} style={{ animationDelay: `${index * 18}ms` }}>
                    <button
                      type="button"
                      className={chat.id === activeChat?.id ? "chat-item active" : "chat-item"}
                      onClick={() => markChatAsActive(chat)}
                    >
                      <span
                        className={`avatar ${avatarUrl ? "has-image" : ""}`}
                        style={{ background: avatarUrl ? undefined : avatarColor(chat.title) }}
                        aria-hidden
                      >
                        {avatarUrl ? (
                          <img src={avatarUrl} alt={chat.title} loading="lazy" />
                        ) : (
                          initials(chat.title)
                        )}
                      </span>

                      <span className="chat-main">
                        <span className="chat-line title-line">
                          <strong>{truncateText(chat.title, 31)}</strong>
                          <time>{chat.lastSeen}</time>
                        </span>

                        <span className="chat-line subtitle-line">
                          <small>{truncateText(previewLabel(chat.lastPreview || chat.subtitle), 52)}</small>
                        </span>
                      </span>

                      <span className="chat-meta">
                        {chat.unread > 0 ? <span className="badge">{chat.unread}</span> : null}
                        {chat.verified ? <span className="verified">✓</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        </section>

        <section className="td-chat-column">
          {activeChat ? (
            <>
              <header className="chat-header td-chat-header">
                <div className="chat-title-wrap">
                  <button
                    type="button"
                    className="td-mobile-back"
                    onClick={() => setMobileView("list")}
                  >
                    <Icon name="back" />
                  </button>
                  <button
                    type="button"
                    className="td-chat-avatar-btn"
                    onClick={() => setPeerProfileOpen(true)}
                  >
                    <span
                      className={`avatar ${activeAvatarUrl ? "has-image" : ""}`}
                      style={{ background: activeAvatarUrl ? undefined : avatarColor(activeChat.title) }}
                      aria-hidden
                    >
                      {activeAvatarUrl ? (
                        <img src={activeAvatarUrl} alt={activeChat.title} loading="lazy" />
                      ) : (
                        initials(activeChat.title)
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="td-chat-title-btn"
                    onClick={() => setPeerProfileOpen(true)}
                  >
                    <strong>{activeChat.title}</strong>
                    <small>{chatStatusLine(activeChat)}</small>
                  </button>
                </div>

                <div className="td-header-actions">
                  <button type="button" onClick={() => setHideLeft((value) => !value)} title="Левая панель">
                    <Icon name="panelLeft" />
                  </button>
                  <button type="button" onClick={() => setHideRight((value) => !value)} title="Правая панель">
                    <Icon name="panelRight" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
                    title="Сменить тему"
                  >
                    <Icon name={theme === "dark" ? "sun" : "moon"} />
                  </button>
                  <button type="button" onClick={() => setPeerProfileOpen(true)} title="Профиль">
                    <Icon name="more" />
                  </button>
                </div>
              </header>

              <div className="td-pinned-bar">
                <strong>Pinned message</strong>
                <span>{truncateText(previewLabel(activeChat.lastPreview || "Нет закрепа"), 60)}</span>
              </div>

              <div
                className="message-stream td-message-stream"
                ref={messageStreamRef}
                onScroll={handleMessageScroll}
              >
                {activeMessages.length > 0 ? (
                  <div className={loadingOlderActive ? "history-hint loading" : "history-hint"}>
                    {loadingOlderActive
                      ? "Загрузка истории..."
                      : hasMoreActive
                        ? "Прокрути вверх для более старых сообщений"
                        : "Начало переписки"}
                  </div>
                ) : null}

                {activeMessages.map((message) => {
                  const mediaMeta = message.media ? mediaMetaText(message.media) : null;
                  const hasRenderableText = message.text && !isSyntheticMediaText(message.text);
                  const resolvedStatus = effectiveMessageStatus(message, activeChat);

                  return (
                    <article
                      key={message.id}
                      className={message.from === "me" ? "bubble mine" : "bubble peer"}
                    >
                      {message.from !== "me" && message.senderName ? (
                        <div className="sender-line peer">{message.senderName}</div>
                      ) : null}

                      {message.media ? (
                        <div className="media-head">
                          <span className={`media-kind kind-${message.media.kind}`}>
                            {mediaKindLabel(message.media.kind)}
                          </span>
                          {mediaMeta ? <span className="media-extra">{mediaMeta}</span> : null}
                        </div>
                      ) : null}

                      {renderMedia(message.media)}
                      {hasRenderableText ? <p>{message.text}</p> : null}

                      <footer>
                        <time>{message.at}</time>
                        {message.from === "me" ? (
                          <small className={`state ${resolvedStatus ?? "sending"}`}>
                            {statusGlyph(resolvedStatus)}
                          </small>
                        ) : null}
                        {!message.id.startsWith("local-") ? (
                          <button
                            type="button"
                            className="bubble-forward"
                            onClick={() => openForwardPicker(message)}
                            title="Переслать сообщение"
                          >
                            <Icon name="forward" size={14} />
                          </button>
                        ) : null}
                      </footer>
                    </article>
                  );
                })}
              </div>

              {stickerPickerOpen ? (
                <section className="sticker-tray td-sticker-tray">
                  <div className="sticker-panel-head">
                    <div className="sticker-section-tabs">
                      {stickerSections.map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          className={
                            section.id === currentStickerSection?.id
                              ? "sticker-section-tab active"
                              : "sticker-section-tab"
                          }
                          onClick={() => setActiveStickerSection(section.id)}
                        >
                          {truncateText(section.label, 14)}
                        </button>
                      ))}
                    </div>

                    <form className="sticker-add-form" onSubmit={submitStickerSet}>
                      <input
                        value={stickerPackInput}
                        onChange={(event) => setStickerPackInput(event.target.value)}
                        placeholder="addstickers/packname"
                      />
                      <button
                        type="submit"
                        disabled={!normalizeStickerSetInput(stickerPackInput) || stickerPackAdding}
                      >
                        {stickerPackAdding ? "..." : "Add"}
                      </button>
                    </form>
                  </div>

                  {stickerLibraryLoading ? (
                    <p>Подгружаю ваши наборы стикеров...</p>
                  ) : currentStickerItems.length === 0 ? (
                    <p>Стикеров пока нет. Можно добавить набор по `short_name` или ссылке `t.me/addstickers/...`.</p>
                  ) : (
                    <div className="sticker-grid">
                      {currentStickerItems.map((sticker) => (
                        <button
                          key={`${sticker.documentId}-${sticker.fileReferenceB64}`}
                          type="button"
                          className="sticker-btn"
                          onClick={() => void sendStickerByItem(sticker)}
                          disabled={stickerSending}
                          title={sticker.setTitle ?? sticker.emoji ?? "Отправить стикер"}
                        >
                          {renderStickerThumb(sticker)}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {composeImage ? (
                <div className="composer-attachment">
                  <div className="composer-attachment-thumb">
                    <img src={composeImage.previewUrl} alt={composeImage.fileName} />
                  </div>
                  <div className="composer-attachment-copy">
                    <strong>{composeImage.fileName}</strong>
                    <span>{formatBytes(composeImage.sizeBytes) ?? "Image from clipboard"}</span>
                  </div>
                  <button type="button" className="composer-attachment-remove" onClick={clearComposeImage}>
                    <Icon name="close" />
                  </button>
                </div>
              ) : null}

              <form className="composer td-composer" onSubmit={sendFromComposer}>
                <button
                  type="button"
                  className={stickerPickerOpen ? "sticker-toggle active" : "sticker-toggle"}
                  onClick={() => setStickerPickerOpen((value) => !value)}
                  disabled={stickerSending}
                >
                  <Icon name="smile" />
                </button>

                <input
                  value={compose}
                  onChange={(event) => setCompose(event.target.value)}
                  onPaste={handleComposerPaste}
                  placeholder="Write a message..."
                />

                <button
                  type="button"
                  className="td-compose-emoji"
                  onClick={() => notifyPlannedFeature("Emoji/реакции")}
                  title="Emoji"
                >
                  <Icon name="record" />
                </button>

                <button type="submit" disabled={sending || (!compose.trim() && !composeImage)}>
                  {sending ? "..." : <Icon name="send" />}
                </button>
              </form>
            </>
          ) : (
            <div className="empty">No chat selected</div>
          )}
        </section>

        {!hideRight ? (
          <aside className="td-right-column">
            <header>
              <h2>Chat Info</h2>
              <button type="button" onClick={() => setPeerProfileOpen(true)}>
                Open
              </button>
            </header>

            <section className="td-right-block">
              <h3>{activeChat?.title ?? "Dialog"}</h3>
              <p>{activeChat ? chatStatusLine(activeChat) : "No details"}</p>
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
              </dl>
            </section>

            <section className="td-right-block">
              <h3>Media</h3>
              <ul className="td-stat-list">
                <li>Фото: {activeMediaCounts.photo}</li>
                <li>Видео: {activeMediaCounts.video}</li>
                <li>Стикеры: {activeMediaCounts.sticker}</li>
                <li>ГС: {activeMediaCounts.voice}</li>
                <li>GIF: {activeMediaCounts.gif}</li>
                <li>Файлы: {activeMediaCounts.file + activeMediaCounts.audio}</li>
              </ul>
            </section>

            <section className="td-right-block">
              <h3>Messages</h3>
              <ul className="td-stat-list">
                <li>Непрочитанные: {activeChat?.unread ?? 0}</li>
                <li>Прочитанные исходящие: {activeReadMessageCount}</li>
                <li>Последний message id: {activeChat?.topMessageId ?? "-"}</li>
              </ul>
            </section>

            <section className="td-right-block">
              <button type="button" onClick={() => void loadMessages(activeChat?.id ?? "", true)} disabled={!activeChat}>
                Refresh messages
              </button>
              <button type="button" onClick={() => void refreshDialogs()}>
                Refresh dialogs
              </button>
            </section>
          </aside>
        ) : null}
      </main>

      {storyViewerPeer ? (
        <div className="story-viewer-overlay" onClick={closeStoryViewer}>
          <section className="story-viewer-modal" onClick={(event) => event.stopPropagation()}>
            <header className="story-viewer-head">
              <div className="story-viewer-progress">
                {storyViewerItems.map((item, index) => (
                  <span
                    key={`story-progress-${item.id}`}
                    className={
                      index < storyViewerIndex
                        ? "story-progress-bar done"
                        : index === storyViewerIndex
                          ? "story-progress-bar active"
                          : "story-progress-bar"
                    }
                  >
                    <span
                      key={
                        index === storyViewerIndex
                          ? `story-progress-fill-${item.id}-${storyViewerIndex}`
                          : `story-progress-static-${item.id}`
                      }
                      style={
                        index < storyViewerIndex
                          ? { width: "100%" }
                          : index === storyViewerIndex
                            ? {
                                animationDuration: `${storyAutoplayDurationMs(currentStoryItem)}ms`,
                              }
                            : undefined
                      }
                    />
                  </span>
                ))}
              </div>

              <div className="story-viewer-meta">
                <span
                  className={`avatar small ${storyViewerAvatarUrl ? "has-image" : ""}`}
                  style={{
                    background: storyViewerAvatarUrl
                      ? undefined
                      : avatarColor(storyViewerPeer.title),
                  }}
                >
                  {storyViewerAvatarUrl ? (
                    <img src={storyViewerAvatarUrl} alt={storyViewerPeer.title} loading="lazy" />
                  ) : (
                    initials(storyViewerPeer.title)
                  )}
                </span>
                <div>
                  <strong>{storyViewerPeer.title}</strong>
                  <small>{currentStoryItem?.at ?? "story"}</small>
                </div>
              </div>

              <div className="story-viewer-actions">
                <button type="button" onClick={openStoryChat}>
                  Open chat
                </button>
                <button type="button" onClick={closeStoryViewer} title="Close story">
                  <Icon name="close" />
                </button>
              </div>
            </header>

            <div className="story-viewer-body">
              <button
                type="button"
                className="story-viewer-nav prev"
                onClick={() => moveStoryViewer(-1)}
                disabled={storyViewerIndex === 0}
                aria-label="Previous story"
              >
                <Icon name="back" />
              </button>

              <div className="story-viewer-frame">
                {storyViewerLoading ? (
                  <div className="story-viewer-empty">Загружаю истории...</div>
                ) : (
                  renderStoryViewerMedia(currentStoryItem)
                )}
              </div>

              <button
                type="button"
                className="story-viewer-nav next"
                onClick={() => moveStoryViewer(1)}
                disabled={storyViewerIndex >= storyViewerItems.length - 1}
                aria-label="Next story"
              >
                <Icon name="panelRight" />
              </button>
            </div>

            {currentStoryItem?.caption ? (
              <footer className="story-viewer-caption">
                <p>{currentStoryItem.caption}</p>
              </footer>
            ) : null}
          </section>
        </div>
      ) : null}

      {forwardDraft ? (
        <div className="td-overlay" onClick={closeForwardPicker}>
          <section className="td-forward-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Переслать сообщение</h2>
                <p>{truncateText(previewLabel(messagePreviewValue(forwardDraft.message)), 72)}</p>
              </div>
              <button type="button" onClick={closeForwardPicker} title="Закрыть">
                <Icon name="close" />
              </button>
            </header>

            <label className="td-search-wrap td-forward-search" aria-label="Поиск чата">
              <Icon name="search" className="td-inline-icon" />
              <input
                value={forwardSearch}
                onChange={(event) => setForwardSearch(event.target.value)}
                placeholder="Куда переслать"
              />
            </label>

            <div className="td-forward-list">
              {forwardTargetChats.map((chat) => {
                const avatarUrl = toAssetUrl(chat.avatarPath);
                return (
                  <button
                    key={`forward-${chat.id}`}
                    type="button"
                    className="td-forward-chat"
                    onClick={() => void forwardMessageToChat(chat)}
                    disabled={forwardingMessage}
                  >
                    <span
                      className={`avatar ${avatarUrl ? "has-image" : ""}`}
                      style={{ background: avatarUrl ? undefined : avatarColor(chat.title) }}
                      aria-hidden
                    >
                      {avatarUrl ? (
                        <img src={avatarUrl} alt={chat.title} loading="lazy" />
                      ) : (
                        initials(chat.title)
                      )}
                    </span>
                    <span className="td-forward-copy">
                      <strong>{truncateText(chat.title, 32)}</strong>
                      <small>{truncateText(previewLabel(chat.lastPreview || chat.subtitle), 56)}</small>
                    </span>
                    {chat.unread > 0 ? <span className="badge">{chat.unread}</span> : null}
                  </button>
                );
              })}
              {forwardTargetChats.length === 0 ? (
                <div className="td-forward-empty">Чаты не найдены.</div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {leftMenuOpen ? (
        <div className="td-overlay" onClick={() => setLeftMenuOpen(false)}>
          <aside className="td-menu-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="td-menu-profile">
              <span className={`avatar me large ${ownAvatarUrl ? "has-image" : ""}`}>
                {ownAvatarUrl ? (
                  <img src={ownAvatarUrl} alt={ownDisplayName} loading="lazy" />
                ) : (
                  initials(ownDisplayName)
                )}
              </span>
              <div>
                <strong>{ownDisplayName}</strong>
                <small>Change Emoji Status</small>
              </div>
            </div>

            <nav className="td-menu-list">
              <button
                type="button"
                onClick={() => {
                  setLeftMenuOpen(false);
                  setSelfProfileOpen(true);
                }}
              >
                <Icon name="profile" />
                <span>My Profile</span>
              </button>

              <button type="button" onClick={() => notifyPlannedFeature("Wallet")}>
                <Icon name="wallet" />
                <span>Wallet</span>
              </button>

              <button type="button" onClick={() => notifyPlannedFeature("New Group")}>
                <Icon name="newGroup" />
                <span>New Group</span>
              </button>

              <button type="button" onClick={() => notifyPlannedFeature("New Channel")}>
                <Icon name="newChannel" />
                <span>New Channel</span>
              </button>

              <button type="button" onClick={() => setActiveTab("private")}>
                <Icon name="contacts" />
                <span>Contacts</span>
              </button>

              <button type="button" onClick={() => notifyPlannedFeature("Calls")}>
                <Icon name="calls" />
                <span>Calls</span>
              </button>

              <button type="button" onClick={() => notifyPlannedFeature("Saved Messages")}>
                <Icon name="saved" />
                <span>Saved Messages</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setLeftMenuOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <Icon name="settings" />
                <span>Settings</span>
              </button>

              <button
                type="button"
                className="td-menu-toggle"
                onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
              >
                <Icon name={theme === "dark" ? "moon" : "sun"} />
                <span>Night Mode</span>
                <span className={theme === "dark" ? "td-switch on" : "td-switch"} />
              </button>
            </nav>

            <footer>
              <small>ProxyTG Desktop</small>
              <small>Version 0.1.0</small>
            </footer>
          </aside>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="td-overlay" onClick={() => setSettingsOpen(false)}>
          <section className="td-settings-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>Settings</h2>
              <button type="button" onClick={() => setSettingsOpen(false)}>
                <Icon name="close" />
              </button>
            </header>

            <div className="td-settings-grid">
              <section className="td-settings-block">
                <h3>Appearance</h3>
                <button
                  type="button"
                  onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
                >
                  Тема: {theme === "dark" ? "Dark" : "Light"}
                </button>
                <button type="button" onClick={() => setHideLeft((value) => !value)}>
                  Левый блок: {hideLeft ? "hidden" : "visible"}
                </button>
                <button type="button" onClick={() => setHideRight((value) => !value)}>
                  Правый блок: {hideRight ? "hidden" : "visible"}
                </button>
              </section>

              <section className="td-settings-block">
                <h3>Session</h3>
                <p>
                  <strong>Phone:</strong> {sessionState?.phoneNumber ?? "not set"}
                </p>
                <p>
                  <strong>SOCKS5:</strong>{" "}
                  {sessionState?.socks5Host
                    ? `${sessionState.socks5Host}:${sessionState.socks5Port ?? "-"}`
                    : "not set"}
                </p>
                <p>
                  <strong>Proxy user:</strong> {sessionState?.socks5Username ?? "none"}
                </p>
              </section>

              <section className="td-settings-block">
                <h3>Sync</h3>
                <button type="button" onClick={() => void refreshDialogs()}>
                  Refresh dialogs
                </button>
                <button type="button" onClick={() => void loadMessages(activeChat?.id ?? "", true)} disabled={!activeChat}>
                  Refresh messages
                </button>
                <button type="button" onClick={() => void refreshSystem()}>
                  Refresh system state
                </button>
              </section>

              <section className="td-settings-block">
                <h3>Debug</h3>
                <pre>{meta ? toPretty(meta) : "meta not loaded"}</pre>
                <pre>{health ? toPretty(health) : "health not loaded"}</pre>
                <pre>{consoleResponse}</pre>
                {consoleError ? <p className="error-line">{consoleError}</p> : null}
                <button type="button" className="danger-btn" onClick={resetSavedSetup}>
                  Сбросить setup
                </button>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {selfProfileOpen ? (
        <div className="td-overlay" onClick={() => setSelfProfileOpen(false)}>
          <section className="td-profile-modal self" onClick={(event) => event.stopPropagation()}>
            <header className="td-profile-head">
              <span className={`avatar xl me ${ownAvatarUrl ? "has-image" : ""}`}>
                {ownAvatarUrl ? (
                  <img src={ownAvatarUrl} alt={ownDisplayName} loading="lazy" />
                ) : (
                  initials(ownDisplayName)
                )}
              </span>
              <div>
                <strong>{ownDisplayName}</strong>
                <small>{ownUsername}</small>
                <small>online</small>
              </div>
              <button type="button" onClick={() => setSelfProfileOpen(false)}>
                <Icon name="close" />
              </button>
            </header>

            <section className="td-profile-block">
              <p>
                <strong>{ownPhone || "No phone"}</strong>
              </p>
              <p>Mobile</p>
              <p>
                <strong>ProxyTG user</strong>
              </p>
              <p>Bio</p>
            </section>

            <section className="td-profile-block stats">
              <div>
                <span>Gifts</span>
                <strong>{Math.max(1, activeMediaCounts.sticker)}</strong>
              </div>
              <div>
                <span>Story Archive</span>
                <strong>{stories.length}</strong>
              </div>
            </section>

            <section className="td-profile-media-grid">
              {activeMediaMessages.length > 0 ? (
                activeMediaMessages.map((message) => {
                  const src = toAssetUrl(message.media?.path);
                  const duration = formatDuration(message.media?.durationSec);
                  return (
                    <article key={`self-media-${message.id}`}>
                      {src ? (
                        message.media?.kind === "video" || message.media?.kind === "gif" ? (
                          <video src={src} muted playsInline preload="metadata" />
                        ) : (
                          <img src={src} alt="media" loading="lazy" />
                        )
                      ) : (
                        <div className="td-media-pending">Loading...</div>
                      )}
                      <span>{duration ?? mediaKindLabel(message.media?.kind ?? "file")}</span>
                    </article>
                  );
                })
              ) : (
                <p className="td-profile-empty">Медиа пока нет</p>
              )}
            </section>
          </section>
        </div>
      ) : null}

      {peerProfileOpen && activeChat ? (
        <div className="td-overlay" onClick={() => setPeerProfileOpen(false)}>
          <section className="td-profile-modal peer" onClick={(event) => event.stopPropagation()}>
            <header className="td-profile-head">
              <span
                className={`avatar xl ${activeAvatarUrl ? "has-image" : ""}`}
                style={{ background: activeAvatarUrl ? undefined : avatarColor(activeChat.title) }}
              >
                {activeAvatarUrl ? (
                  <img src={activeAvatarUrl} alt={activeChat.title} loading="lazy" />
                ) : (
                  initials(activeChat.title)
                )}
              </span>
              <div>
                <strong>{activeChat.title}</strong>
                <small>{chatStatusLine(activeChat)}</small>
              </div>
              <button type="button" onClick={() => setPeerProfileOpen(false)}>
                <Icon name="close" />
              </button>
            </header>

            <section className="td-profile-actions">
              <button type="button">
                <Icon name="message" />
                <span>Message</span>
              </button>
              <button type="button">
                <Icon name="mute" />
                <span>{activeChat.muted ? "Unmute" : "Mute"}</span>
              </button>
              <button type="button" onClick={() => notifyPlannedFeature("Call UI")}>
                <Icon name="call" />
                <span>Call</span>
              </button>
              <button type="button" onClick={() => notifyPlannedFeature("More menu")}>
                <Icon name="more" />
                <span>More</span>
              </button>
            </section>

            <section className="td-profile-block">
              <p>
                <strong>{activePhone}</strong>
              </p>
              <p>Mobile</p>
              <p>
                <strong>{usernameFromTitle(activeChat.title)}</strong>
              </p>
              <p>Username</p>
              <p>
                <strong>ADD TO CONTACTS</strong>
              </p>
            </section>

            <section className="td-profile-block">
              <ul className="td-stat-list">
                <li>{activeMediaCounts.photo} photos</li>
                <li>{activeMediaCounts.file + activeMediaCounts.audio} files</li>
                <li>{activeMediaCounts.voice} voice messages</li>
                <li>{activeMediaCounts.gif} GIF</li>
                <li>{activeMediaCounts.sticker} stickers</li>
              </ul>
            </section>
          </section>
        </div>
      ) : null}
    </>
  );
}
