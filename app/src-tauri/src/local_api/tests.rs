#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{routing::get, Router};
    use reqwest::{Client, multipart};
    use serde_json::Value;
    use tokio::net::TcpListener;
    use uuid::Uuid;

    use crate::local_api::{build_context, start_local_api, local_user};
    use crate::local_db::LocalDb;
    use crate::local_db::settings::SettingsRepository;
    use crate::local_runtime::config::{LocalApiConfig, LocalConfig, LocalMode};
    use crate::local_runtime::paths::RuntimePaths;

    fn temp_paths() -> RuntimePaths {
        let pid = std::process::id();
        // Tests run concurrently; make sure each test uses an isolated DB path.
        let run_id = Uuid::new_v4();
        let root = std::env::temp_dir().join(format!("blinko_local_api_test_{pid}_{run_id}"));
        RuntimePaths::from_root(root)
    }

    async fn start_mock_plugin_marketplace() -> String {
        let app = Router::new().route(
            "/index.json",
            get(|| async {
                axum::Json(serde_json::json!([{
                    "name": "mock-plugin",
                    "author": "test",
                    "url": "https://example.invalid/mock-plugin",
                    "version": "1.0.0",
                    "minAppVersion": "0.0.0",
                    "displayName": { "default": "Mock Plugin" },
                    "description": { "default": "A test plugin entry" }
                }]))
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        format!("http://127.0.0.1:{port}/index.json")
    }

    #[tokio::test]
    async fn health_and_notes_flow() {
        let paths = temp_paths();
        paths.ensure_dirs().unwrap();
        let db = LocalDb::connect(&paths).await.unwrap();
        let config = LocalConfig {
            schema_version: 1,
            mode: LocalMode::Local,
            device_id: Some("device-test".to_string()),
            remote_endpoints: vec![],
            allow_insecure_http: false,
            local_api: LocalApiConfig {
                port: None,
                enabled: true,
                token: Some("test-token".to_string()),
            },
        };

        let data_state = crate::local_runtime::LocalDataState::new(db.clone(), config.clone(), paths.clone());
        let settings_repo = SettingsRepository::new(db.pool.clone());
        local_user::create_local_user(&settings_repo, "device-test", "a", "b")
            .await
            .unwrap();
        let plugin_marketplace_url = start_mock_plugin_marketplace().await;
        let context = build_context(
            paths.clone(),
            &config,
            db,
            data_state,
            None,
            Some(plugin_marketplace_url),
        )
        .unwrap();
        let port = start_local_api(Arc::clone(&context)).await.unwrap();
        let base = format!("http://127.0.0.1:{port}");

        let client = Client::new();
        let health = client.get(format!("{base}/health")).send().await.unwrap();
        assert!(health.status().is_success());

        let login = client
            .post(format!("{base}/api/auth/login"))
            .json(&serde_json::json!({ "username": "a", "password": "b" }))
            .send()
            .await
            .unwrap();
        assert!(login.status().is_success());
        let login_body: Value = login.json().await.unwrap();
        let token = login_body.get("token").and_then(|v| v.as_str()).unwrap();

        let marketplace = client
            .get(format!("{base}/api/trpc/plugin.getAllPlugins"))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .unwrap();
        assert!(marketplace.status().is_success());
        let marketplace_body: Value = marketplace.json().await.unwrap();
        let entries = marketplace_body
            .pointer("/result/data")
            .and_then(|v| v.as_array())
            .unwrap();
        assert!(!entries.is_empty());

        let note = client
            .post(format!("{base}/api/notes"))
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "title": "hello", "content": "world" }))
            .send()
            .await
            .unwrap();
        assert_eq!(note.status(), 201);

        let list = client
            .get(format!("{base}/api/notes"))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .unwrap();
        assert!(list.status().is_success());

        let file_bytes = b"hello-world".to_vec();
        let form = multipart::Form::new().part(
            "file",
            multipart::Part::bytes(file_bytes.clone())
                .file_name("hello.txt")
                .mime_str("text/plain")
                .unwrap(),
        );
        let upload = client
            .post(format!("{base}/api/file/upload"))
            .header("Authorization", format!("Bearer {token}"))
            .multipart(form)
            .send()
            .await
            .unwrap();
        assert!(upload.status().is_success());
        let upload_body: Value = upload.json().await.unwrap();
        let file_path = upload_body.get("filePath").and_then(|v| v.as_str()).unwrap();

        let download = client
            .get(format!("{base}{file_path}"))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .unwrap();
        assert!(download.status().is_success());
        let downloaded = download.bytes().await.unwrap();
        assert_eq!(downloaded.as_ref(), file_bytes.as_slice());

        // Regression: `<img src=...>` cannot send Authorization headers, so allow `?token=...`.
        let download_by_query = client
            .get(format!("{base}{file_path}?token={token}"))
            .send()
            .await
            .unwrap();
        assert!(download_by_query.status().is_success());
        let downloaded_by_query = download_by_query.bytes().await.unwrap();
        assert_eq!(downloaded_by_query.as_ref(), file_bytes.as_slice());
    }

    #[tokio::test]
    async fn trpc_notes_list_filters_by_tag_id() {
        let paths = temp_paths();
        paths.ensure_dirs().unwrap();
        let db = LocalDb::connect(&paths).await.unwrap();
        let config = LocalConfig {
            schema_version: 1,
            mode: LocalMode::Local,
            device_id: Some("device-test".to_string()),
            remote_endpoints: vec![],
            allow_insecure_http: false,
            local_api: LocalApiConfig {
                port: None,
                enabled: true,
                token: Some("test-token".to_string()),
            },
        };

        let data_state = crate::local_runtime::LocalDataState::new(db.clone(), config.clone(), paths.clone());
        let settings_repo = SettingsRepository::new(db.pool.clone());
        local_user::create_local_user(&settings_repo, "device-test", "a", "b")
            .await
            .unwrap();
        let context = build_context(paths.clone(), &config, db, data_state, None, None).unwrap();
        let port = start_local_api(Arc::clone(&context)).await.unwrap();
        let base = format!("http://127.0.0.1:{port}");

        let client = Client::new();
        let login = client
            .post(format!("{base}/api/auth/login"))
            .json(&serde_json::json!({ "username": "a", "password": "b" }))
            .send()
            .await
            .unwrap();
        assert!(login.status().is_success());
        let login_body: Value = login.json().await.unwrap();
        let token = login_body.get("token").and_then(|v| v.as_str()).unwrap();

        // Create two notes with different tags.
        let note1 = client
            .post(format!("{base}/api/notes"))
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "title": "n1", "content": "hello #Cuisine" }))
            .send()
            .await
            .unwrap();
        assert_eq!(note1.status(), 201);

        let note2 = client
            .post(format!("{base}/api/notes"))
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "title": "n2", "content": "hello #Jeux" }))
            .send()
            .await
            .unwrap();
        assert_eq!(note2.status(), 201);

        // Fetch tags and find the "Cuisine" tag id.
        let tags = client
            .get(format!("{base}/api/trpc/tags.list"))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .unwrap();
        assert!(tags.status().is_success());
        let tags_body: Value = tags.json().await.unwrap();
        let tags_arr = tags_body
            .pointer("/result/data")
            .and_then(|v| v.as_array())
            .unwrap();
        let cuisine_id = tags_arr
            .iter()
            .find(|t| t.get("name").and_then(|v| v.as_str()) == Some("Cuisine"))
            .and_then(|t| t.get("id").and_then(|v| v.as_i64()))
            .unwrap();

        // Call notes.list with tagId and expect only the matching note.
        let input = serde_json::json!({ "json": { "page": 1, "size": 30, "isRecycle": false, "type": -1, "tagId": cuisine_id } });
        let list = client
            .get(format!("{base}/api/trpc/notes.list"))
            .header("Authorization", format!("Bearer {token}"))
            .query(&[("input", input.to_string())])
            .send()
            .await
            .unwrap();
        assert!(list.status().is_success());
        let list_body: Value = list.json().await.unwrap();
        let notes_arr = list_body
            .pointer("/result/data")
            .and_then(|v| v.as_array())
            .unwrap();
        assert_eq!(notes_arr.len(), 1);
        let content = notes_arr[0].get("content").and_then(|v| v.as_str()).unwrap_or("");
        assert!(content.contains("#Cuisine"));
    }
}
