use std::time::Duration;

#[derive(Debug, Clone)]
pub struct BuildConfig {
    pub proxy_base_url: String,
    pub proxy_api_key: Option<String>,
    pub timeout: Duration,
}

impl BuildConfig {
    pub fn from_build_env() -> Self {
        let proxy_base_url = option_env!("PROXY_BASE_URL")
            .unwrap_or("http://127.0.0.1:8080")
            .trim_end_matches('/')
            .to_string();

        let proxy_api_key = option_env!("PROXY_API_KEY")
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(ToOwned::to_owned);

        let timeout_ms = option_env!("PROXY_TIMEOUT_MS")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(15000);

        Self {
            proxy_base_url,
            proxy_api_key,
            timeout: Duration::from_millis(timeout_ms),
        }
    }
}
