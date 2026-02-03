use std::sync::Arc;

use axum::extract::{Json, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::Deserialize;

use crate::local_runtime::config::{save_config, LocalMode, RemoteEndpoint};
use crate::local_db::settings::SettingsRepository;
use super::LocalApiContext;

#[derive(Debug, Deserialize)]
pub struct SyncSettingsUpdate {
    pub mode: Option<LocalMode>,
    pub remote_endpoints: Option<Vec<RemoteEndpoint>>, 
}

pub async fn get_sync_settings(State(state): State<Arc<LocalApiContext>>) -> impl IntoResponse {
    let config = state.data_state.config_snapshot();
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "mode": config.mode,
            "remote_endpoints": config.remote_endpoints,
        })),
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
    if let Some(endpoints) = input.remote_endpoints {
        for endpoint in endpoints.iter() {
            let url = endpoint.url.trim();
            let is_local = url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost");
            let is_https = url.starts_with("https://");
            if !is_https && !is_local {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "Remote sync requires HTTPS" })),
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
