use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{Emitter, Manager};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const ENDPOINT: &str = "https://eu.i.posthog.com/i/v0/e/";
const ERROR: &str = "settings.analytics.error";

#[derive(Clone, Deserialize, Serialize)]
struct LocalState {
    enabled: bool,
    installation_id: Option<Uuid>,
    last_day: Option<i64>,
}

fn load(path: &Path) -> io::Result<LocalState> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(io::Error::other),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(LocalState {
            enabled: true,
            installation_id: None,
            last_day: None,
        }),
        Err(error) => Err(error),
    }
}

fn save(path: &Path, value: &LocalState) -> io::Result<()> {
    let parent = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
    fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer(&mut file, value)?;
    file.as_file().sync_all()?;
    file.persist(path)?;
    Ok(())
}

struct State {
    local: LocalState,
    delivery: CancellationToken,
}

struct Analytics {
    path: PathBuf,
    state: Mutex<State>,
    client: Client,
    token: &'static str,
    os_version: String,
}

#[cfg(target_os = "macos")]
fn os_version() -> String {
    let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    format!(
        "{}.{}.{}",
        version.majorVersion, version.minorVersion, version.patchVersion
    )
}

#[cfg(not(target_os = "macos"))]
fn os_version() -> String {
    String::new()
}

pub fn setup(app: &tauri::AppHandle) {
    let Some(token) = option_env!("SITUATE_POSTHOG_TOKEN").filter(|value| !value.is_empty()) else {
        return;
    };
    if !cfg!(target_os = "macos") {
        return;
    }
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let path = dir.join("analytics-v1.json");
    let Ok(local) = load(&path) else { return };
    let Ok(client) = Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
    else {
        return;
    };
    app.manage(Analytics {
        path,
        state: Mutex::new(State {
            local,
            delivery: CancellationToken::new(),
        }),
        client,
        token,
        os_version: os_version(),
    });
}

#[tauri::command]
pub fn analytics_preference(app: tauri::AppHandle) -> Option<bool> {
    Some(
        app.try_state::<Analytics>()?
            .state
            .lock()
            .ok()?
            .local
            .enabled,
    )
}

#[tauri::command]
pub async fn analytics_set_preference(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), &'static str> {
    tauri::async_runtime::spawn_blocking(move || set_preference(&app, enabled))
        .await
        .map_err(|_| ERROR)?
}

fn set_preference(app: &tauri::AppHandle, enabled: bool) -> Result<(), &'static str> {
    let analytics = app.try_state::<Analytics>().ok_or(ERROR)?;
    let mut state = analytics.state.lock().map_err(|_| ERROR)?;
    let mut next = state.local.clone();
    next.enabled = enabled;
    if enabled {
        next.installation_id.get_or_insert_with(Uuid::new_v4);
    } else {
        state.delivery.cancel();
    }
    save(&analytics.path, &next).map_err(|_| ERROR)?;
    state.local = next;
    if enabled && state.delivery.is_cancelled() {
        state.delivery = CancellationToken::new();
    }
    let _ = app.emit("analytics-preference-changed", enabled);
    Ok(())
}

fn reserve_day(path: &Path, state: &mut LocalState, now: OffsetDateTime) -> Option<Uuid> {
    let day = now.unix_timestamp().div_euclid(86_400);
    if !state.enabled || state.last_day.is_some_and(|last| last >= day) {
        return None;
    }
    let mut next = state.clone();
    let id = *next.installation_id.get_or_insert_with(Uuid::new_v4);
    next.last_day = Some(day);
    // Reserve before sending: a restart after an uncertain delivery must not resend it.
    save(path, &next).ok()?;
    *state = next;
    Some(id)
}

fn workspace_pseudonym(identity: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("situate:analytics:workspace:v1:{identity}"))
    )
}

#[derive(Serialize)]
struct EventContext<'a> {
    distinct_id: Uuid,
    installation_id: Uuid,
    workspace_id: Option<String>,
    surface: &'static str,
    app_version: &'a str,
    platform: &'static str,
    os_version: &'a str,
    #[serde(rename = "$geoip_disable")]
    geoip_disable: bool,
    #[serde(rename = "$process_person_profile")]
    process_person_profile: bool,
}

#[derive(Serialize)]
struct Event<'a> {
    api_key: &'a str,
    event: &'static str,
    timestamp: String,
    properties: EventContext<'a>,
}

#[tauri::command]
pub async fn analytics_daily_activity(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: Option<String>,
) {
    let Some(analytics) = app.try_state::<Analytics>() else {
        return;
    };
    let now = OffsetDateTime::now_utc();
    let Ok(timestamp) = now.format(&Rfc3339) else {
        return;
    };
    let workspace_id = scope.and_then(|scope| {
        let (identity, _) = crate::workspaces::diagnostic_session(&app, window.label(), &scope)?;
        Some(workspace_pseudonym(&identity))
    });
    let (installation_id, delivery) = {
        let Ok(mut state) = analytics.state.lock() else {
            return;
        };
        if state.delivery.is_cancelled() {
            return;
        }
        let Some(id) = reserve_day(&analytics.path, &mut state.local, now) else {
            return;
        };
        (id, state.delivery.clone())
    };
    let version = app.package_info().version.to_string();
    let event = daily_event(
        analytics.token,
        installation_id,
        workspace_id,
        &version,
        &analytics.os_version,
        timestamp,
    );
    deliver(&analytics.client, ENDPOINT, &event, &delivery).await;
}

fn daily_event<'a>(
    token: &'a str,
    installation_id: Uuid,
    workspace_id: Option<String>,
    version: &'a str,
    os_version: &'a str,
    timestamp: String,
) -> Event<'a> {
    Event {
        api_key: token,
        event: "app_daily_active",
        timestamp,
        properties: EventContext {
            distinct_id: installation_id,
            installation_id,
            workspace_id,
            surface: "app",
            app_version: version,
            platform: "macos",
            os_version,
            geoip_disable: true,
            process_person_profile: false,
        },
    }
}

async fn deliver(client: &Client, endpoint: &str, event: &Event<'_>, delivery: &CancellationToken) {
    tokio::select! {
        biased;
        _ = delivery.cancelled() => {},
        _ = client.post(endpoint).json(event).send() => {},
    }
}

#[cfg(test)]
mod tests;
