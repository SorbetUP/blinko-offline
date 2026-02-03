use std::sync::Arc;

use axum::extract::{Json, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};

use super::LocalApiContext;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub id: String,
    pub name: String,
    pub role: String,
    pub nickname: String,
    pub image: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub user: UserInfo,
    pub token: String,
}

pub async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "ok": true, "version": "local" }))
}

pub async fn login(
    State(state): State<Arc<LocalApiContext>>,
    Json(_input): Json<LoginRequest>,
) -> impl IntoResponse {
    let user = UserInfo {
        id: "local-user".to_string(),
        name: "Local User".to_string(),
        role: "local".to_string(),
        nickname: "local".to_string(),
        image: "".to_string(),
    };

    let response = AuthResponse {
        user,
        token: state.token.clone(),
    };

    (StatusCode::OK, Json(response))
}

pub async fn verify_2fa(
    State(state): State<Arc<LocalApiContext>>,
) -> impl IntoResponse {
    let user = UserInfo {
        id: "local-user".to_string(),
        name: "Local User".to_string(),
        role: "local".to_string(),
        nickname: "local".to_string(),
        image: "".to_string(),
    };

    let response = AuthResponse {
        user,
        token: state.token.clone(),
    };

    (StatusCode::OK, Json(response))
}

pub async fn profile(
    State(state): State<Arc<LocalApiContext>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|raw| raw.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    match token {
        Some(value) if value == state.token => {
            let user = UserInfo {
                id: "local-user".to_string(),
                name: "Local User".to_string(),
                role: "local".to_string(),
                nickname: "local".to_string(),
                image: "".to_string(),
            };
            (StatusCode::OK, Json(serde_json::json!({ "user": user })))
        }
        _ => (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Not authenticated" }))),
    }
}

pub async fn logout() -> impl IntoResponse {
    (StatusCode::OK, Json(serde_json::json!({ "message": "Logout successful" })))
}
