use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use grammers_client::client::{LoginToken, PasswordToken, UpdatesConfiguration};
use grammers_client::media::{Document, Media};
use grammers_client::message::{InputMessage, Message};
use grammers_client::peer::{Peer, User};
use grammers_client::sender::{ConnectionParams, SenderPoolHandle};
use grammers_client::session::storages::SqliteSession;
use grammers_client::session::types::{PeerAuth, PeerId, PeerRef};
use grammers_client::update::Update;
use grammers_client::{tl, Client, SenderPool, SignInError};
use grammers_session::updates::UpdatesLike;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc::UnboundedReceiver, Mutex};
use tokio::task::JoinHandle;
use base64::Engine;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyMeta {
    proxy_base_url: String,
    has_api_key: bool,
    timeout_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSetupInput {
    api_id: i64,
    api_hash: String,
    phone_number: Option<String>,
    socks5_host: String,
    socks5_port: u16,
    socks5_username: Option<String>,
    socks5_password: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    setup_completed: bool,
    has_session_blob: bool,
    api_id: Option<i64>,
    phone_number: Option<String>,
    socks5_host: Option<String>,
    socks5_port: Option<u16>,
    socks5_username: Option<String>,
    updated_at_epoch: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredSession {
    api_id: i64,
    api_hash: String,
    phone_number: Option<String>,
    socks5_host: String,
    socks5_port: u16,
    socks5_username: Option<String>,
    socks5_password: Option<String>,
    session_blob: Option<String>,
    setup_completed: bool,
    updated_at_epoch: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgAuthState {
    setup_completed: bool,
    connected: bool,
    authorized: bool,
    login_state: String,
    phone_number: Option<String>,
    me_display_name: Option<String>,
    me_username: Option<String>,
    me_phone: Option<String>,
    me_avatar_path: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgDialog {
    id: String,
    telegram_chat_id: String,
    avatar_path: Option<String>,
    title: String,
    subtitle: String,
    kind: String,
    verified: bool,
    online: bool,
    pinned: bool,
    muted: bool,
    unread: u32,
    last_preview: String,
    last_seen: String,
    top_message_id: String,
    read_inbox_max_id: String,
    read_outbox_max_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgMessage {
    id: String,
    chat_id: String,
    from: String,
    sender_name: Option<String>,
    text: String,
    at: String,
    status: Option<String>,
    media: Option<TgMediaAttachment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgMediaAttachment {
    kind: String,
    path: Option<String>,
    mime_type: Option<String>,
    file_name: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
    duration_sec: Option<f64>,
    size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgStickerItem {
    document_id: String,
    access_hash: String,
    file_reference_b64: String,
    emoji: Option<String>,
    set_title: Option<String>,
    set_short_name: Option<String>,
    path: Option<String>,
    mime_type: Option<String>,
    file_name: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
    duration_sec: Option<f64>,
    size_bytes: Option<u64>,
    animated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgStickerPack {
    id: String,
    title: String,
    short_name: String,
    stickers: Vec<TgStickerItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgStickerLibrary {
    recent: Vec<TgStickerItem>,
    favorite: Vec<TgStickerItem>,
    packs: Vec<TgStickerPack>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgStoryPeer {
    id: String,
    chat_id: String,
    avatar_path: Option<String>,
    title: String,
    unread_count: u32,
    story_count: u32,
    last_caption: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgStoryItem {
    id: String,
    chat_id: String,
    caption: String,
    at: String,
    viewed: bool,
    media: Option<TgMediaAttachment>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TgStickerRefInput {
    document_id: String,
    access_hash: String,
    file_reference_b64: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TgPhotoUploadInput {
    base64_data: String,
    mime_type: Option<String>,
    file_name: Option<String>,
    caption: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TgForwardMessageInput {
    source_chat_id: String,
    message_id: String,
    target_chat_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TgLiveEvent {
    kind: String,
    chat_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RuntimeFingerprint {
    api_id: i64,
    api_hash: String,
    socks5_host: String,
    socks5_port: u16,
    socks5_username: Option<String>,
    socks5_password: Option<String>,
    session_db_path: PathBuf,
}

struct TelegramRuntime {
    fingerprint: Option<RuntimeFingerprint>,
    client: Option<Client>,
    pool_handle: Option<SenderPoolHandle>,
    runner_task: Option<JoinHandle<()>>,
    updates: Option<UnboundedReceiver<UpdatesLike>>,
    updates_task: Option<JoinHandle<()>>,
    login_token: Option<LoginToken>,
    password_token: Option<PasswordToken>,
    peer_refs: HashMap<i64, PeerRef>,
}

impl Default for TelegramRuntime {
    fn default() -> Self {
        Self {
            fingerprint: None,
            client: None,
            pool_handle: None,
            runner_task: None,
            updates: None,
            updates_task: None,
            login_token: None,
            password_token: None,
            peer_refs: HashMap::new(),
        }
    }
}

static TG_RUNTIME: Lazy<Mutex<TelegramRuntime>> =
    Lazy::new(|| Mutex::new(TelegramRuntime::default()));

const LOGIN_STATE_NEED_PHONE: &str = "needPhone";
const LOGIN_STATE_AWAITING_CODE: &str = "awaitingCode";
const LOGIN_STATE_AWAITING_PASSWORD: &str = "awaitingPassword";
const LOGIN_STATE_AUTHORIZED: &str = "authorized";
const DEFAULT_DIALOG_LIMIT: u32 = 60;
const DEFAULT_STORY_LIMIT: u32 = 24;
const DEFAULT_MESSAGE_LIMIT: u32 = 40;
const MAX_INLINE_MEDIA_DOWNLOAD_BYTES: u64 = 768 * 1024;
const DEFAULT_STICKER_SET_LIMIT: u32 = 120;
const DEFAULT_STICKERS_PER_SET: u32 = 200;

#[tauri::command]
pub async fn proxy_meta(app: AppHandle) -> Result<ProxyMeta, String> {
    let path = session_file_path(&app)?;
    let stored = read_stored_session(&path)?;

    let proxy_base_url = match stored {
        Some(saved) if saved.setup_completed => {
            if let Some(username) = saved.socks5_username {
                format!(
                    "socks5://{}:***@{}:{}",
                    username, saved.socks5_host, saved.socks5_port
                )
            } else {
                format!("socks5://{}:{}", saved.socks5_host, saved.socks5_port)
            }
        }
        _ => "not-configured".to_string(),
    };

    Ok(ProxyMeta {
        proxy_base_url,
        has_api_key: false,
        timeout_ms: 15_000,
    })
}

#[tauri::command]
pub async fn healthcheck(app: AppHandle) -> Result<Value, String> {
    let status = tg_bootstrap(app).await?;

    Ok(json!({
        "ok": status.connected,
        "setupCompleted": status.setup_completed,
        "authorized": status.authorized,
        "loginState": status.login_state,
        "error": status.error,
    }))
}

#[tauri::command]
pub async fn invoke_telegram(_method: String, _payload: Value) -> Result<Value, String> {
    Err("invoke_telegram is disabled in MTProto mode; use tg_* commands".to_string())
}

#[tauri::command]
pub fn get_session_state(app: AppHandle) -> Result<SessionState, String> {
    let path = session_file_path(&app)?;
    let record = read_stored_session(&path)?;

    Ok(match record {
        Some(saved) => to_session_state(&saved),
        None => SessionState {
            setup_completed: false,
            has_session_blob: false,
            api_id: None,
            phone_number: None,
            socks5_host: None,
            socks5_port: None,
            socks5_username: None,
            updated_at_epoch: None,
        },
    })
}

#[tauri::command]
pub fn save_session_setup(
    app: AppHandle,
    input: SessionSetupInput,
) -> Result<SessionState, String> {
    validate_setup_input(&input)?;

    let path = session_file_path(&app)?;
    let previous = read_stored_session(&path)?.unwrap_or_default();

    let next = StoredSession {
        api_id: input.api_id,
        api_hash: input.api_hash.trim().to_string(),
        phone_number: input.phone_number.and_then(normalize_optional),
        socks5_host: input.socks5_host.trim().to_string(),
        socks5_port: input.socks5_port,
        socks5_username: input.socks5_username.and_then(normalize_optional),
        socks5_password: input.socks5_password.and_then(normalize_optional),
        session_blob: previous.session_blob,
        setup_completed: true,
        updated_at_epoch: now_epoch(),
    };

    write_stored_session(&path, &next)?;

    Ok(to_session_state(&next))
}

#[tauri::command]
pub fn mark_session_ready(
    app: AppHandle,
    session_blob: Option<String>,
) -> Result<SessionState, String> {
    let path = session_file_path(&app)?;
    let mut saved = read_stored_session(&path)?
        .ok_or_else(|| "session setup is missing; run save_session_setup first".to_string())?;

    saved.session_blob = session_blob.and_then(normalize_optional);
    saved.updated_at_epoch = now_epoch();

    write_stored_session(&path, &saved)?;

    Ok(to_session_state(&saved))
}

#[tauri::command]
pub async fn clear_session_setup(app: AppHandle) -> Result<(), String> {
    let path = session_file_path(&app)?;
    remove_file_if_exists(&path)?;

    let tg_path = telegram_session_db_path(&app)?;
    remove_file_if_exists(&tg_path)?;
    remove_file_if_exists(&tg_path.with_extension("sqlite-shm"))?;
    remove_file_if_exists(&tg_path.with_extension("sqlite-wal"))?;

    reset_runtime().await;

    Ok(())
}

#[tauri::command]
pub async fn tg_bootstrap(app: AppHandle) -> Result<TgAuthState, String> {
    let path = session_file_path(&app)?;
    let saved = match read_stored_session(&path)? {
        Some(saved) if saved.setup_completed => saved,
        _ => {
            return Ok(TgAuthState {
                setup_completed: false,
                connected: false,
                authorized: false,
                login_state: LOGIN_STATE_NEED_PHONE.to_string(),
                phone_number: None,
                me_display_name: None,
                me_username: None,
                me_phone: None,
                me_avatar_path: None,
                error: None,
            });
        }
    };

    let client = match ensure_connected_client(&app).await {
        Ok((client, _)) => client,
        Err(error) => {
            return Ok(TgAuthState {
                setup_completed: true,
                connected: false,
                authorized: false,
                login_state: LOGIN_STATE_NEED_PHONE.to_string(),
                phone_number: saved.phone_number,
                me_display_name: None,
                me_username: None,
                me_phone: None,
                me_avatar_path: None,
                error: Some(error),
            });
        }
    };

    let authorized = match client.is_authorized().await {
        Ok(value) => value,
        Err(error) => {
            return Ok(TgAuthState {
                setup_completed: true,
                connected: true,
                authorized: false,
                login_state: LOGIN_STATE_NEED_PHONE.to_string(),
                phone_number: saved.phone_number,
                me_display_name: None,
                me_username: None,
                me_phone: None,
                me_avatar_path: None,
                error: Some(format!("failed to verify authorization: {error}")),
            });
        }
    };

    if !authorized {
        let login_state = {
            let runtime = TG_RUNTIME.lock().await;
            current_login_state(&runtime).to_string()
        };

        return Ok(TgAuthState {
            setup_completed: true,
            connected: true,
            authorized: false,
            login_state,
            phone_number: saved.phone_number,
            me_display_name: None,
            me_username: None,
            me_phone: None,
            me_avatar_path: None,
            error: None,
        });
    }

    mark_authorized_marker(&app)?;

    let (me_display_name, me_username, me_phone, me_avatar_path) = match client.get_me().await {
        Ok(me) => {
            let me_peer = Peer::User(me.clone());
            let me_peer_id = me.id().bot_api_dialog_id();
            let avatar_path = cached_avatar_path(&app, me_peer_id);
            if avatar_path.is_none() {
                let app_handle = app.clone();
                let client_handle = client.clone();
                let peer_copy = me_peer.clone();
                tokio::spawn(async move {
                    let _ =
                        ensure_peer_avatar_path(&app_handle, &client_handle, &peer_copy, me_peer_id)
                            .await;
                });
            }

            (
                Some(user_display_name(&me)),
                me.username().map(|value| value.to_string()),
                me.phone().map(|value| value.to_string()),
                avatar_path,
            )
        }
        Err(_) => (None, None, None, None),
    };

    {
        let mut runtime = TG_RUNTIME.lock().await;
        runtime.login_token = None;
        runtime.password_token = None;
    }

    Ok(TgAuthState {
        setup_completed: true,
        connected: true,
        authorized: true,
        login_state: LOGIN_STATE_AUTHORIZED.to_string(),
        phone_number: saved.phone_number,
        me_display_name,
        me_username,
        me_phone,
        me_avatar_path,
        error: None,
    })
}

#[tauri::command]
pub async fn tg_request_code(app: AppHandle, phone_number: String) -> Result<TgAuthState, String> {
    let phone = phone_number.trim().to_string();
    if phone.is_empty() {
        return Err("phoneNumber is required".to_string());
    }

    let (client, saved) = ensure_connected_client(&app).await?;

    if client
        .is_authorized()
        .await
        .map_err(|e| format!("failed to verify authorization: {e}"))?
    {
        return tg_bootstrap(app).await;
    }

    let token = client
        .request_login_code(&phone, &saved.api_hash)
        .await
        .map_err(|e| format!("failed to request login code: {e}"))?;

    {
        let mut runtime = TG_RUNTIME.lock().await;
        runtime.login_token = Some(token);
        runtime.password_token = None;
    }

    save_phone_number(&app, &phone)?;

    Ok(TgAuthState {
        setup_completed: true,
        connected: true,
        authorized: false,
        login_state: LOGIN_STATE_AWAITING_CODE.to_string(),
        phone_number: Some(phone),
        me_display_name: None,
        me_username: None,
        me_phone: None,
        me_avatar_path: None,
        error: None,
    })
}

#[tauri::command]
pub async fn tg_sign_in_code(app: AppHandle, code: String) -> Result<TgAuthState, String> {
    let code = code.trim().to_string();
    if code.is_empty() {
        return Err("code is required".to_string());
    }

    let (client, saved) = ensure_connected_client(&app).await?;

    let token = {
        let mut runtime = TG_RUNTIME.lock().await;
        runtime
            .login_token
            .take()
            .ok_or_else(|| "no pending login code; call tg_request_code first".to_string())?
    };

    match client.sign_in(&token, &code).await {
        Ok(_) => {
            {
                let mut runtime = TG_RUNTIME.lock().await;
                runtime.login_token = None;
                runtime.password_token = None;
            }
            mark_authorized_marker(&app)?;
            tg_bootstrap(app).await
        }
        Err(SignInError::PasswordRequired(password_token)) => {
            let mut runtime = TG_RUNTIME.lock().await;
            runtime.password_token = Some(password_token);
            runtime.login_token = None;

            Ok(TgAuthState {
                setup_completed: true,
                connected: true,
                authorized: false,
                login_state: LOGIN_STATE_AWAITING_PASSWORD.to_string(),
                phone_number: saved.phone_number,
                me_display_name: None,
                me_username: None,
                me_phone: None,
                me_avatar_path: None,
                error: None,
            })
        }
        Err(SignInError::InvalidCode) => {
            let mut runtime = TG_RUNTIME.lock().await;
            runtime.login_token = Some(token);
            Err("invalid login code".to_string())
        }
        Err(SignInError::SignUpRequired) => {
            let mut runtime = TG_RUNTIME.lock().await;
            runtime.login_token = Some(token);
            Err(
                "this phone number must be registered in the official Telegram app first"
                    .to_string(),
            )
        }
        Err(SignInError::Other(error)) => {
            let mut runtime = TG_RUNTIME.lock().await;
            runtime.login_token = Some(token);
            Err(format!("failed to sign in: {error}"))
        }
        Err(SignInError::InvalidPassword(_)) => Err("unexpected auth state".to_string()),
    }
}

#[tauri::command]
pub async fn tg_check_password(app: AppHandle, password: String) -> Result<TgAuthState, String> {
    if password.trim().is_empty() {
        return Err("password is required".to_string());
    }

    let (client, _saved) = ensure_connected_client(&app).await?;

    let password_token = {
        let mut runtime = TG_RUNTIME.lock().await;
        runtime
            .password_token
            .take()
            .ok_or_else(|| "no pending 2FA challenge; call tg_sign_in_code first".to_string())?
    };

    match client.check_password(password_token, password).await {
        Ok(_) => {
            {
                let mut runtime = TG_RUNTIME.lock().await;
                runtime.login_token = None;
                runtime.password_token = None;
            }
            mark_authorized_marker(&app)?;
            tg_bootstrap(app).await
        }
        Err(SignInError::InvalidPassword(token)) => {
            let mut runtime = TG_RUNTIME.lock().await;
            runtime.password_token = Some(token);
            Err("invalid 2FA password".to_string())
        }
        Err(error) => Err(format!("failed to check password: {error}")),
    }
}

#[tauri::command]
pub async fn tg_list_dialogs(app: AppHandle, limit: Option<u32>) -> Result<Vec<TgDialog>, String> {
    let client = ensure_authorized_client(&app).await?;

    let clamped_limit = limit.unwrap_or(DEFAULT_DIALOG_LIMIT).clamp(1, 200) as usize;
    let mut iter = client.iter_dialogs().limit(clamped_limit);

    let mut dialogs = Vec::new();
    let mut peer_refs = HashMap::new();

    while let Some(dialog) = iter
        .next()
        .await
        .map_err(|e| format!("failed to fetch dialogs: {e}"))?
    {
        let peer = dialog.peer().clone();
        let peer_id = peer.id().bot_api_dialog_id();
        peer_refs.insert(peer_id, dialog.peer_ref());
        let avatar_path = cached_avatar_path(&app, peer_id);
        if avatar_path.is_none() {
            let app_handle = app.clone();
            let client_handle = client.clone();
            let peer_copy = peer.clone();
            tokio::spawn(async move {
                let _ = ensure_peer_avatar_path(&app_handle, &client_handle, &peer_copy, peer_id).await;
            });
        }

        let title = peer_title(&peer, peer_id);
        let (kind, subtitle, verified, online) = peer_meta(&peer);
        let (pinned, muted, unread, top_message_id, read_inbox_max_id, read_outbox_max_id) =
            dialog_state(&dialog.raw);

        let (last_preview, last_seen) = if let Some(message) = dialog.last_message.as_ref() {
            (dialog_message_preview(message, &peer), message_time(message))
        } else {
            (String::new(), String::new())
        };

        dialogs.push(TgDialog {
            id: peer_id.to_string(),
            telegram_chat_id: peer_id.to_string(),
            avatar_path,
            title,
            subtitle,
            kind,
            verified,
            online,
            pinned,
            muted,
            unread,
            last_preview,
            last_seen,
            top_message_id: top_message_id.to_string(),
            read_inbox_max_id: read_inbox_max_id.to_string(),
            read_outbox_max_id: read_outbox_max_id.to_string(),
        });
    }

    {
        let mut runtime = TG_RUNTIME.lock().await;
        runtime.peer_refs = peer_refs;
    }

    Ok(dialogs)
}

#[tauri::command]
pub async fn tg_list_stories(
    app: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<TgStoryPeer>, String> {
    let client = ensure_authorized_client(&app).await?;
    let clamped_limit = limit.unwrap_or(DEFAULT_STORY_LIMIT).clamp(1, 100) as usize;

    let result = client
        .invoke(&tl::functions::stories::GetAllStories {
            next: false,
            hidden: false,
            state: None,
        })
        .await
        .map_err(|e| format!("failed to fetch stories: {e}"))?;

    let data = match result {
        tl::enums::stories::AllStories::Stories(data) => data,
        tl::enums::stories::AllStories::NotModified(_) => return Ok(Vec::new()),
    };

    let user_map = data
        .users
        .into_iter()
        .filter_map(|user| raw_user_id(&user).map(|id| (id, user)))
        .collect::<HashMap<_, _>>();
    let chat_map = data
        .chats
        .into_iter()
        .map(|chat| (raw_chat_id(&chat), chat))
        .collect::<HashMap<_, _>>();

    let mut story_rows = Vec::new();
    let mut peer_refs = HashMap::new();

    for peer_story in data.peer_stories.into_iter().take(clamped_limit) {
        let peer_story: tl::types::PeerStories = peer_story.into();
        let Some(peer) = story_peer_to_peer(&client, &peer_story.peer, &user_map, &chat_map) else {
            continue;
        };

        let dialog_id = peer.id().bot_api_dialog_id();
        let story_count = peer_story
            .stories
            .iter()
            .filter(|story| !matches!(story, tl::enums::StoryItem::Deleted(_)))
            .count() as u32;
        if story_count == 0 {
            continue;
        }

        let max_read_id = peer_story.max_read_id.unwrap_or(0);
        let unread_count = peer_story
            .stories
            .iter()
            .filter(|story| !matches!(story, tl::enums::StoryItem::Deleted(_)))
            .filter(|story| story.id() > max_read_id)
            .count() as u32;

        if let Some(peer_ref) = peer.to_ref().await {
            peer_refs.insert(dialog_id, peer_ref);
        }

        let avatar_path = cached_avatar_path(&app, dialog_id);
        if avatar_path.is_none() {
            let app_handle = app.clone();
            let client_handle = client.clone();
            let peer_copy = peer.clone();
            tokio::spawn(async move {
                let _ =
                    ensure_peer_avatar_path(&app_handle, &client_handle, &peer_copy, dialog_id).await;
            });
        }

        story_rows.push(TgStoryPeer {
            id: dialog_id.to_string(),
            chat_id: dialog_id.to_string(),
            avatar_path,
            title: peer_title(&peer, dialog_id),
            unread_count,
            story_count,
            last_caption: latest_story_caption(&peer_story.stories),
        });
    }

    if !peer_refs.is_empty() {
        let mut runtime = TG_RUNTIME.lock().await;
        runtime.peer_refs.extend(peer_refs);
    }

    Ok(story_rows)
}

#[tauri::command]
pub async fn tg_get_peer_stories(
    app: AppHandle,
    chat_id: String,
) -> Result<Vec<TgStoryItem>, String> {
    let client = ensure_authorized_client(&app).await?;
    let peer_ref = resolve_peer_ref_for_chat(&chat_id).await?;

    let result = client
        .invoke(&tl::functions::stories::GetPeerStories {
            peer: peer_ref.into(),
        })
        .await
        .map_err(|e| format!("failed to fetch peer stories: {e}"))?;

    let data: tl::types::stories::PeerStories = match result {
        tl::enums::stories::PeerStories::Stories(data) => data,
    };
    let peer_stories: tl::types::PeerStories = data.stories.into();
    let max_read_id = peer_stories.max_read_id.unwrap_or(0);

    let mut items = Vec::new();
    for story in peer_stories.stories {
        let tl::enums::StoryItem::Item(item) = story else {
            continue;
        };

        items.push(TgStoryItem {
            id: item.id.to_string(),
            chat_id: chat_id.clone(),
            caption: item.caption.unwrap_or_default(),
            at: relative_story_time(item.date),
            viewed: item.id <= max_read_id,
            media: extract_story_media(&app, &client, &chat_id, item.id, &item.media).await,
        });
    }

    items.sort_by_key(|item| item.id.parse::<i32>().unwrap_or_default());
    Ok(items)
}

#[tauri::command]
pub async fn tg_list_messages(
    app: AppHandle,
    chat_id: String,
    limit: Option<u32>,
    before_message_id: Option<String>,
) -> Result<Vec<TgMessage>, String> {
    let client = ensure_authorized_client(&app).await?;
    let peer_ref = resolve_peer_ref_for_chat(&chat_id).await?;

    let clamped_limit = limit.unwrap_or(DEFAULT_MESSAGE_LIMIT).clamp(1, 300) as usize;
    let mut iter = client.iter_messages(peer_ref).limit(clamped_limit);
    if let Some(raw_id) = before_message_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let offset_id = parse_message_id(raw_id, "beforeMessageId")?;
        iter = iter.offset_id(offset_id);
    }

    let mut messages = Vec::new();

    while let Some(message) = iter
        .next()
        .await
        .map_err(|e| format!("failed to fetch messages: {e}"))?
    {
        messages.push(to_ui_message(&app, &client, &chat_id, &message).await);
    }

    messages.reverse();
    Ok(messages)
}

#[tauri::command]
pub async fn tg_send_sticker(
    app: AppHandle,
    chat_id: String,
    source_message_id: String,
) -> Result<TgMessage, String> {
    let client = ensure_authorized_client(&app).await?;
    let peer_ref = resolve_peer_ref_for_chat(&chat_id).await?;
    let source_id = parse_message_id(source_message_id.trim(), "sourceMessageId")?;

    let source = client
        .get_messages_by_id(peer_ref, &[source_id])
        .await
        .map_err(|e| format!("failed to load source sticker message: {e}"))?
        .into_iter()
        .next()
        .flatten()
        .ok_or_else(|| format!("source message {source_id} was not found"))?;

    let sticker_document = match source.media() {
        Some(Media::Sticker(sticker)) => sticker.document,
        _ => {
            return Err(
                "source message is not a sticker; choose a message with sticker media".to_string(),
            )
        }
    };

    let sent = client
        .send_message(
            peer_ref,
            InputMessage::new()
                .text("")
                .media(sticker_document.to_raw_input_media()),
        )
        .await
        .map_err(|e| format!("failed to send sticker: {e}"))?;

    Ok(to_ui_message(&app, &client, &chat_id, &sent).await)
}

#[tauri::command]
pub async fn tg_send_sticker_by_ref(
    app: AppHandle,
    chat_id: String,
    sticker: TgStickerRefInput,
) -> Result<TgMessage, String> {
    let client = ensure_authorized_client(&app).await?;
    let peer_ref = resolve_peer_ref_for_chat(&chat_id).await?;

    let document_id = sticker
        .document_id
        .trim()
        .parse::<i64>()
        .map_err(|_| "sticker.documentId must be a valid 64-bit id".to_string())?;
    let access_hash = sticker
        .access_hash
        .trim()
        .parse::<i64>()
        .map_err(|_| "sticker.accessHash must be a valid 64-bit id".to_string())?;
    let file_reference = base64::engine::general_purpose::STANDARD
        .decode(sticker.file_reference_b64.trim())
        .map_err(|e| format!("failed to decode sticker file reference: {e}"))?;

    let media = tl::types::InputMediaDocument {
        spoiler: false,
        id: tl::types::InputDocument {
            id: document_id,
            access_hash,
            file_reference,
        }
        .into(),
        video_cover: None,
        video_timestamp: None,
        ttl_seconds: None,
        query: None,
    };

    let sent = client
        .send_message(peer_ref, InputMessage::new().text("").media(media))
        .await
        .map_err(|e| format!("failed to send sticker: {e}"))?;

    Ok(to_ui_message(&app, &client, &chat_id, &sent).await)
}

#[tauri::command]
pub async fn tg_add_sticker_set(app: AppHandle, short_name: String) -> Result<String, String> {
    let client = ensure_authorized_client(&app).await?;

    let normalized = short_name.trim();
    if normalized.is_empty() {
        return Err("shortName is empty".to_string());
    }

    let result = client
        .invoke(&tl::functions::messages::InstallStickerSet {
            stickerset: tl::types::InputStickerSetShortName {
                short_name: normalized.to_string(),
            }
            .into(),
            archived: false,
        })
        .await
        .map_err(|e| format!("failed to add sticker set '{normalized}': {e}"))?;

    let status = match result {
        tl::enums::messages::StickerSetInstallResult::Success => {
            format!("sticker set '{normalized}' installed")
        }
        tl::enums::messages::StickerSetInstallResult::Archive(archive) => {
            format!(
                "sticker set '{normalized}' installed; {} old sets archived",
                archive.sets.len()
            )
        }
    };

    Ok(status)
}

#[tauri::command]
pub async fn tg_list_sticker_library(
    app: AppHandle,
    set_limit: Option<u32>,
    stickers_per_set: Option<u32>,
) -> Result<TgStickerLibrary, String> {
    let client = ensure_authorized_client(&app).await?;
    let clamped_set_limit = set_limit
        .unwrap_or(DEFAULT_STICKER_SET_LIMIT)
        .clamp(1, 400) as usize;
    let clamped_sticker_limit = stickers_per_set
        .unwrap_or(DEFAULT_STICKERS_PER_SET)
        .clamp(1, 400) as usize;

    let recent_result = client
        .invoke(&tl::functions::messages::GetRecentStickers {
            attached: false,
            hash: 0,
        })
        .await
        .map_err(|e| format!("failed to fetch recent stickers: {e}"))?;

    let favorite_result = client
        .invoke(&tl::functions::messages::GetFavedStickers { hash: 0 })
        .await
        .map_err(|e| format!("failed to fetch favorite stickers: {e}"))?;

    let all_sets_result = client
        .invoke(&tl::functions::messages::GetAllStickers { hash: 0 })
        .await
        .map_err(|e| format!("failed to fetch sticker sets: {e}"))?;

    let mut recent = Vec::new();
    let mut favorite = Vec::new();
    let mut packs = Vec::new();

    if let tl::enums::messages::RecentStickers::Stickers(data) = recent_result {
        for document in data
            .stickers
            .into_iter()
            .filter_map(tl_document_from_enum)
            .take(clamped_sticker_limit)
        {
            recent.push(tl_document_to_sticker_item(
                &app,
                &client,
                &document,
                None,
                None,
            ));
        }
    }

    if let tl::enums::messages::FavedStickers::Stickers(data) = favorite_result {
        for document in data
            .stickers
            .into_iter()
            .filter_map(tl_document_from_enum)
            .take(clamped_sticker_limit)
        {
            favorite.push(tl_document_to_sticker_item(
                &app,
                &client,
                &document,
                None,
                None,
            ));
        }
    }

    if let tl::enums::messages::AllStickers::Stickers(data) = all_sets_result {
        let mut seen_set_ids = HashSet::new();

        for set_entry in data.sets.into_iter().take(clamped_set_limit) {
            let set = match set_entry {
                tl::enums::StickerSet::Set(set) => set,
            };

            if !seen_set_ids.insert(set.id) {
                continue;
            }

            let short_name = set.short_name.clone();
            let title = set.title.clone();

            let pack_result = client
                .invoke(&tl::functions::messages::GetStickerSet {
                    stickerset: tl::types::InputStickerSetId {
                        id: set.id,
                        access_hash: set.access_hash,
                    }
                    .into(),
                    hash: 0,
                })
                .await;

            let stickers = match pack_result {
                Ok(tl::enums::messages::StickerSet::Set(full_pack)) => full_pack
                    .documents
                    .into_iter()
                    .filter_map(tl_document_from_enum)
                    .take(clamped_sticker_limit)
                    .map(|document| {
                        tl_document_to_sticker_item(
                            &app,
                            &client,
                            &document,
                            Some(&title),
                            Some(&short_name),
                        )
                    })
                    .collect::<Vec<_>>(),
                Ok(tl::enums::messages::StickerSet::NotModified) => Vec::new(),
                Err(_) => Vec::new(),
            };

            if stickers.is_empty() {
                continue;
            }

            packs.push(TgStickerPack {
                id: set.id.to_string(),
                title,
                short_name,
                stickers,
            });
        }
    }

    Ok(TgStickerLibrary {
        recent,
        favorite,
        packs,
    })
}

#[tauri::command]
pub async fn tg_send_message(
    app: AppHandle,
    chat_id: String,
    text: String,
) -> Result<TgMessage, String> {
    let content = text.trim().to_string();
    if content.is_empty() {
        return Err("text is empty".to_string());
    }

    let client = ensure_authorized_client(&app).await?;
    let peer_ref = resolve_peer_ref_for_chat(&chat_id).await?;

    let message = client
        .send_message(peer_ref, content)
        .await
        .map_err(|e| format!("failed to send message: {e}"))?;

    Ok(to_ui_message(&app, &client, &chat_id, &message).await)
}

#[tauri::command]
pub async fn tg_send_photo(
    app: AppHandle,
    chat_id: String,
    photo: TgPhotoUploadInput,
) -> Result<TgMessage, String> {
    let base64_data = photo.base64_data.trim();
    if base64_data.is_empty() {
        return Err("photo.base64Data is empty".to_string());
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("failed to decode photo bytes: {e}"))?;

    if bytes.is_empty() {
        return Err("photo payload is empty".to_string());
    }
    if bytes.len() > 15 * 1024 * 1024 {
        return Err("photo is too large for clipboard upload".to_string());
    }

    let mime_type = photo.mime_type.as_deref().map(str::trim);
    let file_name = photo.file_name.as_deref().map(str::trim);
    let ext = guess_file_extension(file_name, mime_type, "png");
    let is_image = matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "heic" | "heif"
    ) || mime_type.map(|value| value.starts_with("image/")).unwrap_or(false);
    if !is_image {
        return Err("only image clipboard attachments are supported".to_string());
    }

    let client = ensure_authorized_client(&app).await?;
    let peer_ref = resolve_peer_ref_for_chat(&chat_id).await?;
    let temp_path = composer_upload_path(
        &app,
        file_name
            .filter(|value| !value.is_empty())
            .unwrap_or("clipboard-image"),
        &ext,
    )?;

    fs::write(&temp_path, &bytes).map_err(|e| {
        format!(
            "failed to persist clipboard image '{}': {e}",
            temp_path.display()
        )
    })?;

    let caption = photo.caption.unwrap_or_default().trim().to_string();

    let upload_result = async {
        let uploaded = client
            .upload_file(&temp_path)
            .await
            .map_err(|e| format!("failed to upload image: {e}"))?;

        client
            .send_message(peer_ref, InputMessage::new().text(caption).photo(uploaded))
            .await
            .map_err(|e| format!("failed to send photo: {e}"))
    }
    .await;

    let _ = fs::remove_file(&temp_path);
    let message = upload_result?;

    Ok(to_ui_message(&app, &client, &chat_id, &message).await)
}

#[tauri::command]
pub async fn tg_mark_chat_read(app: AppHandle, chat_id: String) -> Result<(), String> {
    let client = ensure_authorized_client(&app).await?;
    let peer_ref = resolve_peer_ref_for_chat(&chat_id).await?;

    client
        .mark_as_read(peer_ref)
        .await
        .map_err(|e| format!("failed to mark chat as read: {e}"))?;

    let _ = client.clear_mentions(peer_ref).await;

    Ok(())
}

#[tauri::command]
pub async fn tg_mark_stories_read(
    app: AppHandle,
    chat_id: String,
    max_story_id: String,
) -> Result<(), String> {
    let client = ensure_authorized_client(&app).await?;
    let peer_ref = resolve_peer_ref_for_chat(&chat_id).await?;
    let max_id = parse_message_id(max_story_id.trim(), "maxStoryId")?;

    client
        .invoke(&tl::functions::stories::ReadStories {
            peer: peer_ref.into(),
            max_id,
        })
        .await
        .map_err(|e| format!("failed to mark stories as read: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn tg_forward_message(
    app: AppHandle,
    input: TgForwardMessageInput,
) -> Result<TgMessage, String> {
    let client = ensure_authorized_client(&app).await?;
    let source_peer = resolve_peer_ref_for_chat(&input.source_chat_id).await?;
    let target_peer = resolve_peer_ref_for_chat(&input.target_chat_id).await?;
    let message_id = parse_message_id(input.message_id.trim(), "messageId")?;

    let mut forwarded = client
        .forward_messages(target_peer, &[message_id], source_peer)
        .await
        .map_err(|e| format!("failed to forward message: {e}"))?;

    let message = forwarded
        .pop()
        .flatten()
        .ok_or_else(|| "telegram did not return a forwarded message".to_string())?;

    Ok(to_ui_message(&app, &client, &input.target_chat_id, &message).await)
}

fn tl_document_from_enum(raw: tl::enums::Document) -> Option<tl::types::Document> {
    match raw {
        tl::enums::Document::Document(document) => Some(document),
        tl::enums::Document::Empty(_) => None,
    }
}

fn tl_document_to_sticker_item(
    app: &AppHandle,
    client: &Client,
    document: &tl::types::Document,
    default_set_title: Option<&str>,
    default_set_short_name: Option<&str>,
) -> TgStickerItem {
    let mut emoji: Option<String> = None;
    let mut set_short_name = default_set_short_name.map(ToOwned::to_owned);
    let mut width: Option<i32> = None;
    let mut height: Option<i32> = None;
    let mut duration: Option<f64> = None;
    let mut animated = false;
    let mut file_name: Option<String> = None;

    for attribute in &document.attributes {
        match attribute {
            tl::enums::DocumentAttribute::Sticker(sticker) => {
                let value = sticker.alt.trim();
                if !value.is_empty() {
                    emoji = Some(value.to_string());
                }

                if set_short_name.is_none() {
                    if let tl::enums::InputStickerSet::ShortName(short_name) = &sticker.stickerset {
                        if !short_name.short_name.trim().is_empty() {
                            set_short_name = Some(short_name.short_name.trim().to_string());
                        }
                    }
                }
            }
            tl::enums::DocumentAttribute::ImageSize(size) => {
                width = Some(size.w);
                height = Some(size.h);
            }
            tl::enums::DocumentAttribute::Video(video) => {
                width = Some(video.w);
                height = Some(video.h);
                duration = Some(video.duration);
            }
            tl::enums::DocumentAttribute::Audio(audio) => {
                duration = Some(audio.duration.into());
            }
            tl::enums::DocumentAttribute::Filename(name) => {
                if !name.file_name.trim().is_empty() {
                    file_name = Some(name.file_name.trim().to_string());
                }
            }
            tl::enums::DocumentAttribute::Animated => {
                animated = true;
            }
            _ => {}
        }
    }

    let mime_type = (!document.mime_type.trim().is_empty()).then(|| document.mime_type.clone());
    let fallback_ext = if animated {
        "tgs"
    } else if mime_type
        .as_deref()
        .map(|value| value.contains("webm"))
        .unwrap_or(false)
    {
        "webm"
    } else {
        "webp"
    };
    let ext = guess_file_extension(file_name.as_deref(), mime_type.as_deref(), fallback_ext);

    let path = sticker_cache_path(app, set_short_name.as_deref(), document.id, &ext).ok();
    if let Some(path_value) = path.clone() {
        if !path_value.exists() {
            let client_handle = client.clone();
            let path_copy = path_value.clone();
            let document_copy = document.clone();
            tokio::spawn(async move {
                let downloadable = Document::from_raw_media(tl::types::MessageMediaDocument {
                    nopremium: false,
                    spoiler: false,
                    video: false,
                    round: false,
                    voice: false,
                    document: Some(tl::enums::Document::Document(document_copy)),
                    alt_documents: None,
                    video_cover: None,
                    video_timestamp: None,
                    ttl_seconds: None,
                });
                let _ = client_handle.download_media(&downloadable, &path_copy).await;
            });
        }
    }

    let cached_path = path
        .as_ref()
        .filter(|value| value.exists())
        .map(|value| value.to_string_lossy().to_string());

    TgStickerItem {
        document_id: document.id.to_string(),
        access_hash: document.access_hash.to_string(),
        file_reference_b64: base64::engine::general_purpose::STANDARD
            .encode(document.file_reference.as_slice()),
        emoji,
        set_title: default_set_title.map(ToOwned::to_owned),
        set_short_name,
        path: cached_path,
        mime_type,
        file_name,
        width,
        height,
        duration_sec: duration,
        size_bytes: (document.size > 0).then_some(document.size as u64),
        animated,
    }
}

fn safe_fs_component(raw: &str) -> String {
    raw.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
}

fn sticker_cache_path(
    app: &AppHandle,
    set_short_name: Option<&str>,
    document_id: i64,
    ext: &str,
) -> Result<PathBuf, String> {
    let set_name = set_short_name.unwrap_or("misc");
    let safe_set_name = safe_fs_component(set_name);
    let safe_ext = ext
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>();
    let fallback_ext = if safe_ext.is_empty() {
        "webp".to_string()
    } else {
        safe_ext
    };

    let dir = media_cache_root(app)?.join("stickers").join(safe_set_name);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create sticker cache '{}': {e}", dir.display()))?;

    Ok(dir.join(format!("{document_id}.{fallback_ext}")))
}

fn validate_setup_input(input: &SessionSetupInput) -> Result<(), String> {
    if input.api_id <= 0 {
        return Err("apiId must be a positive integer".to_string());
    }

    if input.api_hash.trim().len() < 8 {
        return Err("apiHash looks too short".to_string());
    }

    if input.socks5_host.trim().is_empty() {
        return Err("socks5Host is required".to_string());
    }

    if input.socks5_port == 0 {
        return Err("socks5Port must be greater than 0".to_string());
    }

    let has_password = input
        .socks5_password
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_some();

    let has_username = input
        .socks5_username
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_some();

    if has_password && !has_username {
        return Err("socks5Password requires socks5Username".to_string());
    }

    Ok(())
}

fn normalize_optional(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn raw_user_id(user: &tl::enums::User) -> Option<i64> {
    match user {
        tl::enums::User::User(value) => Some(value.id),
        tl::enums::User::Empty(value) => Some(value.id),
    }
}

fn raw_chat_id(chat: &tl::enums::Chat) -> i64 {
    match chat {
        tl::enums::Chat::Empty(value) => value.id,
        tl::enums::Chat::Chat(value) => value.id,
        tl::enums::Chat::Forbidden(value) => value.id,
        tl::enums::Chat::Channel(value) => value.id,
        tl::enums::Chat::ChannelForbidden(value) => value.id,
    }
}

fn story_peer_to_peer(
    client: &Client,
    raw_peer: &tl::enums::Peer,
    user_map: &HashMap<i64, tl::enums::User>,
    chat_map: &HashMap<i64, tl::enums::Chat>,
) -> Option<Peer> {
    match raw_peer {
        tl::enums::Peer::User(value) => user_map
            .get(&value.user_id)
            .cloned()
            .map(|user| Peer::User(User::from_raw(client, user))),
        tl::enums::Peer::Chat(value) => chat_map
            .get(&value.chat_id)
            .cloned()
            .map(|chat| Peer::from_raw(client, chat)),
        tl::enums::Peer::Channel(value) => chat_map
            .get(&value.channel_id)
            .cloned()
            .map(|chat| Peer::from_raw(client, chat)),
    }
}

fn latest_story_caption(stories: &[tl::enums::StoryItem]) -> Option<String> {
    stories.iter().rev().find_map(|story| match story {
        tl::enums::StoryItem::Item(item) => item
            .caption
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        _ => None,
    })
}

fn parse_message_id(raw: &str, field_name: &str) -> Result<i32, String> {
    raw.parse::<i32>()
        .map_err(|_| format!("{field_name} must be a valid message id"))
}

fn to_session_state(saved: &StoredSession) -> SessionState {
    SessionState {
        setup_completed: saved.setup_completed,
        has_session_blob: saved
            .session_blob
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .is_some(),
        api_id: Some(saved.api_id),
        phone_number: saved.phone_number.clone(),
        socks5_host: Some(saved.socks5_host.clone()),
        socks5_port: Some(saved.socks5_port),
        socks5_username: saved.socks5_username.clone(),
        updated_at_epoch: Some(saved.updated_at_epoch),
    }
}

fn now_epoch() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs(),
        Err(_) => 0,
    }
}

fn now_epoch_millis() -> u128 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis(),
        Err(_) => 0,
    }
}

fn relative_story_time(timestamp: i32) -> String {
    let now = now_epoch() as i64;
    let diff = (now - i64::from(timestamp)).max(0);

    if diff < 60 {
        "now".to_string()
    } else if diff < 3_600 {
        format!("{}m", diff / 60)
    } else if diff < 86_400 {
        format!("{}h", diff / 3_600)
    } else {
        format!("{}d", diff / 86_400)
    }
}

fn session_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))?;

    fs::create_dir_all(&config_dir).map_err(|e| {
        format!(
            "failed to create config dir '{}': {e}",
            config_dir.display()
        )
    })?;

    Ok(config_dir.join("proxytg-session.json"))
}

fn telegram_session_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))?;

    fs::create_dir_all(&config_dir).map_err(|e| {
        format!(
            "failed to create config dir '{}': {e}",
            config_dir.display()
        )
    })?;

    Ok(config_dir.join("telegram-session.sqlite"))
}

fn read_stored_session(path: &Path) -> Result<Option<StoredSession>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)
        .map_err(|e| format!("failed to read session file '{}': {e}", path.display()))?;

    let parsed = serde_json::from_str::<StoredSession>(&raw)
        .map_err(|e| format!("failed to parse session file '{}': {e}", path.display()))?;

    Ok(Some(parsed))
}

fn write_stored_session(path: &Path, value: &StoredSession) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value)
        .map_err(|e| format!("failed to serialize session data: {e}"))?;

    fs::write(path, raw)
        .map_err(|e| format!("failed to write session file '{}': {e}", path.display()))
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path)
            .map_err(|e| format!("failed to remove file '{}': {e}", path.display()))?;
    }

    Ok(())
}

fn save_phone_number(app: &AppHandle, phone_number: &str) -> Result<(), String> {
    let path = session_file_path(app)?;
    let mut saved = read_stored_session(&path)?
        .ok_or_else(|| "session setup is missing; run save_session_setup first".to_string())?;

    saved.phone_number = Some(phone_number.to_string());
    saved.updated_at_epoch = now_epoch();

    write_stored_session(&path, &saved)
}

fn mark_authorized_marker(app: &AppHandle) -> Result<(), String> {
    let path = session_file_path(app)?;
    let mut saved = match read_stored_session(&path)? {
        Some(saved) => saved,
        None => return Ok(()),
    };

    saved.setup_completed = true;
    saved.session_blob = Some("authorized".to_string());
    saved.updated_at_epoch = now_epoch();

    write_stored_session(&path, &saved)
}

fn build_proxy_url(saved: &StoredSession) -> String {
    match (&saved.socks5_username, &saved.socks5_password) {
        (Some(username), Some(password)) => format!(
            "socks5://{}:{}@{}:{}",
            username, password, saved.socks5_host, saved.socks5_port
        ),
        (Some(username), None) => format!(
            "socks5://{}@{}:{}",
            username, saved.socks5_host, saved.socks5_port
        ),
        _ => format!("socks5://{}:{}", saved.socks5_host, saved.socks5_port),
    }
}

fn runtime_fingerprint(saved: &StoredSession, session_db_path: PathBuf) -> RuntimeFingerprint {
    RuntimeFingerprint {
        api_id: saved.api_id,
        api_hash: saved.api_hash.clone(),
        socks5_host: saved.socks5_host.clone(),
        socks5_port: saved.socks5_port,
        socks5_username: saved.socks5_username.clone(),
        socks5_password: saved.socks5_password.clone(),
        session_db_path,
    }
}

async fn reset_runtime() {
    let mut runtime = TG_RUNTIME.lock().await;

    if let Some(pool_handle) = runtime.pool_handle.take() {
        pool_handle.quit();
    }

    if let Some(task) = runtime.runner_task.take() {
        task.abort();
    }

    if let Some(task) = runtime.updates_task.take() {
        task.abort();
    }

    runtime.fingerprint = None;
    runtime.client = None;
    runtime.updates = None;
    runtime.login_token = None;
    runtime.password_token = None;
    runtime.peer_refs.clear();
}

async fn ensure_connected_client(app: &AppHandle) -> Result<(Client, StoredSession), String> {
    let path = session_file_path(app)?;
    let saved = read_stored_session(&path)?
        .filter(|value| value.setup_completed)
        .ok_or_else(|| "session setup is missing; run first-launch setup".to_string())?;

    let api_id = i32::try_from(saved.api_id)
        .map_err(|_| "apiId is out of range for Telegram client".to_string())?;

    let session_db_path = telegram_session_db_path(app)?;
    let fingerprint = runtime_fingerprint(&saved, session_db_path.clone());

    {
        let runtime = TG_RUNTIME.lock().await;
        if runtime.fingerprint.as_ref() == Some(&fingerprint) {
            if let Some(client) = runtime.client.clone() {
                return Ok((client, saved));
            }
        }
    }

    let session = Arc::new(SqliteSession::open(&session_db_path).await.map_err(|e| {
        format!(
            "failed to open telegram session db '{}': {e}",
            session_db_path.display()
        )
    })?);

    let connection_params = ConnectionParams {
        app_version: format!("ProxyTG {}", env!("CARGO_PKG_VERSION")),
        proxy_url: Some(build_proxy_url(&saved)),
        ..Default::default()
    };

    let SenderPool {
        runner,
        updates,
        handle,
    } = SenderPool::with_configuration(Arc::clone(&session), api_id, connection_params);
    let pool_handle = handle.thin.clone();
    let client = Client::new(handle);
    let runner_task = tokio::spawn(runner.run());

    {
        let mut runtime = TG_RUNTIME.lock().await;

        if let Some(previous_handle) = runtime.pool_handle.take() {
            previous_handle.quit();
        }
        if let Some(previous_task) = runtime.runner_task.take() {
            previous_task.abort();
        }
        if let Some(previous_updates_task) = runtime.updates_task.take() {
            previous_updates_task.abort();
        }

        runtime.fingerprint = Some(fingerprint);
        runtime.client = Some(client.clone());
        runtime.pool_handle = Some(pool_handle);
        runtime.runner_task = Some(runner_task);
        runtime.updates = Some(updates);
        runtime.updates_task = None;
        runtime.login_token = None;
        runtime.password_token = None;
        runtime.peer_refs.clear();
    }

    Ok((client, saved))
}

async fn ensure_authorized_client(app: &AppHandle) -> Result<Client, String> {
    let (client, _) = ensure_connected_client(app).await?;

    let is_authorized = client
        .is_authorized()
        .await
        .map_err(|e| format!("failed to verify authorization: {e}"))?;

    if !is_authorized {
        return Err("telegram session is not authorized; complete login first".to_string());
    }

    ensure_live_updates(app, &client).await;

    Ok(client)
}

async fn ensure_live_updates(app: &AppHandle, client: &Client) {
    let updates = {
        let mut runtime = TG_RUNTIME.lock().await;
        if runtime.updates_task.is_some() {
            return;
        }
        runtime.updates.take()
    };

    let Some(updates) = updates else {
        return;
    };

    let client_handle = client.clone();
    let app_handle = app.clone();

    let task = tokio::spawn(async move {
        let mut stream = client_handle
            .stream_updates(
                updates,
                UpdatesConfiguration {
                    catch_up: true,
                    update_queue_limit: Some(400),
                },
            )
            .await;

        loop {
            let next = stream.next().await;
            let update = match next {
                Ok(update) => update,
                Err(_) => break,
            };

            let event = live_event_from_update(&update);
            let _ = app_handle.emit("tg-sync", event);
        }
    });

    let mut runtime = TG_RUNTIME.lock().await;
    if runtime.updates_task.is_none() {
        runtime.updates_task = Some(task);
    } else {
        task.abort();
    }
}

fn live_event_from_update(update: &Update) -> TgLiveEvent {
    match update {
        Update::NewMessage(message) | Update::MessageEdited(message) => TgLiveEvent {
            kind: "message".to_string(),
            chat_id: Some(message.peer_id().bot_api_dialog_id().to_string()),
        },
        Update::MessageDeleted(_) => TgLiveEvent {
            kind: "message".to_string(),
            chat_id: None,
        },
        Update::Raw(raw) => match &raw.raw {
            tl::enums::Update::ReadStories(value) => TgLiveEvent {
                kind: "story".to_string(),
                chat_id: dialog_id_from_peer(&value.peer).map(|id| id.to_string()),
            },
            tl::enums::Update::Story(value) => TgLiveEvent {
                kind: "story".to_string(),
                chat_id: dialog_id_from_peer(&value.peer).map(|id| id.to_string()),
            },
            tl::enums::Update::ReadHistoryInbox(value) => TgLiveEvent {
                kind: "read".to_string(),
                chat_id: dialog_id_from_peer(&value.peer).map(|id| id.to_string()),
            },
            tl::enums::Update::ReadHistoryOutbox(value) => TgLiveEvent {
                kind: "read".to_string(),
                chat_id: dialog_id_from_peer(&value.peer).map(|id| id.to_string()),
            },
            tl::enums::Update::ReadChannelInbox(value) => TgLiveEvent {
                kind: "read".to_string(),
                chat_id: PeerId::channel(value.channel_id)
                    .map(|peer_id| peer_id.bot_api_dialog_id().to_string()),
            },
            tl::enums::Update::ReadChannelOutbox(value) => TgLiveEvent {
                kind: "read".to_string(),
                chat_id: PeerId::channel(value.channel_id)
                    .map(|peer_id| peer_id.bot_api_dialog_id().to_string()),
            },
            _ => TgLiveEvent {
                kind: "sync".to_string(),
                chat_id: None,
            },
        },
        _ => TgLiveEvent {
            kind: "sync".to_string(),
            chat_id: None,
        },
    }
}

fn current_login_state(runtime: &TelegramRuntime) -> &'static str {
    if runtime.password_token.is_some() {
        LOGIN_STATE_AWAITING_PASSWORD
    } else if runtime.login_token.is_some() {
        LOGIN_STATE_AWAITING_CODE
    } else {
        LOGIN_STATE_NEED_PHONE
    }
}

fn user_display_name(user: &User) -> String {
    let full_name = user.full_name();
    let trimmed = full_name.trim();

    if !trimmed.is_empty() {
        return trimmed.to_string();
    }

    if let Some(username) = user.username() {
        if !username.trim().is_empty() {
            return format!("@{}", username);
        }
    }

    user.id().to_string()
}

fn peer_title(peer: &Peer, fallback_id: i64) -> String {
    let title = peer
        .name()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    title.unwrap_or_else(|| fallback_id.to_string())
}

fn peer_meta(peer: &Peer) -> (String, String, bool, bool) {
    match peer {
        Peer::User(user) => {
            let subtitle = user
                .username()
                .map(|value| format!("@{}", value))
                .or_else(|| user.phone().map(ToOwned::to_owned))
                .unwrap_or_else(|| {
                    if user.is_bot() {
                        "Bot".to_string()
                    } else {
                        "Private chat".to_string()
                    }
                });

            let online = format!("{:?}", user.status()).contains("Online");
            let kind = if user.is_bot() { "bot" } else { "private" };

            (kind.to_string(), subtitle, user.verified(), online)
        }
        Peer::Group(group) => {
            let subtitle = group
                .username()
                .map(|value| format!("@{}", value))
                .unwrap_or_else(|| "Group".to_string());
            ("group".to_string(), subtitle, false, false)
        }
        Peer::Channel(channel) => {
            let subtitle = channel
                .username()
                .map(|value| format!("@{}", value))
                .unwrap_or_else(|| "Channel".to_string());
            ("channel".to_string(), subtitle, false, false)
        }
    }
}

fn dialog_state(raw: &tl::enums::Dialog) -> (bool, bool, u32, i32, i32, i32) {
    match raw {
        tl::enums::Dialog::Dialog(dialog) => (
            dialog.pinned,
            dialog_notify_is_muted(&dialog.notify_settings),
            if dialog.unread_count > 0 {
                dialog.unread_count as u32
            } else if dialog.unread_mark {
                1
            } else {
                0
            },
            dialog.top_message,
            dialog.read_inbox_max_id,
            dialog.read_outbox_max_id,
        ),
        tl::enums::Dialog::Folder(dialog) => (
            dialog.pinned,
            false,
            (dialog.unread_muted_messages_count + dialog.unread_unmuted_messages_count)
                .max(0) as u32,
            dialog.top_message,
            0,
            0,
        ),
    }
}

fn dialog_notify_is_muted(settings: &tl::enums::PeerNotifySettings) -> bool {
    match settings {
        tl::enums::PeerNotifySettings::Settings(value) => {
            value.silent.unwrap_or(false)
                || value
                    .mute_until
                    .map(|until| i64::from(until) > now_epoch() as i64)
                    .unwrap_or(false)
        }
    }
}

fn message_preview(message: &Message) -> String {
    let text = message.text().trim();
    if text.is_empty() {
        if let Some(kind) = message_media_kind_hint(message) {
            return format!("<{}>", media_kind_preview_label(kind));
        }
        return "<media>".to_string();
    }

    let single_line = text.replace('\n', " ");
    let char_count = single_line.chars().count();
    if char_count <= 120 {
        single_line
    } else {
        let truncated: String = single_line.chars().take(120).collect();
        format!("{truncated}...")
    }
}

fn dialog_message_preview(message: &Message, peer: &Peer) -> String {
    let preview = message_preview(message);
    let sender = sender_name(message);

    match peer {
        Peer::User(_) | Peer::Channel(_) if message.outgoing() => {
            sender.map(|value| format!("{value}: {preview}")).unwrap_or(preview)
        }
        Peer::Group(_) | Peer::Channel(_) => {
            sender.map(|value| format!("{value}: {preview}")).unwrap_or(preview)
        }
        _ => preview,
    }
}

fn message_media_kind_hint(message: &Message) -> Option<&'static str> {
    let media = message.media()?;
    match media {
        Media::Photo(_) => Some("photo"),
        Media::Sticker(_) => Some("sticker"),
        Media::Document(document) => Some(media_kind_from_document(&document)),
        _ => Some("file"),
    }
}

fn media_kind_preview_label(kind: &str) -> &str {
    match kind {
        "voice" => "voice message",
        "photo" => "photo",
        "video" => "video",
        "gif" => "gif",
        "sticker" => "sticker",
        "audio" => "audio",
        _ => "file",
    }
}

fn message_time(message: &Message) -> String {
    message.date().format("%H:%M").to_string()
}

fn sender_name(message: &Message) -> Option<String> {
    if message.outgoing() {
        return Some("Вы".to_string());
    }

    let post_author = message
        .post_author()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    if post_author.is_some() {
        return post_author;
    }

    let sender = message.sender()?;
    match sender {
        Peer::User(user) => {
            let full_name = user.full_name().trim().to_string();
            if !full_name.is_empty() {
                Some(full_name)
            } else {
                user.username().map(|username| format!("@{username}"))
            }
        }
        _ => sender
            .name()
            .map(ToOwned::to_owned)
            .or_else(|| sender.username().map(|username| format!("@{username}"))),
    }
}

async fn to_ui_message(
    app: &AppHandle,
    client: &Client,
    chat_id: &str,
    message: &Message,
) -> TgMessage {
    let media = extract_message_media(app, client, chat_id, message).await;
    let text = {
        let value = message.text().trim();
        value.to_string()
    };

    let from = if message.outgoing() { "me" } else { "peer" };
    let status = if message.outgoing() {
        Some("sent".to_string())
    } else {
        None
    };
    TgMessage {
        id: message.id().to_string(),
        chat_id: chat_id.to_string(),
        from: from.to_string(),
        sender_name: sender_name(message),
        text,
        at: message_time(message),
        status,
        media,
    }
}

async fn ensure_peer_avatar_path(
    app: &AppHandle,
    client: &Client,
    peer: &Peer,
    peer_id: i64,
) -> Option<String> {
    let chat_photo = peer.photo(false).await?;
    let path = avatar_cache_path(app, peer_id).ok()?;

    if !path.exists() && client.download_media(&chat_photo, &path).await.is_err() {
        return None;
    }

    Some(path.to_string_lossy().to_string())
}

fn cached_avatar_path(app: &AppHandle, peer_id: i64) -> Option<String> {
    let path = avatar_cache_path(app, peer_id).ok()?;
    if path.exists() {
        Some(path.to_string_lossy().to_string())
    } else {
        None
    }
}

async fn extract_message_media(
    app: &AppHandle,
    client: &Client,
    chat_id: &str,
    message: &Message,
) -> Option<TgMediaAttachment> {
    let media = message.media()?;
    let message_id = message.id();

    match media {
        Media::Photo(photo) => {
            let path = message_media_cache_path(app, chat_id, message_id, "jpg").ok()?;
            let size_bytes = photo.size().map(|value| value as u64);
            if !path.exists() {
                if should_download_inline(size_bytes) {
                    if client.download_media(&photo, &path).await.is_err() {
                        return None;
                    }
                } else {
                    let client_handle = client.clone();
                    let photo_copy = photo.clone();
                    let path_copy = path.clone();
                    tokio::spawn(async move {
                        let _ = client_handle.download_media(&photo_copy, &path_copy).await;
                    });
                }
            }

            Some(TgMediaAttachment {
                kind: "photo".to_string(),
                path: path
                    .exists()
                    .then(|| path.to_string_lossy().to_string()),
                mime_type: Some("image/jpeg".to_string()),
                file_name: Some(format!("{message_id}.jpg")),
                width: None,
                height: None,
                duration_sec: None,
                size_bytes,
            })
        }
        Media::Sticker(sticker) => {
            let document = sticker.document;
            let mime = document.mime_type().map(ToOwned::to_owned);
            let ext = guess_file_extension(document.name(), mime.as_deref(), "webp");
            let path = message_media_cache_path(app, chat_id, message_id, &ext).ok()?;
            let size_bytes = document.size().map(|value| value as u64);
            if !path.exists() {
                if should_download_inline(size_bytes) {
                    if client.download_media(&document, &path).await.is_err() {
                        return None;
                    }
                } else {
                    let client_handle = client.clone();
                    let document_copy = document.clone();
                    let path_copy = path.clone();
                    tokio::spawn(async move {
                        let _ = client_handle.download_media(&document_copy, &path_copy).await;
                    });
                }
            }

            let (width, height) = document.resolution().unwrap_or((0, 0));
            Some(TgMediaAttachment {
                kind: "sticker".to_string(),
                path: path
                    .exists()
                    .then(|| path.to_string_lossy().to_string()),
                mime_type: mime,
                file_name: document.name().map(ToOwned::to_owned),
                width: (width > 0).then_some(width),
                height: (height > 0).then_some(height),
                duration_sec: document.duration(),
                size_bytes,
            })
        }
        Media::Document(document) => {
            let mime = document.mime_type().map(ToOwned::to_owned);
            let media_kind = media_kind_from_document(&document);
            let fallback_ext = match media_kind {
                "video" => "mp4",
                "voice" => "ogg",
                "audio" => "mp3",
                "photo" => "jpg",
                "gif" => "gif",
                _ => "bin",
            };

            let ext = guess_file_extension(document.name(), mime.as_deref(), fallback_ext);
            let path = message_media_cache_path(app, chat_id, message_id, &ext).ok()?;
            let size_bytes = document.size().map(|value| value as u64);
            if !path.exists() {
                if should_download_inline(size_bytes) {
                    if client.download_media(&document, &path).await.is_err() {
                        return None;
                    }
                } else {
                    let client_handle = client.clone();
                    let document_copy = document.clone();
                    let path_copy = path.clone();
                    tokio::spawn(async move {
                        let _ = client_handle.download_media(&document_copy, &path_copy).await;
                    });
                }
            }

            let (width, height) = document.resolution().unwrap_or((0, 0));

            Some(TgMediaAttachment {
                kind: media_kind.to_string(),
                path: path
                    .exists()
                    .then(|| path.to_string_lossy().to_string()),
                mime_type: mime,
                file_name: document.name().map(ToOwned::to_owned),
                width: (width > 0).then_some(width),
                height: (height > 0).then_some(height),
                duration_sec: document.duration(),
                size_bytes,
            })
        }
        _ => None,
    }
}

async fn extract_story_media(
    app: &AppHandle,
    client: &Client,
    chat_id: &str,
    story_id: i32,
    raw_media: &tl::enums::MessageMedia,
) -> Option<TgMediaAttachment> {
    let media = Media::from_raw(raw_media.clone())?;

    match media {
        Media::Photo(photo) => {
            let path = story_media_cache_path(app, chat_id, story_id, "jpg").ok()?;
            let size_bytes = photo.size().map(|value| value as u64);
            if !path.exists() {
                if should_download_inline(size_bytes) {
                    if client.download_media(&photo, &path).await.is_err() {
                        return None;
                    }
                } else {
                    let client_handle = client.clone();
                    let photo_copy = photo.clone();
                    let path_copy = path.clone();
                    tokio::spawn(async move {
                        let _ = client_handle.download_media(&photo_copy, &path_copy).await;
                    });
                }
            }

            Some(TgMediaAttachment {
                kind: "photo".to_string(),
                path: path.exists().then(|| path.to_string_lossy().to_string()),
                mime_type: Some("image/jpeg".to_string()),
                file_name: Some(format!("story-{story_id}.jpg")),
                width: None,
                height: None,
                duration_sec: None,
                size_bytes,
            })
        }
        Media::Sticker(sticker) => {
            let document = sticker.document;
            let mime = document.mime_type().map(ToOwned::to_owned);
            let ext = guess_file_extension(document.name(), mime.as_deref(), "webp");
            let path = story_media_cache_path(app, chat_id, story_id, &ext).ok()?;
            let size_bytes = document.size().map(|value| value as u64);
            if !path.exists() {
                if should_download_inline(size_bytes) {
                    if client.download_media(&document, &path).await.is_err() {
                        return None;
                    }
                } else {
                    let client_handle = client.clone();
                    let document_copy = document.clone();
                    let path_copy = path.clone();
                    tokio::spawn(async move {
                        let _ = client_handle.download_media(&document_copy, &path_copy).await;
                    });
                }
            }

            let (width, height) = document.resolution().unwrap_or((0, 0));
            Some(TgMediaAttachment {
                kind: "sticker".to_string(),
                path: path.exists().then(|| path.to_string_lossy().to_string()),
                mime_type: mime,
                file_name: document.name().map(ToOwned::to_owned),
                width: (width > 0).then_some(width),
                height: (height > 0).then_some(height),
                duration_sec: document.duration(),
                size_bytes,
            })
        }
        Media::Document(document) => {
            let mime = document.mime_type().map(ToOwned::to_owned);
            let media_kind = media_kind_from_document(&document);
            let fallback_ext = match media_kind {
                "video" => "mp4",
                "voice" => "ogg",
                "audio" => "mp3",
                "photo" => "jpg",
                "gif" => "gif",
                _ => "bin",
            };

            let ext = guess_file_extension(document.name(), mime.as_deref(), fallback_ext);
            let path = story_media_cache_path(app, chat_id, story_id, &ext).ok()?;
            let size_bytes = document.size().map(|value| value as u64);
            if !path.exists() {
                if should_download_inline(size_bytes) {
                    if client.download_media(&document, &path).await.is_err() {
                        return None;
                    }
                } else {
                    let client_handle = client.clone();
                    let document_copy = document.clone();
                    let path_copy = path.clone();
                    tokio::spawn(async move {
                        let _ = client_handle.download_media(&document_copy, &path_copy).await;
                    });
                }
            }

            let (width, height) = document.resolution().unwrap_or((0, 0));
            Some(TgMediaAttachment {
                kind: media_kind.to_string(),
                path: path.exists().then(|| path.to_string_lossy().to_string()),
                mime_type: mime,
                file_name: document.name().map(ToOwned::to_owned),
                width: (width > 0).then_some(width),
                height: (height > 0).then_some(height),
                duration_sec: document.duration(),
                size_bytes,
            })
        }
        _ => None,
    }
}

fn should_download_inline(size_bytes: Option<u64>) -> bool {
    size_bytes
        .map(|value| value <= MAX_INLINE_MEDIA_DOWNLOAD_BYTES)
        .unwrap_or(true)
}

fn media_kind_from_mime(mime: Option<&str>) -> &'static str {
    match mime {
        Some(value) if value.starts_with("image/") => "photo",
        Some(value) if value.starts_with("video/") => "video",
        Some(value) if value.starts_with("audio/") => "audio",
        _ => "file",
    }
}

fn media_kind_from_document(document: &Document) -> &'static str {
    let mime = document.mime_type();
    let name = document.name();

    if looks_like_voice(mime, name) {
        return "voice";
    }

    if looks_like_gif(mime, name) {
        return "gif";
    }

    media_kind_from_mime(mime)
}

fn looks_like_voice(mime: Option<&str>, name: Option<&str>) -> bool {
    let by_mime = matches!(
        mime,
        Some(value)
            if value.contains("ogg")
                || value.contains("opus")
                || value.contains("audio/ogg")
                || value.contains("audio/opus")
    );
    let by_name = name
        .map(|value| value.to_ascii_lowercase())
        .map(|lower| lower.ends_with(".ogg") || lower.ends_with(".opus"))
        .unwrap_or(false);
    by_mime || by_name
}

fn looks_like_gif(mime: Option<&str>, name: Option<&str>) -> bool {
    let by_mime = matches!(mime, Some(value) if value.contains("gif"));
    let by_name = name
        .map(|value| value.to_ascii_lowercase())
        .map(|lower| lower.ends_with(".gif"))
        .unwrap_or(false);
    by_mime || by_name
}

fn guess_file_extension(name: Option<&str>, mime: Option<&str>, fallback: &str) -> String {
    let from_name = name.and_then(|value| {
        Path::new(value)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.trim().trim_start_matches('.').to_lowercase())
            .filter(|ext| !ext.is_empty())
    });

    if let Some(ext) = from_name {
        return ext;
    }

    if let Some(value) = mime {
        if value.contains("jpeg") {
            return "jpg".to_string();
        }
        if value.contains("png") {
            return "png".to_string();
        }
        if value.contains("webp") {
            return "webp".to_string();
        }
        if value.contains("gif") {
            return "gif".to_string();
        }
        if value.contains("mp4") {
            return "mp4".to_string();
        }
        if value.contains("webm") {
            return "webm".to_string();
        }
        if value.contains("ogg") {
            return "ogg".to_string();
        }
        if value.contains("mpeg") || value.contains("mp3") {
            return "mp3".to_string();
        }
    }

    fallback.to_string()
}

fn media_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))?
        .join("media-cache");

    fs::create_dir_all(&root)
        .map_err(|e| format!("failed to create media cache '{}': {e}", root.display()))?;

    Ok(root)
}

fn avatar_cache_path(app: &AppHandle, peer_id: i64) -> Result<PathBuf, String> {
    let dir = media_cache_root(app)?.join("avatars");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create avatar cache '{}': {e}", dir.display()))?;

    Ok(dir.join(format!("{peer_id}.jpg")))
}

fn message_media_cache_path(
    app: &AppHandle,
    chat_id: &str,
    message_id: i32,
    ext: &str,
) -> Result<PathBuf, String> {
    scoped_media_cache_path(app, "messages", chat_id, message_id, ext)
}

fn story_media_cache_path(
    app: &AppHandle,
    chat_id: &str,
    story_id: i32,
    ext: &str,
) -> Result<PathBuf, String> {
    scoped_media_cache_path(app, "stories", chat_id, story_id, ext)
}

fn scoped_media_cache_path(
    app: &AppHandle,
    scope: &str,
    chat_id: &str,
    item_id: i32,
    ext: &str,
) -> Result<PathBuf, String> {
    let safe_chat = chat_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    let dir = media_cache_root(app)?.join(scope).join(safe_chat);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create message cache '{}': {e}", dir.display()))?;

    Ok(dir.join(format!("{item_id}.{ext}")))
}

fn composer_upload_path(
    app: &AppHandle,
    file_stem: &str,
    ext: &str,
) -> Result<PathBuf, String> {
    let dir = media_cache_root(app)?.join("composer-uploads");
    fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "failed to create composer upload cache '{}': {e}",
            dir.display()
        )
    })?;

    let safe_name = safe_fs_component(file_stem.trim()).trim_matches('_').to_string();
    let safe_ext = ext
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>();

    let stem = if safe_name.is_empty() {
        "clipboard-image".to_string()
    } else {
        safe_name
    };
    let final_ext = if safe_ext.is_empty() {
        "png".to_string()
    } else {
        safe_ext
    };

    Ok(dir.join(format!("{stem}-{}.{}", now_epoch_millis(), final_ext)))
}

async fn resolve_peer_ref_for_chat(chat_id: &str) -> Result<PeerRef, String> {
    let parsed_chat_id = chat_id
        .trim()
        .parse::<i64>()
        .map_err(|_| "chatId must be a valid Telegram dialog id".to_string())?;

    {
        let runtime = TG_RUNTIME.lock().await;
        if let Some(peer_ref) = runtime.peer_refs.get(&parsed_chat_id).copied() {
            return Ok(peer_ref);
        }
    }

    let peer_id = peer_id_from_dialog_id(parsed_chat_id)
        .ok_or_else(|| format!("unsupported dialog id format: {parsed_chat_id}"))?;

    Ok(PeerRef {
        id: peer_id,
        auth: PeerAuth::default(),
    })
}

fn peer_id_from_dialog_id(dialog_id: i64) -> Option<PeerId> {
    if (1..=0xFFFF_FFFFFF).contains(&dialog_id) {
        return PeerId::user(dialog_id);
    }

    if (-999_999_999_999..=-1).contains(&dialog_id) {
        return PeerId::chat(-dialog_id);
    }

    if (-4_000_000_000_000..=-1_000_000_000_001).contains(&dialog_id) {
        let channel_id = -dialog_id - 1_000_000_000_000;
        return PeerId::channel(channel_id);
    }

    None
}

fn dialog_id_from_peer(peer: &tl::enums::Peer) -> Option<i64> {
    match peer {
        tl::enums::Peer::User(value) => {
            PeerId::user(value.user_id).map(|peer_id| peer_id.bot_api_dialog_id())
        }
        tl::enums::Peer::Chat(value) => {
            PeerId::chat(value.chat_id).map(|peer_id| peer_id.bot_api_dialog_id())
        }
        tl::enums::Peer::Channel(value) => {
            PeerId::channel(value.channel_id).map(|peer_id| peer_id.bot_api_dialog_id())
        }
    }
}
