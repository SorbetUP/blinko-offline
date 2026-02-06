use serde::{Deserialize, Serialize};
use std::fs;

use super::paths::RuntimePaths;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalMode {
    Local,
    Remote,
    Sync,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RemoteEndpoint {
    pub id: String,
    pub url: String,
    pub token: Option<String>,
    pub last_sync_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct LocalApiConfig {
    pub port: Option<u16>,
    pub enabled: bool,
    pub token: Option<String>,
}

impl Default for LocalApiConfig {
    fn default() -> Self {
        Self {
            port: None,
            enabled: true,
            token: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct LocalConfig {
    pub schema_version: u32,
    pub mode: LocalMode,
    pub device_id: Option<String>,
    pub remote_endpoints: Vec<RemoteEndpoint>,
    pub allow_insecure_http: bool,
    pub local_api: LocalApiConfig,
}

impl Default for LocalConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            mode: LocalMode::Local,
            device_id: None,
            remote_endpoints: Vec::new(),
            allow_insecure_http: false,
            local_api: LocalApiConfig::default(),
        }
    }
}

pub fn load_config(paths: &RuntimePaths) -> Result<LocalConfig, String> {
    if !paths.config_path.exists() {
        return Ok(LocalConfig::default());
    }

    let raw = fs::read_to_string(&paths.config_path)
        .map_err(|e| format!("Failed to read config: {e}"))?;

    let parsed: LocalConfig = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse config: {e}"))?;

    Ok(migrate_config(parsed))
}

pub fn save_config(paths: &RuntimePaths, config: &LocalConfig) -> Result<(), String> {
    let data = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    fs::write(&paths.config_path, data)
        .map_err(|e| format!("Failed to write config: {e}"))?;
    Ok(())
}

fn migrate_config(config: LocalConfig) -> LocalConfig {
    if config.schema_version == 0 {
        return LocalConfig { schema_version: 1, ..config };
    }
    config
}
