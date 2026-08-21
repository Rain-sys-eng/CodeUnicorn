use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::app_paths;

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4"];
const WALLHAVEN_SEARCH_URL: &str = "https://wallhaven.cc/api/v1/search";
const WALLHAVEN_MAX_BYTES: usize = 40 * 1024 * 1024;
const WALLHAVEN_USER_AGENT: &str = "cc-gui-wallpaper/1.0";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportedWorkspaceWallpaper {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) path: String,
    pub(crate) source_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WallpaperMarketSearchQuery {
    pub(crate) query: Option<String>,
    pub(crate) category: Option<String>,
    pub(crate) page: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WallpaperMarketDownloadRequest {
    pub(crate) url: String,
    pub(crate) source_url: String,
    pub(crate) suggested_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WallpaperMarketItem {
    pub(crate) id: String,
    pub(crate) thumb_url: String,
    pub(crate) full_url: String,
    pub(crate) source_url: String,
    pub(crate) resolution: String,
    pub(crate) category: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WallpaperMarketSearchResult {
    pub(crate) page: u32,
    pub(crate) last_page: u32,
    pub(crate) items: Vec<WallpaperMarketItem>,
}

fn file_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

fn wallpaper_kind_from_extension(extension: &str) -> Option<&'static str> {
    if IMAGE_EXTENSIONS.contains(&extension) {
        Some("image")
    } else if VIDEO_EXTENSIONS.contains(&extension) {
        Some("video")
    } else {
        None
    }
}

fn is_safe_local_path(path: &str) -> bool {
    !path.trim().is_empty() && !path.contains('\0') && !path.contains("://")
}

fn canonical_or_absolute(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).or_else(|_| {
        if path.is_absolute() {
            Ok(path.to_path_buf())
        } else {
            Err("Wallpaper path could not be resolved.".to_string())
        }
    })
}

fn ensure_wallpaper_dir() -> Result<PathBuf, String> {
    let dir = app_paths::wallpaper_dir()?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    canonical_or_absolute(&dir)
}

pub(crate) fn import_workspace_wallpaper_from_path(
    source_path: &str,
    wallpaper_dir: &Path,
) -> Result<ImportedWorkspaceWallpaper, String> {
    if !is_safe_local_path(source_path) {
        return Err("Wallpaper path is not a local file.".to_string());
    }
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err("Wallpaper source is not a file.".to_string());
    }
    let extension = file_extension(&source).ok_or_else(|| {
        "Wallpaper file type is not supported.".to_string()
    })?;
    let kind = wallpaper_kind_from_extension(&extension)
        .ok_or_else(|| "Wallpaper file type is not supported.".to_string())?;
    fs::create_dir_all(wallpaper_dir).map_err(|err| err.to_string())?;
    let id = Uuid::new_v4().to_string();
    let destination = wallpaper_dir.join(format!("{id}.{extension}"));
    fs::copy(&source, &destination).map_err(|err| err.to_string())?;
    Ok(ImportedWorkspaceWallpaper {
        id,
        kind: kind.to_string(),
        path: destination.to_string_lossy().into_owned(),
        source_path: source.to_string_lossy().into_owned(),
    })
}

pub(crate) fn remove_workspace_wallpaper_file(
    path: &str,
    wallpaper_dir: &Path,
) -> Result<(), String> {
    if !is_safe_local_path(path) {
        return Err("Wallpaper path is not a local file.".to_string());
    }
    let target = PathBuf::from(path);
    let canonical_dir = canonical_or_absolute(wallpaper_dir)?;
    let canonical_target = canonical_or_absolute(&target)?;
    if !canonical_target.starts_with(&canonical_dir) {
        return Err("Wallpaper path is outside the managed library.".to_string());
    }
    if canonical_target.is_file() {
        fs::remove_file(&canonical_target).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn import_workspace_wallpaper(
    source_path: String,
) -> Result<ImportedWorkspaceWallpaper, String> {
    let wallpaper_dir = ensure_wallpaper_dir()?;
    tokio::task::spawn_blocking(move || {
        import_workspace_wallpaper_from_path(&source_path, &wallpaper_dir)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) async fn remove_workspace_wallpaper(path: String) -> Result<(), String> {
    let wallpaper_dir = ensure_wallpaper_dir()?;
    tokio::task::spawn_blocking(move || {
        remove_workspace_wallpaper_file(&path, &wallpaper_dir)
    })
    .await
    .map_err(|err| err.to_string())?
}

fn wallpaper_preview_mime(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn wallpaper_media_mime(extension: &str) -> Option<&'static str> {
    match wallpaper_kind_from_extension(extension)? {
        "image" => wallpaper_preview_mime(extension),
        "video" => Some("video/mp4"),
        _ => None,
    }
}

fn resolve_managed_wallpaper_file(path: &str, wallpaper_dir: &Path) -> Result<PathBuf, String> {
    if !is_safe_local_path(path) {
        return Err("Wallpaper path is not a local file.".to_string());
    }
    let canonical_dir = canonical_or_absolute(wallpaper_dir)?;
    let canonical_target = canonical_or_absolute(&PathBuf::from(path))?;
    if !canonical_target.starts_with(&canonical_dir) {
        return Err("Wallpaper path is outside the managed library.".to_string());
    }
    if !canonical_target.is_file() {
        return Err("Wallpaper preview is not a file.".to_string());
    }
    Ok(canonical_target)
}

pub(crate) fn read_workspace_wallpaper_preview_from_path(
    path: &str,
    wallpaper_dir: &Path,
) -> Result<String, String> {
    let canonical_target = resolve_managed_wallpaper_file(path, wallpaper_dir)?;
    let extension = file_extension(&canonical_target).ok_or_else(|| {
        "Wallpaper file type is not supported.".to_string()
    })?;
    let mime = wallpaper_preview_mime(&extension)
        .ok_or_else(|| "Wallpaper file type is not supported.".to_string())?;
    let metadata = fs::metadata(&canonical_target).map_err(|err| err.to_string())?;
    if metadata.len() > WALLHAVEN_MAX_BYTES as u64 {
        return Err("Wallpaper file is too large.".to_string());
    }
    let bytes = fs::read(&canonical_target).map_err(|err| err.to_string())?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

pub(crate) fn read_workspace_wallpaper_bytes_from_path(
    path: &str,
    wallpaper_dir: &Path,
) -> Result<Vec<u8>, String> {
    let canonical_target = resolve_managed_wallpaper_file(path, wallpaper_dir)?;
    let extension = file_extension(&canonical_target).ok_or_else(|| {
        "Wallpaper file type is not supported.".to_string()
    })?;
    wallpaper_media_mime(&extension)
        .ok_or_else(|| "Wallpaper file type is not supported.".to_string())?;
    let metadata = fs::metadata(&canonical_target).map_err(|err| err.to_string())?;
    if metadata.len() > WALLHAVEN_MAX_BYTES as u64 {
        return Err("Wallpaper file is too large.".to_string());
    }
    fs::read(&canonical_target).map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) async fn read_workspace_wallpaper_preview(
    path: String,
) -> Result<String, String> {
    let wallpaper_dir = ensure_wallpaper_dir()?;
    tokio::task::spawn_blocking(move || {
        read_workspace_wallpaper_preview_from_path(&path, &wallpaper_dir)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub(crate) async fn read_workspace_wallpaper_bytes(
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let wallpaper_dir = ensure_wallpaper_dir()?;
    let bytes = tokio::task::spawn_blocking(move || {
        read_workspace_wallpaper_bytes_from_path(&path, &wallpaper_dir)
    })
    .await
    .map_err(|err| err.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

fn wallhaven_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(WALLHAVEN_USER_AGENT)
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(4))
        .build()
        .map_err(|err| err.to_string())
}

pub(crate) fn wallhaven_categories(category: Option<&str>) -> &'static str {
    match category.map(str::trim).unwrap_or("all") {
        "general" => "100",
        "anime" => "010",
        "people" => "001",
        _ => "111",
    }
}

pub(crate) fn is_allowed_wallhaven_host(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    host == "wallhaven.cc" || host.ends_with(".wallhaven.cc")
}

pub(crate) fn parse_wallhaven_https_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| {
        "Wallpaper URL is not valid.".to_string()
    })?;
    if url.scheme() != "https" {
        return Err("Wallpaper URL must be HTTPS.".to_string());
    }
    let host = url.host_str().ok_or_else(|| {
        "Wallpaper URL is missing a host.".to_string()
    })?;
    if !is_allowed_wallhaven_host(host) {
        return Err("Wallpaper URL is not a Wallhaven address.".to_string());
    }
    Ok(url)
}

pub(crate) fn wallhaven_source_url(id: &str) -> String {
    format!("https://wallhaven.cc/w/{}", id.trim())
}

fn wallhaven_image_extension(url: &reqwest::Url, content_type: Option<&str>) -> Option<&'static str> {
    let from_path = url
        .path()
        .rsplit('.')
        .next()
        .map(|value| value.to_ascii_lowercase());
    match from_path.as_deref() {
        Some("png") => return Some("png"),
        Some("webp") => return Some("webp"),
        Some("jpg" | "jpeg") => return Some("jpg"),
        _ => {}
    }
    match content_type.unwrap_or("").split(';').next().unwrap_or("").trim() {
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        "image/jpeg" => Some("jpg"),
        _ => None,
    }
}

pub(crate) fn parse_wallhaven_search_payload(
    value: &serde_json::Value,
    page: u32,
) -> Result<WallpaperMarketSearchResult, String> {
    let data = value
        .get("data")
        .and_then(|item| item.as_array())
        .ok_or_else(|| "Wallpaper market returned no results.".to_string())?;
    let last_page = value
        .pointer("/meta/last_page")
        .and_then(|item| item.as_u64())
        .unwrap_or(page as u64)
        .max(1) as u32;
    let mut items = Vec::new();
    for entry in data {
        let id = entry
            .get("id")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .trim();
        let thumb = entry
            .pointer("/thumbs/small")
            .or_else(|| entry.pointer("/thumbs/original"))
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .trim();
        let full = entry
            .get("path")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .trim();
        if id.is_empty() || thumb.is_empty() || full.is_empty() {
            continue;
        }
        if parse_wallhaven_https_url(thumb).is_err() || parse_wallhaven_https_url(full).is_err() {
            continue;
        }
        items.push(WallpaperMarketItem {
            id: id.to_string(),
            thumb_url: thumb.to_string(),
            full_url: full.to_string(),
            source_url: wallhaven_source_url(id),
            resolution: entry
                .get("resolution")
                .and_then(|item| item.as_str())
                .unwrap_or("")
                .to_string(),
            category: entry
                .get("category")
                .and_then(|item| item.as_str())
                .unwrap_or("")
                .to_string(),
        });
    }
    Ok(WallpaperMarketSearchResult {
        page: page.max(1),
        last_page,
        items,
    })
}

fn write_downloaded_wallpaper(
    bytes: &[u8],
    extension: &str,
    source_url: &str,
    wallpaper_dir: &Path,
) -> Result<ImportedWorkspaceWallpaper, String> {
    if wallpaper_kind_from_extension(extension) != Some("image") {
        return Err("Wallpaper file type is not supported.".to_string());
    }
    fs::create_dir_all(wallpaper_dir).map_err(|err| err.to_string())?;
    let id = Uuid::new_v4().to_string();
    let destination = wallpaper_dir.join(format!("{id}.{extension}"));
    let mut file = fs::File::create(&destination).map_err(|err| err.to_string())?;
    file.write_all(bytes).map_err(|err| err.to_string())?;
    Ok(ImportedWorkspaceWallpaper {
        id,
        kind: "image".to_string(),
        path: destination.to_string_lossy().into_owned(),
        source_path: source_url.trim().to_string(),
    })
}

#[tauri::command]
pub(crate) async fn search_workspace_wallpaper_market(
    query: WallpaperMarketSearchQuery,
) -> Result<WallpaperMarketSearchResult, String> {
    let page = query.page.unwrap_or(1).max(1);
    let categories = wallhaven_categories(query.category.as_deref());
    let q = query
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string();
    let client = wallhaven_http_client()?;
    let mut request = client
        .get(WALLHAVEN_SEARCH_URL)
        .query(&[
            ("purity", "100"),
            ("categories", categories),
            ("page", &page.to_string()),
            ("atleast", "1920x1080"),
        ]);
    if q.is_empty() {
        request = request.query(&[("sorting", "toplist"), ("topRange", "1M")]);
    } else {
        request = request.query(&[("q", q.as_str()), ("sorting", "relevance")]);
    }
    let response = request.send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("Wallpaper market is rate-limited. Try again in a moment.".to_string());
    }
    if !status.is_success() {
        return Err(format!("Wallpaper market request failed (HTTP {}).", status.as_u16()));
    }
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|err| err.to_string())?;
    parse_wallhaven_search_payload(&payload, page)
}

#[tauri::command]
pub(crate) async fn download_workspace_wallpaper(
    request: WallpaperMarketDownloadRequest,
) -> Result<ImportedWorkspaceWallpaper, String> {
    let url = parse_wallhaven_https_url(&request.url)?;
    let source_url = parse_wallhaven_https_url(&request.source_url)?;
    if source_url.host_str() != Some("wallhaven.cc") || !source_url.path().starts_with("/w/") {
        return Err("Wallpaper source URL is not a Wallhaven page.".to_string());
    }
    let _ = request.suggested_name;
    let client = wallhaven_http_client()?;
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Wallpaper download failed (HTTP {}).", status.as_u16()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let extension = wallhaven_image_extension(&url, content_type.as_deref())
        .ok_or_else(|| "Wallpaper file type is not supported.".to_string())?;
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    if bytes.len() > WALLHAVEN_MAX_BYTES {
        return Err("Wallpaper file is too large.".to_string());
    }
    let wallpaper_dir = ensure_wallpaper_dir()?;
    let source = source_url.as_str().to_string();
    tokio::task::spawn_blocking(move || {
        write_downloaded_wallpaper(&bytes, extension, &source, &wallpaper_dir)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn temp_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("ccgui-wallpaper-{label}-{}", Uuid::new_v4()))
    }

    #[test]
    fn imports_an_image_into_the_managed_directory() {
        let root = temp_dir("import");
        let source_dir = root.join("source");
        let wallpaper_dir = root.join("wallpapers");
        fs::create_dir_all(&source_dir).expect("source dir");
        let source = source_dir.join("wall.png");
        fs::write(&source, b"png-bytes").expect("write source");

        let imported =
            import_workspace_wallpaper_from_path(source.to_str().unwrap(), &wallpaper_dir)
                .expect("import");

        assert_eq!(imported.kind, "image");
        assert_eq!(imported.source_path, source.to_string_lossy());
        assert!(PathBuf::from(&imported.path).starts_with(&wallpaper_dir));
        assert_eq!(
            fs::read(&imported.path).expect("read copy"),
            b"png-bytes"
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn imports_mp4_as_video() {
        let root = temp_dir("video");
        let source_dir = root.join("source");
        let wallpaper_dir = root.join("wallpapers");
        fs::create_dir_all(&source_dir).expect("source dir");
        let source = source_dir.join("loop.mp4");
        let mut file = fs::File::create(&source).expect("create mp4");
        file.write_all(b"fake-mp4").expect("write mp4");

        let imported =
            import_workspace_wallpaper_from_path(source.to_str().unwrap(), &wallpaper_dir)
                .expect("import video");
        assert_eq!(imported.kind, "video");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_unsupported_extensions() {
        let root = temp_dir("reject");
        let source = root.join("notes.txt");
        fs::create_dir_all(&root).expect("root");
        fs::write(&source, b"nope").expect("write txt");
        let error = import_workspace_wallpaper_from_path(
            source.to_str().unwrap(),
            &root.join("wallpapers"),
        )
        .expect_err("reject txt");
        assert!(error.contains("not supported"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn removes_only_files_inside_the_managed_directory() {
        let root = temp_dir("remove");
        let wallpaper_dir = root.join("wallpapers");
        let outside_dir = root.join("outside");
        fs::create_dir_all(&wallpaper_dir).expect("wallpaper dir");
        fs::create_dir_all(&outside_dir).expect("outside dir");
        let managed = wallpaper_dir.join("keep.png");
        let outside = outside_dir.join("secret.png");
        fs::write(&managed, b"keep").expect("write managed");
        fs::write(&outside, b"secret").expect("write outside");

        remove_workspace_wallpaper_file(managed.to_str().unwrap(), &wallpaper_dir)
            .expect("remove managed");
        assert!(!managed.exists());

        let error =
            remove_workspace_wallpaper_file(outside.to_str().unwrap(), &wallpaper_dir)
                .expect_err("reject outside");
        assert!(error.contains("outside"));
        assert!(outside.exists());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn maps_market_categories_and_allows_wallhaven_hosts() {
        assert_eq!(wallhaven_categories(None), "111");
        assert_eq!(wallhaven_categories(Some("anime")), "010");
        assert_eq!(wallhaven_categories(Some("people")), "001");
        assert!(is_allowed_wallhaven_host("th.wallhaven.cc"));
        assert!(parse_wallhaven_https_url("https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg").is_ok());
        assert!(parse_wallhaven_https_url("http://wallhaven.cc/w/abc123").is_err());
        assert!(parse_wallhaven_https_url("https://example.com/a.jpg").is_err());
    }

    #[test]
    fn parses_wallhaven_search_json() {
        let payload = serde_json::json!({
            "data": [{
                "id": "abc123",
                "category": "anime",
                "resolution": "3840x2160",
                "path": "https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg",
                "thumbs": {
                    "small": "https://th.wallhaven.cc/small/ab/abc123.jpg"
                }
            }],
            "meta": { "last_page": 4 }
        });
        let result = parse_wallhaven_search_payload(&payload, 1).expect("parse");
        assert_eq!(result.last_page, 4);
        assert_eq!(result.items[0].id, "abc123");
        assert_eq!(result.items[0].source_url, "https://wallhaven.cc/w/abc123");
    }

    #[test]
    fn reads_managed_image_previews_as_data_urls() {
        let root = temp_dir("preview");
        let wallpaper_dir = root.join("wallpapers");
        fs::create_dir_all(&wallpaper_dir).expect("wallpaper dir");
        let managed = wallpaper_dir.join("shot.png");
        fs::write(&managed, b"png-bytes").expect("write png");
        let preview =
            read_workspace_wallpaper_preview_from_path(managed.to_str().unwrap(), &wallpaper_dir)
                .expect("preview");
        assert!(preview.starts_with("data:image/png;base64,"));

        let outside = root.join("secret.png");
        fs::write(&outside, b"secret").expect("write outside");
        let error =
            read_workspace_wallpaper_preview_from_path(outside.to_str().unwrap(), &wallpaper_dir)
                .expect_err("reject outside");
        assert!(error.contains("outside"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reads_managed_video_bytes() {
        let root = temp_dir("video-bytes");
        let wallpaper_dir = root.join("wallpapers");
        fs::create_dir_all(&wallpaper_dir).expect("wallpaper dir");
        let managed = wallpaper_dir.join("loop.mp4");
        fs::write(&managed, b"fake-mp4").expect("write mp4");
        let bytes =
            read_workspace_wallpaper_bytes_from_path(managed.to_str().unwrap(), &wallpaper_dir)
                .expect("video bytes");
        assert_eq!(bytes, b"fake-mp4");

        let outside = root.join("secret.mp4");
        fs::write(&outside, b"secret").expect("write outside");
        let error =
            read_workspace_wallpaper_bytes_from_path(outside.to_str().unwrap(), &wallpaper_dir)
                .expect_err("reject outside");
        assert!(error.contains("outside"));
        fs::remove_dir_all(&root).ok();
    }
}
