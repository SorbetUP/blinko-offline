use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct OutboxEntry {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: String,
    pub op: String,
    pub payload_json: String,
    pub ts: DateTime<Utc>,
    pub device_id: String,
    pub status: String,
}

#[derive(Clone)]
pub struct OutboxRepository {
    pool: SqlitePool,
}

impl OutboxRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn append(
        &self,
        entity_type: &str,
        entity_id: &str,
        op: &str,
        payload_json: &str,
        device_id: &str,
    ) -> Result<OutboxEntry, String> {
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO outbox (entity_type, entity_id, op, payload_json, ts, device_id, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
        )
        .bind(entity_type)
        .bind(entity_id)
        .bind(op)
        .bind(payload_json)
        .bind(now)
        .bind(device_id)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to append outbox: {e}"))?;

        let id = sqlx::query_scalar::<_, i64>("SELECT last_insert_rowid()")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| format!("Failed to read outbox id: {e}"))?;

        self.get_by_id(id).await
    }

    pub async fn list_pending(&self, limit: i64) -> Result<Vec<OutboxEntry>, String> {
        sqlx::query_as::<_, OutboxEntry>(
            "SELECT id, entity_type, entity_id, op, payload_json, ts, device_id, status FROM outbox WHERE status = 'pending' ORDER BY id ASC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to list outbox: {e}"))
    }

    pub async fn mark_sent(&self, ids: &[i64]) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }
        let ids_list = ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let query = format!("UPDATE outbox SET status = 'sent' WHERE id IN ({ids_list})");
        sqlx::query(&query)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to mark outbox sent: {e}"))?;
        Ok(())
    }

    pub async fn get_by_id(&self, id: i64) -> Result<OutboxEntry, String> {
        sqlx::query_as::<_, OutboxEntry>(
            "SELECT id, entity_type, entity_id, op, payload_json, ts, device_id, status FROM outbox WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| format!("Failed to get outbox entry: {e}"))
    }
}
