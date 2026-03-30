mod commands;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::proxy_meta,
            commands::healthcheck,
            commands::invoke_telegram,
            commands::get_session_state,
            commands::save_session_setup,
            commands::mark_session_ready,
            commands::clear_session_setup,
            commands::tg_bootstrap,
            commands::tg_request_code,
            commands::tg_sign_in_code,
            commands::tg_check_password,
            commands::tg_list_dialogs,
            commands::tg_list_stories,
            commands::tg_get_peer_stories,
            commands::tg_list_messages,
            commands::tg_send_message,
            commands::tg_send_photo,
            commands::tg_mark_chat_read,
            commands::tg_mark_stories_read,
            commands::tg_forward_message,
            commands::tg_send_sticker,
            commands::tg_send_sticker_by_ref,
            commands::tg_add_sticker_set,
            commands::tg_list_sticker_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
