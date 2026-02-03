use serde::{Deserialize, Serialize};

use crate::local_db::conflicts::ConflictRepository;
use crate::local_db::attachments::Attachment;
use crate::local_db::notes::{Note, NoteRepository};
use crate::local_db::oplog::OplogEntry;
use crate::local_db::outbox::OutboxEntry;
use crate::local_db::settings::{Setting, SettingsRepository};
use crate::local_db::tags::{extract_tag_names, TagRepository};
use crate::local_db::LocalDb;

pub mod remote_client;
pub mod scheduler;
pub mod migration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncOp {
    pub id: Option<i64>,
    pub entity_type: String,
    pub entity_id: String,
    pub op: String,
    pub payload_json: String,
    pub ts: String,
    pub device_id: String,
}

impl From<OplogEntry> for SyncOp {
    fn from(entry: OplogEntry) -> Self {
        Self {
            id: Some(entry.id),
            entity_type: entry.entity_type,
            entity_id: entry.entity_id,
            op: entry.op,
            payload_json: entry.payload_json,
            ts: entry.ts.to_rfc3339(),
            device_id: entry.device_id,
        }
    }
}

impl From<OutboxEntry> for SyncOp {
    fn from(entry: OutboxEntry) -> Self {
        Self {
            id: Some(entry.id),
            entity_type: entry.entity_type,
            entity_id: entry.entity_id,
            op: entry.op,
            payload_json: entry.payload_json,
            ts: entry.ts.to_rfc3339(),
            device_id: entry.device_id,
        }
    }
}

fn should_apply_lww(local_updated_at: chrono::DateTime<chrono::Utc>, local_device: &str, incoming_updated_at: chrono::DateTime<chrono::Utc>, incoming_device: &str) -> bool {
    if incoming_updated_at > local_updated_at {
        return true;
    }
    if incoming_updated_at < local_updated_at {
        return false;
    }
    incoming_device > local_device
}

pub async fn apply_ops(db: &LocalDb, ops: &[SyncOp]) -> Result<(), String> {
    let note_repo = NoteRepository::new(db.pool.clone());
    let settings_repo = SettingsRepository::new(db.pool.clone());
    let conflict_repo = ConflictRepository::new(db.pool.clone());
    let tag_repo = TagRepository::new(db.pool.clone());

    for op in ops {
        match op.entity_type.as_str() {
            "note" => {
                let incoming: Note = serde_json::from_str(&op.payload_json)
                    .map_err(|e| format!("Failed to parse note payload: {e}"))?;
                if let Some(existing) = note_repo.get_note_by_sync_id(&incoming.sync_id).await? {
                    if !should_apply_lww(existing.updated_at, &existing.device_id, incoming.updated_at, &incoming.device_id) {
                        let _ = conflict_repo.insert(
                            "note",
                            &incoming.sync_id,
                            Some(&serde_json::to_string(&existing).unwrap_or_else(|_| "{}".to_string())),
                            Some(&op.payload_json),
                            None,
                        )
                        .await;
                        continue;
                    }
                }
                let note = note_repo.upsert_note_by_sync_id(&incoming).await?;
                let tag_names = extract_tag_names(&note.content);
                let _ = tag_repo.set_note_tags_by_names(note.id, &tag_names).await;
            }
            "setting" => {
                let incoming: Setting = serde_json::from_str(&op.payload_json)
                    .map_err(|e| format!("Failed to parse setting payload: {e}"))?;
                if let Some(existing) = settings_repo.get(&incoming.key).await? {
                    if !should_apply_lww(existing.updated_at, &existing.device_id, incoming.updated_at, &incoming.device_id) {
                        let _ = conflict_repo.insert(
                            "setting",
                            &incoming.key,
                            Some(&serde_json::to_string(&existing).unwrap_or_else(|_| "{}".to_string())),
                            Some(&op.payload_json),
                            None,
                        )
                        .await;
                        continue;
                    }
                }
                settings_repo.upsert_setting(&incoming).await?;
            }
            "attachment" => {
                let incoming: Attachment = serde_json::from_str(&op.payload_json)
                    .map_err(|e| format!("Failed to parse attachment payload: {e}"))?;
                sqlx::query(
                    "INSERT INTO attachments (sync_id, note_id, filename, mime, size, sha256, path, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                     ON CONFLICT(sync_id) DO UPDATE SET note_id = excluded.note_id, filename = excluded.filename, mime = excluded.mime, size = excluded.size, sha256 = excluded.sha256, path = excluded.path, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
                )
                .bind(&incoming.sync_id)
                .bind(incoming.note_id)
                .bind(&incoming.filename)
                .bind(&incoming.mime)
                .bind(incoming.size)
                .bind(&incoming.sha256)
                .bind(&incoming.path)
                .bind(incoming.created_at)
                .bind(incoming.updated_at)
                .bind(incoming.deleted_at)
                .execute(&db.pool)
                .await
                .map_err(|e| format!("Failed to upsert attachment: {e}"))?;
            }
            _ => {
                // other entity types can be handled later
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::should_apply_lww;
    use chrono::{DateTime, Utc};

    fn ts(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn lww_prefers_newer_timestamp() {
        let local = ts("2024-01-01T00:00:00Z");
        let incoming = ts("2024-01-01T00:00:01Z");
        assert!(should_apply_lww(local, "device-a", incoming, "device-b"));
        assert!(!should_apply_lww(incoming, "device-a", local, "device-b"));
    }

    #[test]
    fn lww_tie_breaks_on_device_id() {
        let stamp = ts("2024-01-01T00:00:00Z");
        assert!(should_apply_lww(stamp, "device-a", stamp, "device-b"));
        assert!(!should_apply_lww(stamp, "device-b", stamp, "device-a"));
    }
}
