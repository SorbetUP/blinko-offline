use std::sync::Arc;

use app_lib::local_api::{build_context, start_local_api};
use app_lib::local_db::LocalDb;
use app_lib::local_runtime::config::{save_config, LocalConfig};
use app_lib::local_runtime::paths::RuntimePaths;
use app_lib::local_runtime::LocalDataState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::temp_dir().join("blinko_local_api_server");
    let paths = RuntimePaths::from_root(root);
    paths.ensure_dirs()?;

    let mut config = LocalConfig::default();
    if config.local_api.token.is_none() {
        config.local_api.token = Some("test-token".to_string());
    }
    if config.device_id.is_none() {
        config.device_id = Some("local-api-server".to_string());
    }
    save_config(&paths, &config)?;

    let db = LocalDb::connect(&paths).await.map_err(|e| format!("{e}"))?;
    let data_state = LocalDataState::new(db.clone(), config.clone(), paths.clone());
    let context = build_context(paths.clone(), &config, db, data_state)?;
    let port = start_local_api(Arc::clone(&context)).await?;

    println!("LOCAL_API_URL=http://127.0.0.1:{port}");

    std::future::pending::<()>().await;
    Ok(())
}
