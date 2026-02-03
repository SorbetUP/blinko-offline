use std::path::Path;

use reqwest::Client;
use serde::Deserialize;

use crate::local_db::attachments::Attachment;

use super::SyncOp;

#[derive(Debug, Deserialize)]
pub struct RemoteChanges {
    pub cursor: Option<String>,
    pub ops: Vec<SyncOp>,
}

#[derive(Clone)]
pub struct RemoteClient {
    base_url: String,
    token: Option<String>,
    client: Client,
}

impl RemoteClient {
    pub fn new(base_url: String, token: Option<String>) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            token,
            client: Client::new(),
        }
    }

    pub async fn pull_ops(&self, since: Option<&str>) -> Result<RemoteChanges, String> {
        let mut req = self.client.get(format!("{}/changes", self.base_url));
        if let Some(cursor) = since {
            req = req.query(&[("since", cursor)]);
        }
        if let Some(token) = &self.token {
            req = req.bearer_auth(token);
        }
        let res = req
            .send()
            .await
            .map_err(|e| format!("Failed to pull ops: {e}"))?;
        let status = res.status();
        if !status.is_success() {
            return Err(format!("Pull ops failed with status {status}"));
        }
        res.json::<RemoteChanges>()
            .await
            .map_err(|e| format!("Failed to parse pull ops response: {e}"))
    }

    pub async fn push_ops(&self, ops: &[SyncOp]) -> Result<(), String> {
        let mut req = self.client.post(format!("{}/changes", self.base_url));
        if let Some(token) = &self.token {
            req = req.bearer_auth(token);
        }
        let res = req
            .json(&serde_json::json!({ "ops": ops }))
            .send()
            .await
            .map_err(|e| format!("Failed to push ops: {e}"))?;
        let status = res.status();
        if !status.is_success() {
            return Err(format!("Push ops failed with status {status}"));
        }
        Ok(())
    }

    pub async fn upload_attachment(&self, attachment: &Attachment, file_path: &Path) -> Result<(), String> {
        let bytes = tokio::fs::read(file_path)
            .await
            .map_err(|e| format!("Failed to read attachment file: {e}"))?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(attachment.filename.clone())
            .mime_str(&attachment.mime)
            .map_err(|e| format!("Failed to build multipart: {e}"))?;
        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("sync_id", attachment.sync_id.clone());

        let mut req = self.client.post(format!("{}/api/file/upload", self.base_url));
        if let Some(token) = &self.token {
            req = req.bearer_auth(token);
        }
        let res = req
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Failed to upload attachment: {e}"))?;
        let status = res.status();
        if !status.is_success() {
            return Err(format!("Upload attachment failed with status {status}"));
        }
        Ok(())
    }

    pub async fn download_attachment(&self, attachment_id: &str) -> Result<Vec<u8>, String> {
        let mut req = self.client.get(format!("{}/api/file/by-sync-id/{}", self.base_url, attachment_id));
        if let Some(token) = &self.token {
            req = req.bearer_auth(token);
        }
        let res = req
            .send()
            .await
            .map_err(|e| format!("Failed to download attachment: {e}"))?;
        let status = res.status();
        if !status.is_success() {
            return Err(format!("Download attachment failed with status {status}"));
        }
        res.bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|e| format!("Failed to read attachment bytes: {e}"))
    }
}
