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
            commands::tg_list_messages,
            commands::tg_send_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
