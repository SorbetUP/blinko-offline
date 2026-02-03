use std::time::Duration;

use tokio::time::sleep;

use crate::local_db::outbox::OutboxRepository;
use crate::local_db::sync_state::SyncStateRepository;
use crate::local_runtime::LocalDataState;

use super::remote_client::RemoteClient;
use super::{apply_ops, SyncOp};
use sha2::{Digest, Sha256};

pub async fn run_sync_once(state: &LocalDataState) -> Result<(), String> {
    let endpoints = state.config_snapshot().remote_endpoints;
    for endpoint in endpoints {
        let client = RemoteClient::new(endpoint.url.clone(), endpoint.token.clone());
        let sync_repo = SyncStateRepository::new(state.db.pool.clone());
        let outbox_repo = OutboxRepository::new(state.db.pool.clone());

        let last_state = sync_repo.get(&endpoint.id).await?;
        let last_pull_cursor = last_state.as_ref().and_then(|s| s.last_pull_cursor.clone());
        let last_push_cursor = last_state.as_ref().and_then(|s| s.last_push_cursor.clone());

        let pending_entries = outbox_repo.list_pending(200).await?;
        let local_ops: Vec<SyncOp> = pending_entries.iter().cloned().map(SyncOp::from).collect();
        let mut new_push_cursor = last_push_cursor.clone();
        if !local_ops.is_empty() {
            client.push_ops(&local_ops).await?;
            let ids: Vec<i64> = pending_entries.iter().map(|entry| entry.id).collect();
            outbox_repo.mark_sent(&ids).await?;
            new_push_cursor = local_ops
                .last()
                .and_then(|op| op.id.map(|id| id.to_string()))
                .or(last_push_cursor);

            for op in local_ops.iter().filter(|op| op.entity_type == "attachment") {
                if let Ok(att) = serde_json::from_str::<crate::local_db::attachments::Attachment>(&op.payload_json) {
                    let file_path = state.paths.attachments_dir.join(&att.path);
                    if file_path.exists() {
                        let _ = client.upload_attachment(&att, &file_path).await;
                    }
                }
            }
        }

        let pulled = client.pull_ops(last_pull_cursor.as_deref()).await?;
        if !pulled.ops.is_empty() {
            apply_ops(&state.db, &pulled.ops).await?;

            for op in pulled.ops.iter().filter(|op| op.entity_type == "attachment") {
                if let Ok(att) = serde_json::from_str::<crate::local_db::attachments::Attachment>(&op.payload_json) {
                    let file_path = state.paths.attachments_dir.join(&att.path);
                    if !file_path.exists() {
                        if let Ok(bytes) = client.download_attachment(&att.sync_id).await {
                            if hash_matches(&bytes, &att.sha256) {
                                let _ = tokio::fs::write(&file_path, bytes).await;
                            } else {
                                eprintln!("Attachment hash mismatch for {}", att.sync_id);
                            }
                        }
                    }
                }
            }
        }

        let new_pull_cursor = pulled.cursor.or(last_pull_cursor);

        let _ = sync_repo
            .upsert(
                &endpoint.id,
                new_pull_cursor.as_deref(),
                new_push_cursor.as_deref(),
                Some("ok"),
            )
            .await?;
    }

    Ok(())
}

fn hash_matches(bytes: &[u8], expected: &str) -> bool {
    format_hash(bytes) == expected
}

fn format_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest.iter() {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

pub fn start_sync_scheduler(state: LocalDataState, interval: Duration) {
    tauri::async_runtime::spawn(async move {
        loop {
            let _ = run_sync_once(&state).await;
            sleep(interval).await;
        }
    });
}

#[tauri::command]
pub async fn sync_now(state: tauri::State<'_, LocalDataState>) -> Result<(), String> {
    run_sync_once(&state).await
}
