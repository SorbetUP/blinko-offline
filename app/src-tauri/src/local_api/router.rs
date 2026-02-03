use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

use super::handlers_auth;
use super::handlers_files;
use super::handlers_notes;
use super::handlers_settings;
use super::handlers_sync;
use super::handlers_trpc;
use super::middleware::auth_middleware;
use super::LocalApiContext;

pub fn build_router(state: Arc<LocalApiContext>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| {
            let origin = origin.as_bytes();
            origin.starts_with(b"http://127.0.0.1")
                || origin.starts_with(b"http://localhost")
                || origin.starts_with(b"tauri://localhost")
                || origin.starts_with(b"https://tauri.localhost")
        }))
        .allow_headers(Any)
        .allow_methods(Any);

    Router::new()
        .route("/health", get(handlers_auth::health))
        .route("/api/auth/login", post(handlers_auth::login))
        .route("/api/auth/local", post(handlers_auth::login))
        .route("/api/auth/profile", get(handlers_auth::profile))
        .route("/api/auth/logout", post(handlers_auth::logout))
        .route("/api/auth/verify-2fa", post(handlers_auth::verify_2fa))
        .route("/api/notes", get(handlers_notes::list_notes).post(handlers_notes::create_note))
        .route(
            "/api/notes/:id",
            get(handlers_notes::get_note)
                .put(handlers_notes::update_note)
                .delete(handlers_notes::delete_note),
        )
        .route(
            "/api/settings",
            get(handlers_settings::list_settings).put(handlers_settings::update_setting),
        )
        .route(
            "/sync/settings",
            get(handlers_sync::get_sync_settings).put(handlers_sync::update_sync_settings),
        )
        .route("/sync/now", post(handlers_sync::sync_now))
        .route("/api/file/upload", post(handlers_files::upload_file))
        .route("/api/file/upload-by-url", post(handlers_files::upload_by_url))
        .route("/api/file/delete", post(handlers_files::delete_by_path))
        .route(
            "/api/file/:id",
            get(handlers_files::download_file).delete(handlers_files::delete_file),
        )
        .route("/attachments", post(handlers_files::upload_file))
        .route(
            "/attachments/:id",
            get(handlers_files::download_file).delete(handlers_files::delete_file),
        )
        .route("/api/trpc", get(handlers_trpc::handle_trpc_root).post(handlers_trpc::handle_trpc_root))
        .route(
            "/api/trpc/:path",
            get(handlers_trpc::handle_trpc).post(handlers_trpc::handle_trpc),
        )
        .with_state(state.clone())
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth_middleware))
        .layer(cors)
}
