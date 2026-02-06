use std::sync::Arc;

use axum::extract::{Json, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::Deserialize;

use crate::local_runtime::config::{save_config, LocalMode, RemoteEndpoint};
use crate::local_db::settings::SettingsRepository;
use super::LocalApiContext;
use reqwest::Client;
use reqwest::header::{AUTHORIZATION, HeaderValue};
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct SyncSettingsUpdate {
    pub mode: Option<LocalMode>,
    pub remote_endpoints: Option<Vec<RemoteEndpoint>>,
    pub allow_insecure_http: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SyncTestRequest {
    pub remote_url: String,
    pub token: Option<String>,
    pub allow_insecure_http: Option<bool>,
}

pub async fn get_sync_settings(State(state): State<Arc<LocalApiContext>>) -> impl IntoResponse {
    let config = state.data_state.config_snapshot();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "mode": config.mode,
            "remote_endpoints": config.remote_endpoints,
            "allow_insecure_http": config.allow_insecure_http,
        })),
    )
}

fn host_from_url(url: &str) -> Option<String> {
    let after_scheme = url.split("://").nth(1)?;
    let host_port = after_scheme.split('/').next().unwrap_or("");
    let host = host_port.rsplit('@').next().unwrap_or(host_port);
    let host = host.trim_matches(&['[', ']'][..]);
    let host = host.split(':').next().unwrap_or(host);
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

fn is_private_http_url(url: &str) -> bool {
    let Some(host) = host_from_url(url) else { return false };
    if host == "localhost" {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_private() || v4.is_loopback() || v4.is_link_local()
            }
            std::net::IpAddr::V6(v6) => {
                v6.is_loopback() || v6.is_unique_local() || v6.is_unicast_link_local()
            }
        }
    } else {
        false
    }
}

pub async fn test_sync_connection(
    State(state): State<Arc<LocalApiContext>>,
    Json(input): Json<SyncTestRequest>,
) -> impl IntoResponse {
    let config = state.data_state.config_snapshot();
    let remote_url = input.remote_url.trim().trim_end_matches('/').to_string();

    if !(remote_url.starts_with("http://") || remote_url.starts_with("https://")) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Remote URL must start with http:// or https://" })),
        );
    }

    if remote_url.starts_with("http://") {
        let allow_insecure_http = input.allow_insecure_http.unwrap_or(config.allow_insecure_http);
        let allow_http = allow_insecure_http && is_private_http_url(&remote_url);
        if !allow_http {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Remote sync requires HTTPS (or allow LAN HTTP in settings)." })),
            );
        }
    }

    let client = match Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to init HTTP client: {err}") })),
            );
        }
    };

    let health_url = format!("{remote_url}/health");
    let health_res = match client.get(&health_url).send().await {
        Ok(res) => res,
        Err(err) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": format!("Health check failed: {err}") })),
            );
        }
    };

    if !health_res.status().is_success() {
        return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "error": format!("Health check failed ({})", health_res.status()) })),
        );
    }

    if let Some(token) = input.token.as_deref().filter(|t| !t.trim().is_empty()) {
        let profile_url = format!("{remote_url}/api/auth/profile");
        let mut req = client.get(&profile_url);
        if let Ok(hv) = HeaderValue::from_str(&format!("Bearer {token}")) {
            req = req.header(AUTHORIZATION, hv);
        }
        let profile_res = match req.send().await {
            Ok(res) => res,
            Err(err) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({ "error": format!("Token check failed: {err}") })),
                );
            }
        };
        if !profile_res.status().is_success() {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": format!("Token invalid ({})", profile_res.status()) })),
            );
        }
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true })),
    )
}

pub async fn update_sync_settings(
    State(state): State<Arc<LocalApiContext>>,
    Json(input): Json<SyncSettingsUpdate>,
) -> impl IntoResponse {
    let mut config = state.data_state.config_snapshot();
    if let Some(mode) = input.mode {
        config.mode = mode;
    }
    if let Some(allow_insecure_http) = input.allow_insecure_http {
        config.allow_insecure_http = allow_insecure_http;
    }
    if let Some(endpoints) = input.remote_endpoints {
        for endpoint in endpoints.iter() {
            let url = endpoint.url.trim();
            let is_local = url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost");
            let is_https = url.starts_with("https://");
            let is_http = url.starts_with("http://");
            let allow_http = config.allow_insecure_http && is_http && is_private_http_url(url);
            if !is_https && !is_local && !allow_http {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "Remote sync requires HTTPS (or allow LAN HTTP in settings)." })),
                );
            }
        }
        config.remote_endpoints = endpoints;
    }
    if let Some(first) = config.remote_endpoints.first() {
        let repo = SettingsRepository::new(state.data_state.db.pool.clone());
        let _ = repo.set("remote_base_url", &first.url, &state.device_id).await;
        if let Some(token) = &first.token {
            let _ = repo.set("remote_token", token, &state.device_id).await;
        }
    }

    if let Err(err) = save_config(&state.paths, &config) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err })),
        );
    }
    state.data_state.update_config(config.clone());
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "mode": config.mode,
            "remote_endpoints": config.remote_endpoints,
            "allow_insecure_http": config.allow_insecure_http,
        })),
    )
}

pub async fn sync_now(State(state): State<Arc<LocalApiContext>>) -> impl IntoResponse {
    match crate::sync::scheduler::run_sync_once(&state.data_state).await {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": err })),
        ),
    }
}
