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
  mePhone?: string;
  error?: string;
};

export type TgDialog = {
  id: string;
  telegramChatId: string;
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
};

export type TgMessage = {
  id: string;
  chatId: string;
  from: "me" | "peer";
  text: string;
  at: string;
  status?: "sending" | "sent" | "failed";
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

export async function tgListMessages(
  chatId: string,
  limit = 80,
): Promise<TgMessage[]> {
  return invoke<TgMessage[]>("tg_list_messages", {
    chatId,
    limit,
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
