use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};

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
        // Local API only binds to 127.0.0.1; allow any origin to avoid Tauri WebView CORS mismatches.
        .allow_origin(Any)
        .allow_headers(Any)
        .allow_methods(Any);

    let mut router = Router::new()
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
        );

    for (route, file_path, content_type) in VDITOR_FILES {
        router = router.route(route, serve_vditor_asset(file_path, content_type));
    }

    router
        .with_state(state.clone())
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth_middleware))
        .layer(cors)
}

const VDITOR_FILES: &[(&str, &str, &str)] = &[
    ("/dist/js/lute/lute.min.js", "lute.min.js", "application/javascript"),
    ("/dist/js/icons/ant.js", "lute.min.js", "application/javascript"),
    ("/dist/js/mathjax/tex-svg-full.js", "vditor/js/mathjax/tex-svg-full.js", "application/javascript"),
    ("/dist/js/graphviz/full.render.js", "vditor/js/graphviz/full.render.js", "application/javascript"),
    ("/dist/js/graphviz/viz.js", "vditor/js/graphviz/viz.js", "application/javascript"),
    ("/dist/js/mermaid/mermaid.min.js", "vditor/js/mermaid/mermaid.min.js", "application/javascript"),
    ("/dist/js/echarts/echarts.min.js", "vditor/js/echarts/echarts.min.js", "application/javascript"),
    ("/dist/js/flowchart.js/flowchart.min.js", "vditor/js/flowchart.js/flowchart.min.js", "application/javascript"),
    ("/dist/js/abcjs/abcjs_basic.min.js", "vditor/js/abcjs/abcjs_basic.min.js", "application/javascript"),
    ("/dist/js/highlight.js/highlight.min.js", "vditor/js/highlight.js/highlight.min.js", "application/javascript"),
    ("/dist/js/highlight.js/third-languages.js", "vditor/js/highlight.js/third-languages.js", "application/javascript"),
    ("/dist/js/highlight.js/styles/github.min.css", "vditor/js/highlight.js/styles/github.min.css", "text/css"),
    ("/dist/js/highlight.js/styles/github-dark.min.css", "vditor/js/highlight.js/styles/github-dark.min.css", "text/css"),
    ("/dist/js/plantuml/plantuml-encoder.min.js", "vditor/js/plantuml/plantuml-encoder.min.js", "application/javascript"),
    ("/dist/js/markmap/markmap.min.js", "vditor/js/markmap/markmap.min.js", "application/javascript"),
    ("/dist/js/smiles-drawer/smiles-drawer.min.js", "vditor/js/smiles-drawer/smiles-drawer.min.js", "application/javascript"),
    ("/dist/js/katex/katex.min.js", "vditor/js/katex/katex.min.js", "application/javascript"),
    ("/dist/js/katex/mhchem.min.js", "vditor/js/katex/mhchem.min.js", "application/javascript"),
];

fn serve_vditor_asset(
    file_path: &'static str,
    content_type: &'static str,
) -> axum::routing::MethodRouter<Arc<LocalApiContext>> {
    get(move |State(state): State<Arc<LocalApiContext>>| async move {
        let Some(root) = &state.vditor_root else {
            return StatusCode::NOT_FOUND.into_response();
        };
        let full_path = root.join(file_path);
        match tokio::fs::read(&full_path).await {
            Ok(bytes) => {
                let mut response = Response::new(Body::from(bytes));
                let headers = response.headers_mut();
                if let Ok(value) = HeaderValue::from_str(content_type) {
                    headers.insert(header::CONTENT_TYPE, value);
                }
                headers.insert(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("public, max-age=604800, immutable"),
                );
                response
            }
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        }
    })
}
