use std::sync::Arc;

use axum::extract::{Multipart, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use serde::Deserialize;

use crate::local_db::attachments::AttachmentRepository;
use crate::local_db::oplog::OplogRepository;
use crate::local_db::outbox::OutboxRepository;
use super::LocalApiContext;

#[derive(Debug, Deserialize)]
pub struct DeleteByPathRequest {
    pub attachment_path: String,
}

pub async fn upload_file(
    State(state): State<Arc<LocalApiContext>>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let repo = AttachmentRepository::new(state.data_state.db.pool.clone(), state.paths.attachments_dir.clone());

    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("file") {
            continue;
        }

        let filename = field.file_name().unwrap_or("upload.bin").to_string();
        let mime = field.content_type().unwrap_or("application/octet-stream").to_string();
        match field.bytes().await {
            Ok(bytes) => {
                return match repo.save_file(&bytes, &filename, &mime, None).await {
                    Ok(att) => {
                        let oplog = OplogRepository::new(state.data_state.db.pool.clone());
                        let _ = oplog
                            .append(
                                "attachment",
                                &att.sync_id,
                                "create",
                                &serde_json::to_string(&att).unwrap_or_else(|_| "{}".to_string()),
                                &state.device_id,
                            )
                            .await;
                        let outbox = OutboxRepository::new(state.data_state.db.pool.clone());
                        let _ = outbox
                            .append(
                                "attachment",
                                &att.sync_id,
                                "create",
                                &serde_json::to_string(&att).unwrap_or_else(|_| "{}".to_string()),
                                &state.device_id,
                            )
                            .await;
                        (
                            StatusCode::OK,
                            axum::Json(serde_json::json!({
                                "Message": "Success",
                                "status": 200,
                                "filePath": format!("/api/file/{}", att.id),
                                "fileName": att.filename,
                                "type": att.mime,
                                "size": att.size
                            })),
                        )
                    }
                    Err(err) => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        axum::Json(serde_json::json!({ "error": err })),
                    ),
                };
            }
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(serde_json::json!({ "error": err.to_string() })),
                );
            }
        }
    }

    (
        StatusCode::BAD_REQUEST,
        axum::Json(serde_json::json!({ "error": "No file uploaded" })),
    )
}

pub async fn upload_by_url(
    State(state): State<Arc<LocalApiContext>>,
    axum::Json(payload): axum::Json<serde_json::Value>,
) -> impl IntoResponse {
    let repo = AttachmentRepository::new(state.data_state.db.pool.clone(), state.paths.attachments_dir.clone());
    let url = payload.get("url").and_then(|v| v.as_str()).unwrap_or("");
    if url.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "error": "No URL provided" })),
        );
    }

    match reqwest::get(url).await {
        Ok(response) => {
            let mime = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            let filename = url
                .split('/')
                .last()
                .filter(|s| !s.is_empty())
                .unwrap_or("download")
                .to_string();
            match response.bytes().await {
                Ok(bytes) => match repo.save_file(&bytes, &filename, &mime, None).await {
                    Ok(att) => {
                        let oplog = OplogRepository::new(state.data_state.db.pool.clone());
                        let _ = oplog
                            .append(
                                "attachment",
                                &att.sync_id,
                                "create",
                                &serde_json::to_string(&att).unwrap_or_else(|_| "{}".to_string()),
                                &state.device_id,
                            )
                            .await;
                        let outbox = OutboxRepository::new(state.data_state.db.pool.clone());
                        let _ = outbox
                            .append(
                                "attachment",
                                &att.sync_id,
                                "create",
                                &serde_json::to_string(&att).unwrap_or_else(|_| "{}".to_string()),
                                &state.device_id,
                            )
                            .await;
                        (
                            StatusCode::OK,
                            axum::Json(serde_json::json!({
                                "Message": "Success",
                                "status": 200,
                                "filePath": format!("/api/file/{}", att.id),
                                "fileName": att.filename,
                                "type": att.mime,
                                "size": att.size,
                                "originalURL": url
                            })),
                        )
                    }
                    Err(err) => (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        axum::Json(serde_json::json!({ "error": err })),
                    ),
                },
                Err(err) => (
                    StatusCode::BAD_REQUEST,
                    axum::Json(serde_json::json!({ "error": err.to_string() })),
                ),
            }
        }
        Err(err) => (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "error": err.to_string() })),
        ),
    }
}

pub async fn download_file(
    State(state): State<Arc<LocalApiContext>>,
    Path(id): Path<i64>,
    _headers: HeaderMap,
) -> impl IntoResponse {
    let repo = AttachmentRepository::new(state.data_state.db.pool.clone(), state.paths.attachments_dir.clone());
    match repo.get_by_id(id).await {
        Ok(Some(att)) => {
            let file_path = state.paths.attachments_dir.join(&att.path);
            match tokio::fs::read(file_path).await {
                Ok(bytes) => (
                    StatusCode::OK,
                    [(axum::http::header::CONTENT_TYPE, att.mime.clone())],
                    Bytes::from(bytes),
                )
                    .into_response(),
                Err(err) => (
                    StatusCode::NOT_FOUND,
                    axum::Json(serde_json::json!({ "error": err.to_string() })),
                )
                    .into_response(),
            }
        }
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": err })),
        )
            .into_response(),
    }
}

pub async fn delete_file(
    State(state): State<Arc<LocalApiContext>>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let repo = AttachmentRepository::new(state.data_state.db.pool.clone(), state.paths.attachments_dir.clone());
    match repo.get_by_id(id).await {
        Ok(Some(att)) => {
            let file_path = state.paths.attachments_dir.join(&att.path);
            let _ = tokio::fs::remove_file(&file_path).await;
            match repo.delete_attachment(id).await {
                Ok(Some(updated)) => {
                    let oplog = OplogRepository::new(state.data_state.db.pool.clone());
                    let _ = oplog
                        .append(
                            "attachment",
                            &updated.sync_id,
                            "delete",
                            &serde_json::to_string(&updated).unwrap_or_else(|_| "{}".to_string()),
                            &state.device_id,
                        )
                        .await;
                    let outbox = OutboxRepository::new(state.data_state.db.pool.clone());
                    let _ = outbox
                        .append(
                            "attachment",
                            &updated.sync_id,
                            "delete",
                            &serde_json::to_string(&updated).unwrap_or_else(|_| "{}".to_string()),
                            &state.device_id,
                        )
                        .await;
                    (StatusCode::OK, axum::Json(serde_json::json!({ "status": 200 })))
                }
                Ok(None) => (StatusCode::NOT_FOUND, axum::Json(serde_json::json!({ "error": "Not found" }))),
                Err(err) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    axum::Json(serde_json::json!({ "error": err })),
                ),
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, axum::Json(serde_json::json!({ "error": "Not found" }))),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": err })),
        ),
    }
}

pub async fn delete_by_path(
    State(state): State<Arc<LocalApiContext>>,
    axum::Json(payload): axum::Json<DeleteByPathRequest>,
) -> Response {
    let prefix = "/api/file/";
    if let Some(id) = payload.attachment_path.strip_prefix(prefix) {
        if let Ok(id) = id.parse::<i64>() {
            return delete_file(State(state), Path(id)).await.into_response();
        }
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "error": "Invalid attachment id" })),
        )
            .into_response();
    }

    (
        StatusCode::BAD_REQUEST,
        axum::Json(serde_json::json!({ "error": "Unsupported attachment_path" })),
    )
        .into_response()
}
