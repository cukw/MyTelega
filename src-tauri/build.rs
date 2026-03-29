fn main() {
    for key in ["PROXY_BASE_URL", "PROXY_API_KEY", "PROXY_TIMEOUT_MS"] {
        println!("cargo:rerun-if-env-changed={key}");
    }

    tauri_build::build()
}
