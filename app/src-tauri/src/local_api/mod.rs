use std::sync::Arc;

use tokio::net::TcpListener;

use crate::local_db::LocalDb;
use crate::local_runtime::config::LocalConfig;
use crate::local_runtime::paths::RuntimePaths;
use crate::local_runtime::LocalDataState;

pub mod handlers_auth;
pub mod handlers_files;
pub mod handlers_notes;
pub mod handlers_settings;
pub mod handlers_sync;
pub mod handlers_trpc;
pub mod middleware;
pub mod router;

#[cfg(test)]
mod tests;

#[derive(Clone)]
pub struct LocalApiContext {
    pub data_state: LocalDataState,
    pub paths: RuntimePaths,
    pub token: String,
    pub device_id: String,
}

pub async fn start_local_api(context: Arc<LocalApiContext>) -> Result<u16, String> {
    let app = router::build_router(context.clone());
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local API: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read local addr: {e}"))?
        .port();

    tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, app).await {
            eprintln!("local API server error: {err}");
        }
    });

    Ok(port)
}

pub fn build_context(
    paths: RuntimePaths,
    config: &LocalConfig,
    _db: LocalDb,
    data_state: LocalDataState,
) -> Result<Arc<LocalApiContext>, String> {
    let token = config
        .local_api
        .token
        .clone()
        .ok_or_else(|| "local_api.token missing".to_string())?;
    let device_id = config
        .device_id
        .clone()
        .ok_or_else(|| "device_id missing".to_string())?;
    Ok(Arc::new(LocalApiContext {
        data_state,
        paths,
        token,
        device_id,
    }))
}

#[tauri::command]
pub fn get_local_api_base_url(state: tauri::State<'_, crate::local_runtime::LocalRuntimeState>) -> Option<String> {
    state
        .snapshot()
        .api_port
        .map(|port| format!("http://127.0.0.1:{port}"))
}
