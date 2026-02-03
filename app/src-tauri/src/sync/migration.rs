use crate::local_db::notes::NoteRepository;
use crate::local_db::settings::SettingsRepository;
use crate::local_db::LocalDb;
use crate::local_runtime::LocalDataState;

use super::remote_client::RemoteClient;
use super::{apply_ops, SyncOp};

pub async fn import_remote_to_local(db: &LocalDb, client: &RemoteClient) -> Result<(), String> {
    let pulled = client.pull_ops(Some("0")).await?;
    if !pulled.ops.is_empty() {
        apply_ops(db, &pulled.ops).await?;
    }
    Ok(())
}

pub async fn export_local_to_remote(db: &LocalDb, client: &RemoteClient) -> Result<(), String> {
    let note_repo = NoteRepository::new(db.pool.clone());
    let settings_repo = SettingsRepository::new(db.pool.clone());

    let mut ops = Vec::new();
    for note in note_repo.list_all_notes().await? {
        ops.push(SyncOp {
            id: None,
            entity_type: "note".to_string(),
            entity_id: note.sync_id.clone(),
            op: "upsert".to_string(),
            payload_json: serde_json::to_string(&note).unwrap_or_else(|_| "{}".to_string()),
            ts: note.updated_at.to_rfc3339(),
            device_id: note.device_id.clone(),
        });
    }

    for setting in settings_repo.list_all().await? {
        ops.push(SyncOp {
            id: None,
            entity_type: "setting".to_string(),
            entity_id: setting.key.clone(),
            op: "upsert".to_string(),
            payload_json: serde_json::to_string(&setting).unwrap_or_else(|_| "{}".to_string()),
            ts: setting.updated_at.to_rfc3339(),
            device_id: setting.device_id.clone(),
        });
    }

    if !ops.is_empty() {
        client.push_ops(&ops).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn import_remote_to_local_cmd(
    state: tauri::State<'_, LocalDataState>,
    remote_url: String,
    token: Option<String>,
) -> Result<(), String> {
    let client = RemoteClient::new(remote_url, token);
    import_remote_to_local(&state.db, &client).await
}

#[tauri::command]
pub async fn export_local_to_remote_cmd(
    state: tauri::State<'_, LocalDataState>,
    remote_url: String,
    token: Option<String>,
) -> Result<(), String> {
    let client = RemoteClient::new(remote_url, token);
    export_local_to_remote(&state.db, &client).await
}
