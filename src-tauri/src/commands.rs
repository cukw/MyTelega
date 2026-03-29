use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use grammers_client::client::{LoginToken, PasswordToken};
use grammers_client::message::Message;
use grammers_client::peer::{Peer, User};
use grammers_client::sender::{ConnectionParams, SenderPoolHandle};
use grammers_client::session::storages::SqliteSession;
use grammers_client::session::types::{PeerAuth, PeerId, PeerRef};
use grammers_client::{Client, SenderPool, SignInError};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

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
    me_phone: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgDialog {
    id: String,
    telegram_chat_id: String,
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TgMessage {
    id: String,
    chat_id: String,
    from: String,
    text: String,
    at: String,
    status: Option<String>,
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
                me_phone: None,
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
                me_phone: None,
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
                me_phone: None,
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
            me_phone: None,
            error: None,
        });
    }

    mark_authorized_marker(&app)?;

    let (me_display_name, me_phone) = match client.get_me().await {
        Ok(me) => (
            Some(user_display_name(&me)),
            me.phone().map(|value| value.to_string()),
        ),
        Err(_) => (None, None),
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
        me_phone,
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
        me_phone: None,
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
                me_phone: None,
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

    let clamped_limit = limit.unwrap_or(80).clamp(1, 200) as usize;
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

        let title = peer_title(&peer, peer_id);
        let (kind, subtitle, verified, online) = peer_meta(&peer);

        let (last_preview, last_seen) = if let Some(message) = dialog.last_message.as_ref() {
            (message_preview(message), message_time(message))
        } else {
            (String::new(), String::new())
        };

        dialogs.push(TgDialog {
            id: peer_id.to_string(),
            telegram_chat_id: peer_id.to_string(),
            title,
            subtitle,
            kind,
            verified,
            online,
            pinned: false,
            muted: false,
            unread: 0,
            last_preview,
            last_seen,
        });
    }

    {
        let mut runtime = TG_RUNTIME.lock().await;
        runtime.peer_refs = peer_refs;
    }

    Ok(dialogs)
}

#[tauri::command]
pub async fn tg_list_messages(
    app: AppHandle,
    chat_id: String,
    limit: Option<u32>,
) -> Result<Vec<TgMessage>, String> {
    let client = ensure_authorized_client(&app).await?;
    let peer_ref = resolve_peer_ref_for_chat(&chat_id).await?;

    let clamped_limit = limit.unwrap_or(80).clamp(1, 300) as usize;
    let mut iter = client.iter_messages(peer_ref).limit(clamped_limit);

    let mut messages = Vec::new();

    while let Some(message) = iter
        .next()
        .await
        .map_err(|e| format!("failed to fetch messages: {e}"))?
    {
        messages.push(to_ui_message(&chat_id, &message));
    }

    messages.reverse();
    Ok(messages)
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

    Ok(to_ui_message(&chat_id, &message))
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

    runtime.fingerprint = None;
    runtime.client = None;
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

    let pool = SenderPool::with_configuration(Arc::clone(&session), api_id, connection_params);
    let pool_handle = pool.handle.thin.clone();
    let client = Client::new(pool.handle);
    let runner_task = tokio::spawn(pool.runner.run());

    {
        let mut runtime = TG_RUNTIME.lock().await;

        if let Some(previous_handle) = runtime.pool_handle.take() {
            previous_handle.quit();
        }
        if let Some(previous_task) = runtime.runner_task.take() {
            previous_task.abort();
        }

        runtime.fingerprint = Some(fingerprint);
        runtime.client = Some(client.clone());
        runtime.pool_handle = Some(pool_handle);
        runtime.runner_task = Some(runner_task);
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

    Ok(client)
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

fn message_preview(message: &Message) -> String {
    let text = message.text().trim();
    if text.is_empty() {
        return "<non-text message>".to_string();
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

fn message_time(message: &Message) -> String {
    message.date().format("%H:%M").to_string()
}

fn to_ui_message(chat_id: &str, message: &Message) -> TgMessage {
    let text = {
        let value = message.text().trim();
        if value.is_empty() {
            "<non-text message>".to_string()
        } else {
            value.to_string()
        }
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
        text,
        at: message_time(message),
        status,
    }
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
