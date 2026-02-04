use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use serde_json::{json, Value};

use crate::local_db::attachments::AttachmentRepository;
use crate::local_db::notes::{Note, NoteInput, NoteRepository};
use crate::local_db::settings::SettingsRepository;
use crate::local_db::tags::{extract_tag_names, Tag, TagRelation, TagRepository};

use super::LocalApiContext;
use super::local_user;

pub async fn handle_trpc_root(
    State(_state): State<Arc<LocalApiContext>>,
    _method: Method,
    _headers: HeaderMap,
    _query: Query<HashMap<String, String>>,
    _body: Bytes,
) -> Response {
    (
        StatusCode::BAD_REQUEST,
        axum::Json(json!({
            "error": {
                "message": "Missing tRPC path",
                "code": -32601,
                "data": { "code": "NOT_FOUND" }
            }
        })),
    )
        .into_response()
}

pub async fn handle_trpc(
    State(state): State<Arc<LocalApiContext>>,
    Path(path): Path<String>,
    _method: Method,
    _headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    body: Bytes,
) -> Response {
    if path.trim().is_empty() {
        return handle_trpc_root(State(state), Method::GET, HeaderMap::new(), Query(query), body).await;
    }

    let input_value = if !body.is_empty() {
        serde_json::from_slice::<Value>(&body).ok()
    } else {
        query
            .get("input")
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
    };

    let is_batch = query.get("batch").map(|v| v == "1").unwrap_or(false) || path.contains(',');
    let paths: Vec<&str> = path.split(',').filter(|p| !p.is_empty()).collect();
    let inputs = split_inputs(input_value, paths.len());

    let mut responses = Vec::new();
    for (idx, proc_path) in paths.iter().enumerate() {
        let input = inputs.get(idx).cloned().unwrap_or(None);
        let result = dispatch_trpc(&state, proc_path, input).await;
        let response = match result {
            Ok(data) => trpc_ok(data),
            Err(err) => trpc_error(proc_path, &err),
        };
        responses.push(response);
    }

    if is_batch || responses.len() > 1 {
        (StatusCode::OK, axum::Json(Value::Array(responses))).into_response()
    } else {
        (StatusCode::OK, axum::Json(responses.remove(0))).into_response()
    }
}

fn split_inputs(input_value: Option<Value>, count: usize) -> Vec<Option<Value>> {
    if count <= 1 {
        return vec![input_value];
    }

    let mut inputs = vec![None; count];
    match input_value {
        Some(Value::Object(map)) => {
            for idx in 0..count {
                let key = idx.to_string();
                if let Some(value) = map.get(&key) {
                    inputs[idx] = Some(value.clone());
                }
            }
        }
        Some(Value::Array(arr)) => {
            for (idx, value) in arr.into_iter().enumerate().take(count) {
                inputs[idx] = Some(value);
            }
        }
        Some(value) => {
            inputs[0] = Some(value);
        }
        None => {}
    }

    inputs
}

fn trpc_ok(data: Value) -> Value {
    json!({
        "result": {
            "data": data
        }
    })
}

fn trpc_error(path: &str, message: &str) -> Value {
    json!({
        "error": {
            "message": message,
            "code": -32603,
            "data": {
                "code": "INTERNAL_SERVER_ERROR",
                "httpStatus": 500,
                "path": path
            }
        }
    })
}

fn unwrap_input_object(input: Option<Value>) -> serde_json::Map<String, Value> {
    let obj = input.and_then(|v| v.as_object().cloned()).unwrap_or_default();
    if let Some(Value::Object(inner)) = obj.get("json") {
        inner.clone()
    } else {
        obj
    }
}

async fn dispatch_trpc(
    state: &LocalApiContext,
    proc_path: &str,
    input: Option<Value>,
) -> Result<Value, String> {
    if let Some(path) = proc_path.strip_prefix("notes.") {
        return handle_notes(state, path, input).await;
    }
    if let Some(path) = proc_path.strip_prefix("config.") {
        return handle_config(state, path, input).await;
    }
    if let Some(path) = proc_path.strip_prefix("tags.") {
        return handle_tags(state, path, input).await;
    }
    if let Some(path) = proc_path.strip_prefix("attachments.") {
        return handle_attachments(state, path, input).await;
    }
    if let Some(path) = proc_path.strip_prefix("users.") {
        return handle_users(state, path, input).await;
    }
    if let Some(path) = proc_path.strip_prefix("public.") {
        return handle_public(path);
    }
    if let Some(path) = proc_path.strip_prefix("task.") {
        return handle_task(path);
    }
    if let Some(path) = proc_path.strip_prefix("notifications.") {
        return handle_list_or_empty(path);
    }
    if let Some(path) = proc_path.strip_prefix("comments.") {
        return handle_list_or_empty(path);
    }
    if let Some(path) = proc_path.strip_prefix("analytics.") {
        return handle_analytics(path);
    }
    if let Some(path) = proc_path.strip_prefix("ai.") {
        return handle_ai(path);
    }
    if let Some(path) = proc_path.strip_prefix("conversation.") {
        return handle_list_or_empty(path);
    }
    if let Some(path) = proc_path.strip_prefix("message.") {
        return handle_list_or_empty(path);
    }
    if let Some(path) = proc_path.strip_prefix("plugin.") {
        return handle_plugin(path);
    }
    if let Some(path) = proc_path.strip_prefix("follows.") {
        return handle_list_or_empty(path);
    }
    if let Some(path) = proc_path.strip_prefix("mcpServers.") {
        return handle_list_or_empty(path);
    }

    Ok(default_response(proc_path))
}

async fn handle_notes(
    state: &LocalApiContext,
    path: &str,
    input: Option<Value>,
) -> Result<Value, String> {
    let note_repo = NoteRepository::new(state.data_state.db.pool.clone());
    let attachment_repo = AttachmentRepository::new(
        state.data_state.db.pool.clone(),
        state.paths.attachments_dir.clone(),
    );
    let tag_repo = TagRepository::new(state.data_state.db.pool.clone());

    match path {
        "list" => {
            let input_obj = unwrap_input_object(input);
            let page = input_obj.get("page").and_then(as_i64).unwrap_or(1).max(1);
            let size = input_obj.get("size").and_then(as_i64).unwrap_or(30).max(1);
            let is_recycle_filter = input_obj.get("isRecycle").and_then(as_bool).unwrap_or(false);
            let is_archived_filter = input_obj.get("isArchived").and_then(as_bool);
            let note_type_filter = input_obj.get("type").and_then(as_i64);

            let mut notes = note_repo.list_all_notes().await?;
            notes.retain(|note| note.is_recycle == is_recycle_filter);
            if let Some(is_archived) = is_archived_filter {
                notes.retain(|note| note.is_archived == is_archived);
            }
            if let Some(note_type) = note_type_filter {
                notes.retain(|note| note.note_type == note_type);
            }

            let start = ((page - 1) * size) as usize;
            let end = (start + size as usize).min(notes.len());
            let slice = if start < notes.len() { &notes[start..end] } else { &[] };

            let mut items = Vec::new();
            for note in slice.iter() {
                let attachments = attachment_repo.list_for_note(note.id).await.unwrap_or_default();
                let tags = tag_repo.list_relations_for_note(note.id).await.unwrap_or_default();
                items.push(note_to_value(note, &attachments, &tags));
            }
            Ok(Value::Array(items))
        }
        "detail" | "publicDetail" => {
            let id = input
                .as_ref()
                .and_then(|v| v.get("id"))
                .and_then(as_i64)
                .unwrap_or(0);
            if id == 0 {
                return Ok(Value::Null);
            }
            match note_repo.get_note(id).await? {
                Some(note) => {
                    let attachments = attachment_repo.list_for_note(note.id).await.unwrap_or_default();
                    let tags = tag_repo.list_relations_for_note(note.id).await.unwrap_or_default();
                    Ok(note_to_value(&note, &attachments, &tags))
                }
                None => Ok(Value::Null),
            }
        }
        "listByIds" => {
            let ids = input
                .and_then(|v| v.get("ids").cloned())
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default();
            let parsed_ids: Vec<i64> = ids.iter().filter_map(as_i64).collect();
            let notes = note_repo.list_notes_by_ids(&parsed_ids).await?;
            let mut items = Vec::new();
            for note in notes.iter() {
                let attachments = attachment_repo.list_for_note(note.id).await.unwrap_or_default();
                let tags = tag_repo.list_relations_for_note(note.id).await.unwrap_or_default();
                items.push(note_to_value(note, &attachments, &tags));
            }
            Ok(Value::Array(items))
        }
        "upsert" => {
            let input_obj = input.and_then(|v| v.as_object().cloned()).unwrap_or_default();
            let id = input_obj.get("id").and_then(as_i64).unwrap_or(0);
            let content_opt = input_obj
                .get("content")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let title_opt = input_obj
                .get("title")
                .and_then(|v| v.as_str())
                .map(|v| v.to_string());
            let is_archived = input_obj.get("isArchived").and_then(as_bool).unwrap_or(false);
            let is_recycle = input_obj.get("isRecycle").and_then(as_bool).unwrap_or(false);
            let is_share = input_obj.get("isShare").and_then(as_bool).unwrap_or(false);
            let is_top = input_obj.get("isTop").and_then(as_bool).unwrap_or(false);
            let note_type = input_obj.get("type").and_then(as_i64).unwrap_or(0);

            let note = if id == 0 {
                let content = content_opt.clone().unwrap_or_default();
                let title = title_opt
                    .clone()
                    .unwrap_or_else(|| content.lines().next().unwrap_or("").to_string());
                note_repo
                    .create_note(
                        NoteInput {
                            title,
                            content,
                            is_archived,
                            is_recycle,
                            is_share,
                            is_top,
                            note_type,
                        },
                        &state.device_id,
                    )
                    .await?
            } else {
                let existing = note_repo.get_note(id).await?;
                let existing = match existing {
                    Some(note) => note,
                    None => {
                        return Ok(Value::Null);
                    }
                };
                let content = content_opt.clone().unwrap_or_else(|| existing.content.clone());
                let title = title_opt
                    .clone()
                    .unwrap_or_else(|| {
                        if content_opt.is_some() {
                            content.lines().next().unwrap_or("").to_string()
                        } else {
                            existing.title.clone()
                        }
                    });
                let payload = NoteInput {
                    title,
                    content,
                    is_archived: input_obj.get("isArchived").and_then(as_bool).unwrap_or(existing.is_archived),
                    is_recycle: input_obj.get("isRecycle").and_then(as_bool).unwrap_or(existing.is_recycle),
                    is_share: input_obj.get("isShare").and_then(as_bool).unwrap_or(existing.is_share),
                    is_top: input_obj.get("isTop").and_then(as_bool).unwrap_or(existing.is_top),
                    note_type: input_obj.get("type").and_then(as_i64).unwrap_or(existing.note_type),
                };
                note_repo
                    .update_note(id, payload, &state.device_id)
                    .await?
                    .unwrap_or(existing)
            };

            if let Some(Value::Array(attachments)) = input_obj.get("attachments") {
                for attachment in attachments.iter() {
                    if let Some(id) = attachment.get("id").and_then(as_i64) {
                        let _ = attachment_repo.assign_note(id, note.id).await;
                        continue;
                    }
                    if let Some(path) = attachment.get("path").and_then(|v| v.as_str()) {
                        if let Some(id_str) = path.strip_prefix("/api/file/") {
                            if let Ok(parsed) = id_str.parse::<i64>() {
                                let _ = attachment_repo.assign_note(parsed, note.id).await;
                            }
                        }
                    }
                }
            }

            let tag_names = extract_tag_names(&note.content);
            let _ = tag_repo.set_note_tags_by_names(note.id, &tag_names).await;

            let attachments = attachment_repo.list_for_note(note.id).await.unwrap_or_default();
            let tags = tag_repo.list_relations_for_note(note.id).await.unwrap_or_default();
            Ok(note_to_value(&note, &attachments, &tags))
        }
        "deleteMany" | "trashMany" => {
            let ids = input
                .and_then(|v| v.get("ids").cloned())
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default();
            for id in ids.iter().filter_map(as_i64) {
                let _ = note_repo.delete_note(id, &state.device_id).await;
            }
            Ok(json!({ "ok": true }))
        }
        "updateMany" => {
            let input_obj = input.and_then(|v| v.as_object().cloned()).unwrap_or_default();
            let ids = input_obj
                .get("ids")
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default();
            for id in ids.iter().filter_map(as_i64) {
                if let Some(existing) = note_repo.get_note(id).await? {
                    let payload = NoteInput {
                        title: input_obj
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&existing.title)
                            .to_string(),
                        content: input_obj
                            .get("content")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&existing.content)
                            .to_string(),
                        is_archived: input_obj.get("isArchived").and_then(as_bool).unwrap_or(existing.is_archived),
                        is_recycle: input_obj.get("isRecycle").and_then(as_bool).unwrap_or(existing.is_recycle),
                        is_share: input_obj.get("isShare").and_then(as_bool).unwrap_or(existing.is_share),
                        is_top: input_obj.get("isTop").and_then(as_bool).unwrap_or(existing.is_top),
                        note_type: input_obj.get("type").and_then(as_i64).unwrap_or(existing.note_type),
                    };
                    if let Some(updated) = note_repo.update_note(id, payload, &state.device_id).await? {
                        let tag_names = extract_tag_names(&updated.content);
                        let _ = tag_repo.set_note_tags_by_names(updated.id, &tag_names).await;
                    }
                }
            }
            Ok(json!({ "ok": true }))
        }
        "updateNotesOrder" | "updateAttachmentsOrder" => Ok(json!({ "ok": true })),
        "clearRecycleBin" => {
            sqlx::query("DELETE FROM notes WHERE is_recycle = 1")
                .execute(&state.data_state.db.pool)
                .await
                .map_err(|e| format!("Failed to clear recycle bin: {e}"))?;
            Ok(json!({ "ok": true }))
        }
        "noteReferenceList" | "relatedNotes" | "getNoteHistory" => Ok(Value::Array(vec![])),
        "randomNoteList" | "dailyReviewNoteList" | "publicList" => Ok(Value::Array(vec![])),
        "shareNote" | "internalShareNote" | "reviewNote" => Ok(json!({ "ok": true })),
        "getInternalSharedUsers" => Ok(Value::Array(vec![])),
        _ => Ok(default_response(path)),
    }
}

async fn handle_config(
    state: &LocalApiContext,
    path: &str,
    input: Option<Value>,
) -> Result<Value, String> {
    let repo = SettingsRepository::new(state.data_state.db.pool.clone());

    match path {
        "list" => {
            let settings = repo.list_all().await?;
            let mut map = serde_json::Map::new();
            for setting in settings {
                let parsed = serde_json::from_str::<Value>(&setting.value)
                    .unwrap_or_else(|_| Value::String(setting.value));
                map.insert(setting.key, parsed);
            }
            Ok(Value::Object(map))
        }
        "update" => {
            let input_obj = input.and_then(|v| v.as_object().cloned()).unwrap_or_default();
            let key = input_obj
                .get("key")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let value = input_obj.get("value").cloned().unwrap_or(Value::Null);
            let stored = serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string());
            let setting = repo.set(&key, &stored, &state.device_id).await?;
            Ok(json!({ "key": setting.key, "value": value }))
        }
        _ => Ok(default_response(path)),
    }
}

async fn handle_tags(
    state: &LocalApiContext,
    path: &str,
    input: Option<Value>,
) -> Result<Value, String> {
    let repo = TagRepository::new(state.data_state.db.pool.clone());
    match path {
        "list" => {
            let tags = repo.list_all().await?;
            let items = tags.iter().map(tag_to_value).collect::<Vec<_>>();
            Ok(Value::Array(items))
        }
        "fullTagNameById" => {
            let id = input
                .as_ref()
                .and_then(|v| v.get("id"))
                .and_then(as_i64)
                .unwrap_or(0);
            if id == 0 {
                return Ok(Value::String("".to_string()));
            }
            let tag = repo.get_by_id(id).await?;
            Ok(tag
                .map(|t| Value::String(format!("#{}", t.name)))
                .unwrap_or_else(|| Value::String("".to_string())))
        }
        "updateTagMany" => {
            let input_obj = input.and_then(|v| v.as_object().cloned()).unwrap_or_default();
            let ids = input_obj
                .get("ids")
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default();
            let tag_raw = input_obj
                .get("tag")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if tag_raw.trim().is_empty() {
                return Ok(Value::Bool(true));
            }
            let note_ids: Vec<i64> = ids.iter().filter_map(as_i64).collect();
            let tag = repo.upsert_tag_by_name(tag_raw).await?;

            let note_repo = NoteRepository::new(state.data_state.db.pool.clone());
            for note_id in note_ids {
                if let Some(note) = note_repo.get_note(note_id).await? {
                    let tag_token = format!("#{}", tag.name);
                    let new_content = if note.content.contains(&tag_token) {
                        note.content.clone()
                    } else if note.content.trim().is_empty() {
                        tag_token.clone()
                    } else {
                        format!("{} {}", note.content, tag_token)
                    };
                    let payload = note_to_input(&note, new_content.clone());
                    if let Some(updated) = note_repo.update_note(note.id, payload, &state.device_id).await? {
                        let tag_names = extract_tag_names(&updated.content);
                        let _ = repo.set_note_tags_by_names(updated.id, &tag_names).await;
                    }
                }
            }

            Ok(Value::Bool(true))
        }
        "updateTagName" => {
            let input_obj = input.and_then(|v| v.as_object().cloned()).unwrap_or_default();
            let id = input_obj.get("id").and_then(as_i64).unwrap_or(0);
            let old_name = input_obj
                .get("oldName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let new_name = input_obj
                .get("newName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if id == 0 || new_name.trim().is_empty() {
                return Ok(Value::Bool(true));
            }

            let tag = repo.update_tag_name(id, &new_name).await?;
            let note_ids = repo.list_note_ids_for_tag(id).await?;
            let note_repo = NoteRepository::new(state.data_state.db.pool.clone());
            for note_id in note_ids {
                if let Some(note) = note_repo.get_note(note_id).await? {
                    let updated_content = if old_name.trim().is_empty() {
                        note.content.clone()
                    } else {
                        note.content.replace(&format!("#{}", old_name), &format!("#{}", tag.name))
                    };
                    let payload = note_to_input(&note, updated_content.clone());
                    if let Some(updated) = note_repo.update_note(note.id, payload, &state.device_id).await? {
                        let tag_names = extract_tag_names(&updated.content);
                        let _ = repo.set_note_tags_by_names(updated.id, &tag_names).await;
                    }
                }
            }
            Ok(Value::Bool(true))
        }
        "updateTagIcon" => {
            let input_obj = input.and_then(|v| v.as_object().cloned()).unwrap_or_default();
            let id = input_obj.get("id").and_then(as_i64).unwrap_or(0);
            let icon = input_obj
                .get("icon")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if id == 0 {
                return Ok(Value::Null);
            }
            let tag = repo.update_tag_icon(id, icon.as_deref()).await?;
            Ok(tag_to_value(&tag))
        }
        "updateTagOrder" => {
            let input_obj = input.and_then(|v| v.as_object().cloned()).unwrap_or_default();
            let id = input_obj.get("id").and_then(as_i64).unwrap_or(0);
            let sort_order = input_obj.get("sortOrder").and_then(as_i64).unwrap_or(0);
            if id == 0 {
                return Ok(Value::Null);
            }
            let tag = repo.update_tag_order(id, sort_order).await?;
            Ok(tag_to_value(&tag))
        }
        "deleteOnlyTag" => {
            let id = input
                .as_ref()
                .and_then(|v| v.get("id"))
                .and_then(as_i64)
                .unwrap_or(0);
            if id == 0 {
                return Ok(Value::Bool(true));
            }
            let tag = repo.get_by_id(id).await?;
            let Some(tag) = tag else {
                return Ok(Value::Bool(true));
            };
            let note_ids = repo.list_note_ids_for_tag(id).await?;
            let note_repo = NoteRepository::new(state.data_state.db.pool.clone());
            for note_id in note_ids {
                if let Some(note) = note_repo.get_note(note_id).await? {
                    let updated_content = note.content.replace(&format!("#{}", tag.name), "");
                    let payload = note_to_input(&note, updated_content.clone());
                    if let Some(updated) = note_repo.update_note(note.id, payload, &state.device_id).await? {
                        let tag_names = extract_tag_names(&updated.content);
                        let _ = repo.set_note_tags_by_names(updated.id, &tag_names).await;
                    }
                }
            }
            repo.delete_tag(id).await?;
            Ok(Value::Bool(true))
        }
        "deleteTagWithAllNote" => {
            let id = input
                .as_ref()
                .and_then(|v| v.get("id"))
                .and_then(as_i64)
                .unwrap_or(0);
            if id == 0 {
                return Ok(Value::Bool(true));
            }
            let note_ids = repo.list_note_ids_for_tag(id).await?;
            let note_repo = NoteRepository::new(state.data_state.db.pool.clone());
            for note_id in note_ids {
                let _ = note_repo.delete_note(note_id, &state.device_id).await;
            }
            repo.delete_tag(id).await?;
            Ok(Value::Bool(true))
        }
        _ => Ok(json!({ "ok": true })),
    }
}

async fn handle_attachments(
    state: &LocalApiContext,
    path: &str,
    input: Option<Value>,
) -> Result<Value, String> {
    let repo = AttachmentRepository::new(
        state.data_state.db.pool.clone(),
        state.paths.attachments_dir.clone(),
    );

    match path {
        "list" => {
            let attachments = repo.list_all().await?;
            let items = attachments
                .iter()
                .map(attachment_to_value)
                .collect::<Vec<_>>();
            Ok(Value::Array(items))
        }
        "delete" => {
            let id = input
                .as_ref()
                .and_then(|v| v.get("id"))
                .and_then(as_i64)
                .unwrap_or(0);
            if id > 0 {
                let _ = repo.delete_attachment(id).await;
            }
            Ok(json!({ "ok": true }))
        }
        "deleteMany" => {
            let ids = input
                .and_then(|v| v.get("ids").cloned())
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default();
            for id in ids.iter().filter_map(as_i64) {
                let _ = repo.delete_attachment(id).await;
            }
            Ok(json!({ "ok": true }))
        }
        _ => Ok(json!({ "ok": true })),
    }
}

async fn handle_users(
    state: &LocalApiContext,
    path: &str,
    input: Option<Value>,
) -> Result<Value, String> {
    let repo = SettingsRepository::new(state.data_state.db.pool.clone());
    let existing = local_user::load_local_user(&repo).await?;
    match path {
        "canRegister" => Ok(Value::Bool(existing.is_none())),
        "register" => {
            if existing.is_some() {
                return Err("Local account already exists".to_string());
            }
            let payload = unwrap_input_object(input);
            let name = payload
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let password = payload
                .get("password")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let _ = local_user::create_local_user(&repo, &state.device_id, &name, &password).await?;
            Ok(json!({ "ok": true }))
        }
        "detail" => {
            let record = existing.ok_or_else(|| "Local account not found".to_string())?;
            Ok(serde_json::to_value(record.to_public()).unwrap_or(json!({})))
        }
        "list" => {
            let record = existing.ok_or_else(|| "Local account not found".to_string())?;
            Ok(Value::Array(vec![
                serde_json::to_value(record.to_public()).unwrap_or(json!({}))
            ]))
        }
        "upsertUser" | "upsertUserByAdmin" => {
            let record = existing.ok_or_else(|| "Local account not found".to_string())?;
            let payload = unwrap_input_object(input);
            let update = local_user::LocalUserUpdate {
                name: payload.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                nickname: payload.get("nickname").and_then(|v| v.as_str()).map(|s| s.to_string()),
                password: payload.get("password").and_then(|v| v.as_str()).map(|s| s.to_string()),
                image: payload.get("image").and_then(|v| v.as_str()).map(|s| s.to_string()),
                role: payload.get("role").and_then(|v| v.as_str()).map(|s| s.to_string()),
            };
            let _ = local_user::update_local_user(&repo, &state.device_id, &record, update).await?;
            Ok(json!({ "ok": true }))
        }
        "deleteUser" => {
            if existing.is_some() {
                local_user::clear_local_user(&repo).await?;
            }
            Ok(json!({ "ok": true }))
        }
        "regenToken"
        | "genLowPermToken"
        | "generate2FASecret"
        | "verify2FAToken"
        | "linkAccount"
        | "unlinkAccount" => Ok(json!({ "ok": true })),
        "nativeAccountList" | "publicUserList" => Ok(Value::Array(vec![])),
        _ => Ok(default_response(path)),
    }
}

fn handle_public(path: &str) -> Result<Value, String> {
    match path {
        "oauthProviders" => Ok(Value::Array(vec![])),
        "serverVersion" | "latestServerVersion" | "latestClientVersion" => Ok(Value::String("local".to_string())),
        "hubSiteList" => Ok(Value::Array(vec![])),
        "siteInfo" => Ok(json!({})),
        "linkPreview" => Ok(json!({})),
        "musicMetadata" => Ok(json!({})),
        "testHttpProxy" => Ok(json!({ "ok": true })),
        _ => Ok(default_response(path)),
    }
}

fn handle_task(path: &str) -> Result<Value, String> {
    match path {
        "list" => Ok(Value::Array(vec![])),
        "upsertTask" | "exportMarkdown" => Ok(json!({ "ok": true })),
        _ => Ok(default_response(path)),
    }
}

fn handle_analytics(path: &str) -> Result<Value, String> {
    match path {
        "dailyNoteCount" | "monthlyStats" => Ok(Value::Array(vec![])),
        _ => Ok(default_response(path)),
    }
}

fn handle_ai(path: &str) -> Result<Value, String> {
    match path {
        "rebuildEmbeddingProgress" => Ok(json!({ "progress": 0, "total": 0 })),
        "rebuildEmbeddingStart" | "rebuildEmbeddingStop" | "testConnect" => Ok(json!({ "ok": true })),
        "getAllModels" | "getAllProviders" => Ok(Value::Array(vec![])),
        "createModel" | "updateModel" | "deleteModel" | "createProvider" | "updateProvider" | "deleteProvider" | "createModelsFromProvider" => Ok(json!({ "ok": true })),
        "embeddingDelete" | "autoEmoji" | "autoTag" | "summarizeConversationTitle" => Ok(json!({ "ok": true })),
        _ => Ok(default_response(path)),
    }
}

fn handle_plugin(path: &str) -> Result<Value, String> {
    match path {
        "getAllPlugins" | "getInstalledPlugins" => Ok(Value::Array(vec![])),
        "getPluginCssContents" => Ok(Value::String("".to_string())),
        "installPlugin" | "uninstallPlugin" | "saveAdditionalDevFile" | "saveDevPlugin" => Ok(json!({ "ok": true })),
        _ => Ok(default_response(path)),
    }
}

fn handle_list_or_empty(path: &str) -> Result<Value, String> {
    if path.ends_with("Count") || path.ends_with("count") {
        return Ok(Value::Number(serde_json::Number::from(0)));
    }
    Ok(Value::Array(vec![]))
}

fn default_response(path: &str) -> Value {
    if path.ends_with("list") || path.ends_with("List") {
        return Value::Array(vec![]);
    }
    if path.ends_with("detail") || path.ends_with("Detail") {
        return Value::Null;
    }
    json!({ "ok": true })
}

fn note_to_input(note: &Note, content: String) -> NoteInput {
    NoteInput {
        title: note.title.clone(),
        content,
        is_archived: note.is_archived,
        is_recycle: note.is_recycle,
        is_share: note.is_share,
        is_top: note.is_top,
        note_type: note.note_type,
    }
}

fn note_to_value(
    note: &Note,
    attachments: &[crate::local_db::attachments::Attachment],
    tags: &[TagRelation],
) -> Value {
    json!({
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "createdAt": note.created_at.to_rfc3339(),
        "updatedAt": note.updated_at.to_rfc3339(),
        "deletedAt": note.deleted_at.map(|d| d.to_rfc3339()),
        "rev": note.rev,
        "isArchived": note.is_archived,
        "isRecycle": note.is_recycle,
        "isShare": note.is_share,
        "isTop": note.is_top,
        "type": note.note_type,
        "attachments": attachments.iter().map(attachment_to_value).collect::<Vec<_>>(),
        "tags": tags.iter().map(tag_relation_to_value).collect::<Vec<_>>(),
        "references": [],
        "referencedBy": [],
        "comments": [],
        "metadata": {},
        "_count": { "comments": 0, "histories": 0 },
        "owner": null,
        "isSharedNote": false,
        "canEdit": true,
        "isInternalShared": false
    })
}

fn attachment_to_value(att: &crate::local_db::attachments::Attachment) -> Value {
    json!({
        "id": att.id,
        "noteId": att.note_id,
        "name": att.filename,
        "path": format!("/api/file/{}", att.id),
        "type": att.mime,
        "size": att.size,
        "createdAt": att.created_at.to_rfc3339(),
        "updatedAt": att.updated_at.to_rfc3339()
    })
}

fn tag_to_value(tag: &Tag) -> Value {
    json!({
        "id": tag.id,
        "name": tag.name,
        "icon": tag.icon.clone().unwrap_or_default(),
        "parent": 0,
        "sortOrder": tag.sort_order,
        "createdAt": tag.created_at.to_rfc3339(),
        "updatedAt": tag.updated_at.to_rfc3339()
    })
}

fn tag_relation_to_value(rel: &TagRelation) -> Value {
    json!({
        "id": rel.id,
        "noteId": rel.note_id,
        "tagId": rel.tag_id,
        "tag": tag_to_value(&rel.tag)
    })
}

fn as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(num) => num.as_i64().or_else(|| num.as_u64().map(|v| v as i64)),
        Value::String(val) => val.parse::<i64>().ok(),
        _ => None,
    }
}

fn as_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(val) => Some(*val),
        Value::Number(num) => num.as_i64().map(|v| v != 0),
        Value::String(val) => val.parse::<bool>().ok(),
        _ => None,
    }
}
