#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use reqwest::{Client, multipart};
    use serde_json::Value;

    use crate::local_api::{build_context, start_local_api, local_user};
    use crate::local_db::LocalDb;
    use crate::local_db::settings::SettingsRepository;
    use crate::local_runtime::config::{LocalApiConfig, LocalConfig, LocalMode};
    use crate::local_runtime::paths::RuntimePaths;

    fn temp_paths() -> RuntimePaths {
        let pid = std::process::id();
        let root = std::env::temp_dir().join(format!("blinko_local_api_test_{pid}"));
        RuntimePaths::from_root(root)
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
        let context = build_context(paths.clone(), &config, db, data_state, None).unwrap();
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
    }
}
