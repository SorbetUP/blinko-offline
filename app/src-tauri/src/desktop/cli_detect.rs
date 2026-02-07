use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct CliBinaryInfo {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiCliDetectResult {
    pub codex: CliBinaryInfo,
    pub claude: CliBinaryInfo,
}

fn home_dir() -> Option<PathBuf> {
    if let Ok(h) = std::env::var("HOME") {
        if !h.trim().is_empty() {
            return Some(PathBuf::from(h));
        }
    }
    if let Ok(h) = std::env::var("USERPROFILE") {
        if !h.trim().is_empty() {
            return Some(PathBuf::from(h));
        }
    }
    None
}

fn split_path_env() -> Vec<PathBuf> {
    let Some(paths) = std::env::var_os("PATH") else {
        return Vec::new();
    };
    std::env::split_paths(&paths).collect()
}

fn candidate_filenames(base: &str) -> Vec<String> {
    if cfg!(windows) {
        // Windows PATH resolution may match cmd/bat shims.
        let mut out = Vec::new();
        out.push(format!("{base}.exe"));
        out.push(format!("{base}.cmd"));
        out.push(format!("{base}.bat"));
        out.push(base.to_string());
        out
    } else {
        vec![base.to_string()]
    }
}

fn is_probably_executable(path: &Path) -> bool {
    if !path.exists() || !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(md) = std::fs::metadata(path) {
            return (md.permissions().mode() & 0o111) != 0;
        }
    }
    true
}

fn find_in_path(base: &str) -> Option<PathBuf> {
    for dir in split_path_env() {
        for name in candidate_filenames(base) {
            let p = dir.join(&name);
            if is_probably_executable(&p) {
                return Some(p);
            }
        }
    }
    None
}

fn find_first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    for p in candidates {
        if is_probably_executable(p) {
            return Some(p.to_path_buf());
        }
    }
    None
}

async fn try_version(bin: &Path, args: &[&str]) -> Result<Option<String>, String> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let out = tokio::time::timeout(Duration::from_secs(3), cmd.output())
        .await
        .map_err(|_| "Timed out".to_string())?
        .map_err(|e| e.to_string())?;

    let mut text = String::new();
    if !out.stdout.is_empty() {
        text.push_str(&String::from_utf8_lossy(&out.stdout));
    }
    if text.trim().is_empty() && !out.stderr.is_empty() {
        text.push_str(&String::from_utf8_lossy(&out.stderr));
    }
    let line = text.lines().next().unwrap_or("").trim().to_string();
    Ok(if line.is_empty() { None } else { Some(line) })
}

async fn detect_one(name: &str, explicit_candidates: Vec<PathBuf>) -> CliBinaryInfo {
    let found_path = find_first_existing(&explicit_candidates).or_else(|| find_in_path(name));
    let Some(bin) = found_path else {
        return CliBinaryInfo {
            found: false,
            path: None,
            version: None,
            error: Some("Not found in PATH".to_string()),
        };
    };

    let version = match try_version(&bin, &["--version"]).await {
        Ok(v) if v.is_some() => v,
        _ => {
            // Some CLIs use `version` subcommand.
            try_version(&bin, &["version"]).await.ok().flatten()
        }
    };

    CliBinaryInfo {
        found: true,
        path: Some(bin.to_string_lossy().to_string()),
        version,
        error: None,
    }
}

#[tauri::command]
pub async fn detect_ai_cli_binaries() -> Result<AiCliDetectResult, String> {
    let mut claude_candidates = Vec::new();
    if let Some(home) = home_dir() {
        claude_candidates.push(home.join(".local/bin/claude"));
        claude_candidates.push(home.join(".local/bin/claude-code"));
        claude_candidates.push(home.join("bin/claude"));
        claude_candidates.push(home.join("bin/claude-code"));
        claude_candidates.push(home.join(".cargo/bin/claude"));
        claude_candidates.push(home.join(".cargo/bin/claude-code"));
    }

    let mut codex_candidates = Vec::new();
    if let Some(home) = home_dir() {
        codex_candidates.push(home.join(".local/bin/codex"));
        codex_candidates.push(home.join("bin/codex"));
        codex_candidates.push(home.join(".cargo/bin/codex"));
    }

    let codex = detect_one("codex", codex_candidates).await;
    let mut claude = detect_one("claude", claude_candidates).await;
    if !claude.found {
        // Some installs expose the CLI as `claude-code` instead of `claude`.
        claude = detect_one("claude-code", Vec::new()).await;
    }

    Ok(AiCliDetectResult { codex, claude })
}
