import { invoke } from "@tauri-apps/api/core";

export type ProxyMeta = {
  proxyBaseUrl: string;
  hasApiKey: boolean;
  timeoutMs: number;
};

export type SessionSetupInput = {
  apiId: number;
  apiHash: string;
  phoneNumber?: string;
  socks5Host: string;
  socks5Port: number;
  socks5Username?: string;
  socks5Password?: string;
};

export type SessionState = {
  setupCompleted: boolean;
  hasSessionBlob: boolean;
  apiId?: number;
  phoneNumber?: string;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  updatedAtEpoch?: number;
};

export type TgAuthState = {
  setupCompleted: boolean;
  connected: boolean;
  authorized: boolean;
  loginState: "needPhone" | "awaitingCode" | "awaitingPassword" | "authorized";
  phoneNumber?: string;
  meDisplayName?: string;
  meUsername?: string;
  mePhone?: string;
  meAvatarPath?: string;
  error?: string;
};

export type TgDialog = {
  id: string;
  telegramChatId: string;
  avatarPath?: string;
  title: string;
  subtitle: string;
  kind: "private" | "group" | "channel" | "bot";
  verified: boolean;
  online: boolean;
  pinned: boolean;
  muted: boolean;
  unread: number;
  lastPreview: string;
  lastSeen: string;
  topMessageId: string;
  readInboxMaxId: string;
  readOutboxMaxId: string;
};

export type TgMediaAttachment = {
  kind: "photo" | "video" | "audio" | "voice" | "gif" | "file" | "sticker";
  path?: string;
  mimeType?: string;
  fileName?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
};

export type TgMessage = {
  id: string;
  chatId: string;
  from: "me" | "peer";
  senderName?: string;
  text: string;
  at: string;
  status?: "sending" | "sent" | "read" | "failed";
  media?: TgMediaAttachment;
};

export type TgStoryPeer = {
  id: string;
  chatId: string;
  avatarPath?: string;
  title: string;
  unreadCount: number;
  storyCount: number;
  lastCaption?: string;
};

export type TgStoryItem = {
  id: string;
  chatId: string;
  caption: string;
  at: string;
  viewed: boolean;
  media?: TgMediaAttachment;
};

export type TgStickerItem = {
  documentId: string;
  accessHash: string;
  fileReferenceB64: string;
  emoji?: string;
  setTitle?: string;
  setShortName?: string;
  path?: string;
  mimeType?: string;
  fileName?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
  animated: boolean;
};

export type TgStickerPack = {
  id: string;
  title: string;
  shortName: string;
  stickers: TgStickerItem[];
};

export type TgStickerLibrary = {
  recent: TgStickerItem[];
  favorite: TgStickerItem[];
  packs: TgStickerPack[];
};

export type TgStickerRefInput = Pick<
  TgStickerItem,
  "documentId" | "accessHash" | "fileReferenceB64"
>;

export type TgPhotoUploadInput = {
  base64Data: string;
  mimeType?: string;
  fileName?: string;
  caption?: string;
};

export type TgForwardMessageInput = {
  sourceChatId: string;
  messageId: string;
  targetChatId: string;
};

export async function proxyMeta(): Promise<ProxyMeta> {
  return invoke<ProxyMeta>("proxy_meta");
}

export async function healthcheck(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("healthcheck");
}

export async function getSessionState(): Promise<SessionState> {
  return invoke<SessionState>("get_session_state");
}

export async function saveSessionSetup(
  input: SessionSetupInput,
): Promise<SessionState> {
  return invoke<SessionState>("save_session_setup", {
    input,
  });
}

export async function clearSessionSetup(): Promise<void> {
  return invoke<void>("clear_session_setup");
}

export async function markSessionReady(
  sessionBlob?: string,
): Promise<SessionState> {
  return invoke<SessionState>("mark_session_ready", {
    sessionBlob,
  });
}

export async function tgBootstrap(): Promise<TgAuthState> {
  return invoke<TgAuthState>("tg_bootstrap");
}

export async function tgRequestCode(phoneNumber: string): Promise<TgAuthState> {
  return invoke<TgAuthState>("tg_request_code", {
    phoneNumber,
  });
}

export async function tgSignInCode(code: string): Promise<TgAuthState> {
  return invoke<TgAuthState>("tg_sign_in_code", {
    code,
  });
}

export async function tgCheckPassword(password: string): Promise<TgAuthState> {
  return invoke<TgAuthState>("tg_check_password", {
    password,
  });
}

export async function tgListDialogs(limit = 80): Promise<TgDialog[]> {
  return invoke<TgDialog[]>("tg_list_dialogs", {
    limit,
  });
}

export async function tgListStories(limit = 24): Promise<TgStoryPeer[]> {
  return invoke<TgStoryPeer[]>("tg_list_stories", {
    limit,
  });
}

export async function tgGetPeerStories(chatId: string): Promise<TgStoryItem[]> {
  return invoke<TgStoryItem[]>("tg_get_peer_stories", {
    chatId,
  });
}

export async function tgListMessages(
  chatId: string,
  limit = 80,
  beforeMessageId?: string,
): Promise<TgMessage[]> {
  return invoke<TgMessage[]>("tg_list_messages", {
    chatId,
    limit,
    beforeMessageId,
  });
}

export async function tgSendMessage(
  chatId: string,
  text: string,
): Promise<TgMessage> {
  return invoke<TgMessage>("tg_send_message", {
    chatId,
    text,
  });
}

export async function tgSendPhoto(
  chatId: string,
  photo: TgPhotoUploadInput,
): Promise<TgMessage> {
  return invoke<TgMessage>("tg_send_photo", {
    chatId,
    photo,
  });
}

export async function tgMarkChatRead(chatId: string): Promise<void> {
  return invoke<void>("tg_mark_chat_read", {
    chatId,
  });
}

export async function tgMarkStoriesRead(
  chatId: string,
  maxStoryId: string,
): Promise<void> {
  return invoke<void>("tg_mark_stories_read", {
    chatId,
    maxStoryId,
  });
}

export async function tgForwardMessage(
  input: TgForwardMessageInput,
): Promise<TgMessage> {
  return invoke<TgMessage>("tg_forward_message", {
    input,
  });
}

export async function tgSendSticker(
  chatId: string,
  sourceMessageId: string,
): Promise<TgMessage> {
  return invoke<TgMessage>("tg_send_sticker", {
    chatId,
    sourceMessageId,
  });
}

export async function tgSendStickerByRef(
  chatId: string,
  sticker: TgStickerRefInput,
): Promise<TgMessage> {
  return invoke<TgMessage>("tg_send_sticker_by_ref", {
    chatId,
    sticker,
  });
}

export async function tgAddStickerSet(shortName: string): Promise<string> {
  return invoke<string>("tg_add_sticker_set", {
    shortName,
  });
}

export async function tgListStickerLibrary(
  setLimit = 120,
  stickersPerSet = 200,
): Promise<TgStickerLibrary> {
  return invoke<TgStickerLibrary>("tg_list_sticker_library", {
    setLimit,
    stickersPerSet,
  });
}
