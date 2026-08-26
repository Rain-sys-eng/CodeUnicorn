//! System notification bridge.
//!
//! Background: `@tauri-apps/plugin-notification` desktop path uses
//! `notify-rust` → `mac-notification-sys` → **deprecated**
//! `NSUserNotificationCenter` plus NSBundle method swizzling. On recent
//! macOS (observed on 26.x) that path:
//! - never registers the app in System Settings → Notifications
//! - often delivers nothing for signed/hardened Runtime apps
//! - always reports permission as Granted without a real OS prompt
//!
//! This module uses `UNUserNotificationCenter` on macOS so the app appears
//! under its real bundle id (`com.zhukunpenglinyutong.ccgui`) and can request
//! authorization properly. Non-macOS platforms keep the plugin path.
//!
//! IMPORTANT (dev/debug): `UNUserNotificationCenter currentNotificationCenter`
//! aborts the process with `NSInternalInconsistencyException` when the process
//! is a bare binary (e.g. `target/debug/cc-gui`) instead of a real `.app`
//! bundle (`bundleProxyForCurrentProcess is nil`). All UN paths are therefore
//! gated by [`macos::is_real_app_bundle`].

use tauri::AppHandle;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemNotificationPermissionState {
    /// `notDetermined` | `denied` | `authorized` | `provisional` | `ephemeral` | `granted` | `unsupported`
    pub status: String,
    pub can_send: bool,
}

#[tauri::command]
pub async fn system_notification_permission_state(
    app: AppHandle,
) -> Result<SystemNotificationPermissionState, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        return macos::permission_state().await;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(SystemNotificationPermissionState {
            status: "granted".to_string(),
            can_send: true,
        })
    }
}

#[tauri::command]
pub async fn system_notification_request_permission(
    app: AppHandle,
) -> Result<SystemNotificationPermissionState, String> {
    #[cfg(target_os = "macos")]
    {
        return macos::request_permission(app).await;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(SystemNotificationPermissionState {
            status: "granted".to_string(),
            can_send: true,
        })
    }
}

#[tauri::command]
pub async fn system_notification_send(
    app: AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return macos::send(app, title, body).await;
    }
    #[cfg(not(target_os = "macos"))]
    {
        send_via_plugin(&app, title, body)
    }
}

fn send_via_plugin(app: &AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ptr::NonNull;
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSBundle, NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotificationRequest, UNNotificationSettings, UNNotificationSound,
        UNUserNotificationCenter,
    };
    use tauri::AppHandle;

    use super::{send_via_plugin, SystemNotificationPermissionState};

    /// Whether this process is a real macOS app bundle that can safely call
    /// `UNUserNotificationCenter`.
    ///
    /// Bare cargo binaries (`target/debug/cc-gui`) set
    /// `mainBundle.bundleURL` to the containing folder and cause:
    /// `bundleProxyForCurrentProcess is nil` → process abort.
    fn is_real_app_bundle() -> bool {
        let bundle = NSBundle::mainBundle();
        let path = bundle.bundlePath().to_string();
        // Real app: .../Something.app or .../Something.app/Contents/MacOS
        // Bare binary: .../target/debug  (directory, not .app)
        if path.ends_with(".app") || path.contains(".app/") || path.contains(".app\\") {
            return true;
        }
        // Fallback: require a non-empty bundle identifier that is not the
        // default for unpackaged processes.
        match bundle.bundleIdentifier() {
            Some(identifier) => {
                let id = identifier.to_string();
                !id.is_empty()
                    && id != "com.apple.dt.Xcode"
                    && !id.starts_with("com.apple.Terminal")
                    && path.contains(".app")
            }
            None => false,
        }
    }

    fn center() -> Result<Retained<UNUserNotificationCenter>, String> {
        if !is_real_app_bundle() {
            return Err("UNUserNotificationCenter requires a packaged .app bundle \
                 (not a bare target/debug binary). Use `cargo tauri dev` / \
                 release bundle, or fall back to the notification plugin."
                .to_string());
        }
        Ok(UNUserNotificationCenter::currentNotificationCenter())
    }

    fn status_label(status: UNAuthorizationStatus) -> &'static str {
        match status {
            UNAuthorizationStatus::NotDetermined => "notDetermined",
            UNAuthorizationStatus::Denied => "denied",
            UNAuthorizationStatus::Authorized => "authorized",
            UNAuthorizationStatus::Provisional => "provisional",
            UNAuthorizationStatus::Ephemeral => "ephemeral",
            _ => "unknown",
        }
    }

    fn can_send_status(status: UNAuthorizationStatus) -> bool {
        matches!(
            status,
            UNAuthorizationStatus::Authorized
                | UNAuthorizationStatus::Provisional
                | UNAuthorizationStatus::Ephemeral
        )
    }

    fn unsupported_dev_state() -> SystemNotificationPermissionState {
        SystemNotificationPermissionState {
            status: "unsupported".to_string(),
            // Bare binary: plugin fallback may still attempt delivery (legacy).
            can_send: true,
        }
    }

    fn read_authorization_status_blocking() -> Result<UNAuthorizationStatus, String> {
        let center = center()?;
        let (tx, rx) = mpsc::channel::<Result<UNAuthorizationStatus, String>>();
        let tx = Arc::new(Mutex::new(Some(tx)));
        let tx_for_block = Arc::clone(&tx);
        let block = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: Apple provides a valid settings object for the duration of the callback.
            let settings = unsafe { settings.as_ref() };
            let status = settings.authorizationStatus();
            if let Ok(mut guard) = tx_for_block.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(Ok(status));
                }
            }
        });
        center.getNotificationSettingsWithCompletionHandler(&block);
        drop(block);
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "permission state timed out".to_string())?
    }

    fn request_authorization_blocking() -> Result<bool, String> {
        let current = read_authorization_status_blocking()?;
        if can_send_status(current) {
            return Ok(true);
        }
        if current == UNAuthorizationStatus::Denied {
            return Ok(false);
        }

        let center = center()?;
        let (tx, rx) = mpsc::channel::<Result<bool, String>>();
        let tx = Arc::new(Mutex::new(Some(tx)));
        let tx_for_block = Arc::clone(&tx);
        let options = UNAuthorizationOptions::Alert
            | UNAuthorizationOptions::Sound
            | UNAuthorizationOptions::Badge;
        let block = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            let result = if !error.is_null() {
                // SAFETY: non-null NSError pointer from Apple callback.
                let message = unsafe { &*error }.localizedDescription().to_string();
                Err(format!("requestAuthorization failed: {message}"))
            } else {
                Ok(granted.as_bool())
            };
            if let Ok(mut guard) = tx_for_block.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(result);
                }
            }
        });
        center.requestAuthorizationWithOptions_completionHandler(options, &block);
        drop(block);
        rx.recv_timeout(Duration::from_secs(120))
            .map_err(|_| "permission request timed out".to_string())?
    }

    fn send_blocking(title: &str, body: &str) -> Result<(), String> {
        let center = center()?;
        let granted = request_authorization_blocking()?;
        if !granted {
            let status = read_authorization_status_blocking()
                .map(status_label)
                .unwrap_or("denied");
            return Err(format!(
                "system notification permission is {status} (enable ccgui in System Settings → Notifications)"
            ));
        }

        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));

        let identifier = NSString::from_str(&format!(
            "ccgui-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or(0)
        ));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier,
            &content,
            None,
        );

        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let tx = Arc::new(Mutex::new(Some(tx)));
        let tx_for_block = Arc::clone(&tx);
        let block = RcBlock::new(move |error: *mut NSError| {
            let result = if error.is_null() {
                Ok(())
            } else {
                // SAFETY: non-null NSError pointer from Apple callback.
                let message = unsafe { &*error }.localizedDescription().to_string();
                Err(format!("addNotificationRequest failed: {message}"))
            };
            if let Ok(mut guard) = tx_for_block.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(result);
                }
            }
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&block));
        drop(block);
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "addNotificationRequest timed out".to_string())?
    }

    pub async fn permission_state() -> Result<SystemNotificationPermissionState, String> {
        if !is_real_app_bundle() {
            return Ok(unsupported_dev_state());
        }
        let status = tokio::task::spawn_blocking(read_authorization_status_blocking)
            .await
            .map_err(|error| error.to_string())??;
        Ok(SystemNotificationPermissionState {
            status: status_label(status).to_string(),
            can_send: can_send_status(status),
        })
    }

    pub async fn request_permission(
        _app: AppHandle,
    ) -> Result<SystemNotificationPermissionState, String> {
        if !is_real_app_bundle() {
            // Do not touch UNUserNotificationCenter — it aborts the process.
            log::warn!(
                "system_notification: skip UN permission request outside a packaged .app \
                 (bare debug binary). Use tauri bundle / release app for real notifications."
            );
            return Ok(unsupported_dev_state());
        }
        let granted = tokio::task::spawn_blocking(request_authorization_blocking)
            .await
            .map_err(|error| error.to_string())??;
        let status = tokio::task::spawn_blocking(read_authorization_status_blocking)
            .await
            .map_err(|error| error.to_string())??;
        Ok(SystemNotificationPermissionState {
            status: if granted && status == UNAuthorizationStatus::NotDetermined {
                "authorized".to_string()
            } else {
                status_label(status).to_string()
            },
            can_send: granted || can_send_status(status),
        })
    }

    pub async fn send(app: AppHandle, title: String, body: String) -> Result<(), String> {
        if !is_real_app_bundle() {
            // Best-effort legacy path for local bare-binary debugging only.
            log::warn!(
                "system_notification: UN path unavailable outside .app; using plugin fallback"
            );
            return send_via_plugin(&app, title, body);
        }
        tokio::task::spawn_blocking(move || send_blocking(&title, &body))
            .await
            .map_err(|error| error.to_string())?
    }
}
