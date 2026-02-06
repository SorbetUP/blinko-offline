#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use desktop::*;
pub mod local_runtime;
pub mod local_db;
pub mod local_api;
pub mod local_commands;
pub mod local_analytics;
pub mod sync;
use std::time::Duration;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_blinko::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
                // Called when a second instance tries to start
                println!("Second instance detected with args: {:?} and cwd: {:?}", args, cwd);

                // Show and focus the existing window
                if let Some(window) = app.get_webview_window("main") {
                    // Show window if it's hidden
                    if let Err(e) = window.show() {
                        eprintln!("Failed to show window: {}", e);
                    }

                    // Unminimize if minimized
                    if let Err(e) = window.unminimize() {
                        eprintln!("Failed to unminimize window: {}", e);
                    }

                    // Bring to front and focus
                    if let Err(e) = window.set_focus() {
                        eprintln!("Failed to focus window: {}", e);
                    }

                    println!("Focused existing Blinko window");
                }
            }))
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(create_global_shortcut_handler())
                    .build()
            );
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder
            .invoke_handler(tauri::generate_handler![
                local_runtime::get_local_runtime_info,
                local_api::get_local_api_base_url,
                local_commands::notes_list,
                local_commands::note_get,
                local_commands::note_upsert,
                local_commands::note_delete,
                local_commands::analytics_daily_note_count,
                local_commands::analytics_monthly_stats,
                sync::scheduler::sync_now,
                sync::migration::import_remote_to_local_cmd,
                sync::migration::export_local_to_remote_cmd,
                toggle_editor_window,
                register_hotkey,
                unregister_hotkey,
                get_registered_shortcuts,
                toggle_quicknote_window,
                resize_quicknote_window,
                toggle_quickai_window,
                resize_quickai_window,
                navigate_main_to_ai_with_prompt,
                toggle_quicktool_window,
                hide_quicktool_window,
                setup_text_selection_monitoring,
                copy_to_clipboard,
                test_text_selection,
                check_accessibility_permissions,
                show_quicktool,
                set_desktop_theme,
                set_desktop_colors
            ])
            .setup(|app| {
                let runtime_info = match local_runtime::init_local_runtime(&app.handle()) {
                    Ok(info) => info,
                    Err(err) => {
                        eprintln!("init_local_runtime failed: {err}");
                        let paths = local_runtime::paths::RuntimePaths::from_root(std::env::temp_dir().join("blinko"));
                        let config = local_runtime::config::LocalConfig::default();
                        local_runtime::LocalRuntimeInfo::new(paths, &config)
                    }
                };

                app.manage(local_runtime::LocalRuntimeState::new(runtime_info));
                let runtime_state = app.state::<local_runtime::LocalRuntimeState>();
                let info = runtime_state.snapshot();

                let config = match local_runtime::config::load_config(&info.paths) {
                    Ok(c) => c,
                    Err(err) => {
                        eprintln!("load_config failed: {err}");
                        local_runtime::config::LocalConfig::default()
                    }
                };

                let db = match tauri::async_runtime::block_on(async {
                    local_db::LocalDb::connect(&info.paths).await
                }) {
                    Ok(db) => db,
                    Err(err) => {
                        eprintln!("LocalDb::connect failed: {err}");
                        setup_app(app)?;
                        return Ok(());
                    }
                };

                let data_state = local_runtime::LocalDataState::new(db.clone(), config.clone(), info.paths.clone());
                app.manage(data_state.clone());

                let vditor_root = local_api::resolve_vditor_root(&app.handle());
                let context = local_api::build_context(
                    info.paths.clone(),
                    &config,
                    db.clone(),
                    data_state.clone(),
                    vditor_root,
                    None,
                ).ok();
                let handle = app.handle().clone();

                tauri::async_runtime::spawn(async move {
                    sync::scheduler::start_sync_scheduler(data_state.clone(), Duration::from_secs(300));

                    if let Some(context) = context {
                        match local_api::start_local_api(context).await {
                            Ok(port) => {
                                handle.state::<local_runtime::LocalRuntimeState>().set_api_port(port);
                            }
                            Err(err) => {
                                eprintln!("start_local_api failed: {err}");
                            }
                        }
                    } else {
                        eprintln!("Local API context missing (token/device_id).");
                    }
                });

                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    use tauri_plugin_autostart::MacosLauncher;

                    let _ = app.handle().plugin(tauri_plugin_autostart::init(
                        MacosLauncher::LaunchAgent,
                        Some(vec!["--autostart"]),
                    ));
                }

                setup_app(app)?;
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        builder
            .invoke_handler(tauri::generate_handler![
                local_runtime::get_local_runtime_info,
                local_api::get_local_api_base_url,
                local_commands::notes_list,
                local_commands::note_get,
                local_commands::note_upsert,
                local_commands::note_delete,
                sync::scheduler::sync_now,
                sync::migration::import_remote_to_local_cmd,
                sync::migration::export_local_to_remote_cmd
            ])
            .setup(|app| {
                let runtime_info = match local_runtime::init_local_runtime(&app.handle()) {
                    Ok(info) => info,
                    Err(err) => {
                        eprintln!("init_local_runtime failed: {err}");
                        let paths = local_runtime::paths::RuntimePaths::from_root(std::env::temp_dir().join("blinko"));
                        let config = local_runtime::config::LocalConfig::default();
                        local_runtime::LocalRuntimeInfo::new(paths, &config)
                    }
                };

                app.manage(local_runtime::LocalRuntimeState::new(runtime_info));
                let runtime_state = app.state::<local_runtime::LocalRuntimeState>();
                let info = runtime_state.snapshot();

                let config = match local_runtime::config::load_config(&info.paths) {
                    Ok(c) => c,
                    Err(err) => {
                        eprintln!("load_config failed: {err}");
                        local_runtime::config::LocalConfig::default()
                    }
                };

                let db = match tauri::async_runtime::block_on(async {
                    local_db::LocalDb::connect(&info.paths).await
                }) {
                    Ok(db) => db,
                    Err(err) => {
                        eprintln!("LocalDb::connect failed: {err}");
                        return Ok(());
                    }
                };

                let data_state = local_runtime::LocalDataState::new(db.clone(), config.clone(), info.paths.clone());
                app.manage(data_state.clone());

                let vditor_root = local_api::resolve_vditor_root(&app.handle());
                let context = local_api::build_context(
                    info.paths.clone(),
                    &config,
                    db.clone(),
                    data_state.clone(),
                    vditor_root,
                    None,
                ).ok();
                let handle = app.handle().clone();

                tauri::async_runtime::spawn(async move {
                    sync::scheduler::start_sync_scheduler(data_state.clone(), Duration::from_secs(300));

                    if let Some(context) = context {
                        match local_api::start_local_api(context).await {
                            Ok(port) => {
                                handle.state::<local_runtime::LocalRuntimeState>().set_api_port(port);
                            }
                            Err(err) => {
                                eprintln!("start_local_api failed: {err}");
                            }
                        }
                    } else {
                        eprintln!("Local API context missing (token/device_id).");
                    }
                });

                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
