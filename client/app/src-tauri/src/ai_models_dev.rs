use super::*;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock, RwLock};

const URL: &str = "https://models.dev/api.json";
const MAX_BYTES: usize = 16 * 1024 * 1024;
const PROVIDERS: &[&str] = &["openai", "anthropic", "openrouter"];
const BUILT_IN: &str = include_str!(env!("SITUATE_MODELS_SNAPSHOT"));
static ACTIVE: OnceLock<RwLock<Snapshot>> = OnceLock::new();
static LAST_ATTEMPT: Mutex<Option<Instant>> = Mutex::new(None);

type Snapshot = HashMap<String, HashMap<String, discovery::DiscoveredModel>>;

fn contains(value: &Value, needle: &str) -> bool {
    value
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item == needle))
}

fn text_output(output: &Value) -> bool {
    output
        .as_array()
        .is_some_and(|items| items.len() == 1 && items[0] == "text")
}

fn parse(bytes: &[u8]) -> Option<Snapshot> {
    if bytes.len() > MAX_BYTES {
        return None;
    }
    let raw: Value = serde_json::from_slice(bytes).ok()?;
    let mut snapshot = HashMap::new();
    for &provider in PROVIDERS {
        let entries = raw[provider]["models"].as_object()?;
        if entries.is_empty() || entries.len() > 4000 {
            return None;
        }
        let mut models = HashMap::new();
        for (id, item) in entries {
            if id == "recommended"
                || id.is_empty()
                || id.len() > 256
                || id.chars().any(|c| c.is_whitespace() || c.is_control())
                || item["id"] != id.as_str()
                || item["tool_call"] != true
                || !contains(&item["modalities"]["input"], "text")
                || !text_output(&item["modalities"]["output"])
            {
                continue;
            }
            let limit = &item["limit"];
            let Some((context, output)) = limit["context"].as_u64().zip(limit["output"].as_u64())
            else {
                continue;
            };
            if output == 0 || context < output || context > 100_000_000 {
                continue;
            }
            let efforts = item["reasoning_options"]
                .as_array()
                .and_then(|options| options.iter().find(|option| option["type"] == "effort"));
            let advertised =
                |level: &str| efforts.is_some_and(|entry| contains(&entry["values"], level));
            models.insert(
                id.clone(),
                discovery::DiscoveredModel {
                    id: id.clone(),
                    name: item["name"]
                        .as_str()
                        .filter(|name| {
                            !name.trim().is_empty()
                                && name.len() <= 256
                                && !name.chars().any(char::is_control)
                        })
                        .map(str::to_owned),
                    context_window: context as u32,
                    max_tokens: output as u32,
                    image_input: contains(&item["modalities"]["input"], "image"),
                    thinking_levels: ["minimal", "low", "medium", "high", "xhigh", "max"]
                        .into_iter()
                        .filter(|level| advertised(level))
                        .map(str::to_owned)
                        .collect(),
                    reasoning_none: advertised("none"),
                },
            );
        }
        if models.is_empty() {
            return None;
        }
        snapshot.insert(provider.into(), models);
    }
    Some(snapshot)
}

fn cache_bytes(snapshot: &Snapshot) -> Option<Vec<u8>> {
    let providers: serde_json::Map<String, Value> = snapshot.iter().map(|(provider, models)| {
        let models: serde_json::Map<String, Value> = models.iter().map(|(id, model)| {
            let mut levels = model.thinking_levels.clone();
            if model.reasoning_none {
                levels.push("none".into());
            }
            (id.clone(), serde_json::json!({
                "id": id, "name": model.name, "tool_call": true,
                "modalities": {"input": if model.image_input { vec!["text", "image"] } else { vec!["text"] }, "output": ["text"]},
                "limit": {"context": model.context_window, "output": model.max_tokens},
                "reasoning_options": [{"type":"effort","values":levels}]
            }))
        }).collect();
        (provider.clone(), serde_json::json!({"models":models}))
    }).collect();
    serde_json::to_vec(&providers).ok()
}

fn cached(path: &Path) -> Option<Snapshot> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    parse(&bytes)
}

fn initial(path: &Path) -> Snapshot {
    cached(path)
        .unwrap_or_else(|| parse(BUILT_IN.as_bytes()).expect("valid bundled model metadata"))
}

fn persist(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let directory = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    std::fs::create_dir_all(directory)?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path)?;
    Ok(())
}

async fn download() -> Option<Vec<u8>> {
    let mut response = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?
        .get(URL)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    if response.status() != reqwest::StatusCode::OK
        || response
            .content_length()
            .is_some_and(|length| length > MAX_BYTES as u64)
    {
        return None;
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if chunk.len() > MAX_BYTES - bytes.len() {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    Some(bytes)
}

pub(super) fn setup(app: &tauri::AppHandle) {
    #[cfg(feature = "native-smoke")]
    if crate::agent_e2e::enabled() {
        let mut snapshot = parse(BUILT_IN.as_bytes()).expect("valid bundled model metadata");
        if crate::agent_e2e::uses_discovered_fixture() {
            let openai = snapshot.get_mut("openai").unwrap();
            let model = discovery::DiscoveredModel {
                id: "fixture-discovered-chat".into(),
                name: Some("Fixture Chat".into()),
                context_window: 128_000,
                max_tokens: 16_384,
                image_input: false,
                thinking_levels: vec![],
                reasoning_none: false,
            };
            openai.insert(model.id.clone(), model);
        }
        let _ = ACTIVE.set(RwLock::new(snapshot));
        return;
    }
    let Ok(directory) = app.path().app_data_dir() else {
        ACTIVE.get_or_init(|| {
            RwLock::new(parse(BUILT_IN.as_bytes()).expect("valid bundled model metadata"))
        });
        return;
    };
    let path = directory.join("models-dev.json");
    ACTIVE.get_or_init(|| RwLock::new(initial(&path)));
    refresh(app);
}

pub(super) fn refresh(app: &tauri::AppHandle) {
    #[cfg(feature = "native-smoke")]
    if crate::agent_e2e::enabled() {
        return;
    }
    let Some(active) = ACTIVE.get() else { return };
    let Ok(directory) = app.path().app_data_dir() else {
        return;
    };
    let Ok(mut attempt) = LAST_ATTEMPT.lock() else {
        return;
    };
    if attempt.is_some_and(|last| last.elapsed() < Duration::from_secs(60 * 60)) {
        return;
    }
    *attempt = Some(Instant::now());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(bytes) = download().await else {
            return;
        };
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let changed = accept_snapshot(active, &directory.join("models-dev.json"), &bytes);
            if changed {
                for window in app.webview_windows().into_values() {
                    let _ = app.emit_to(window.label(), "ai-models-changed", "");
                }
            }
        })
        .await;
    });
}

fn accept_snapshot(active: &RwLock<Snapshot>, path: &Path, bytes: &[u8]) -> bool {
    let Some(next) = parse(bytes) else {
        return false;
    };
    if let Some(bytes) = cache_bytes(&next) {
        let _ = persist(path, &bytes);
    }
    active.write().is_ok_and(|mut current| {
        if *current == next {
            return false;
        }
        *current = next;
        true
    })
}

pub(super) fn active() -> bool {
    ACTIVE.get().is_some()
}

pub(super) fn qualify(config: &Config, catalog: &mut discovery::Catalog) {
    let Some(active) = ACTIVE.get() else { return };
    qualify_from(
        config,
        catalog,
        &active.read().unwrap_or_else(|error| error.into_inner()),
    );
}

fn qualify_from(config: &Config, catalog: &mut discovery::Catalog, snapshot: &Snapshot) {
    if !matches!(
        catalog.source,
        discovery::Source::Account | discovery::Source::Provider
    ) || config.provider == "custom"
    {
        return;
    }
    let mut supported = Vec::new();
    let mut available = Vec::new();
    if let Some(models) = snapshot.get(&config.provider) {
        for id in &catalog.models {
            let Some(metadata) = models.get(id) else {
                continue;
            };
            let mut metadata = metadata.clone();
            if let Some(provider) = catalog.selectable.iter().find(|model| model.id == *id) {
                metadata.context_window = metadata.context_window.min(provider.context_window);
                metadata.max_tokens = metadata
                    .max_tokens
                    .min(provider.max_tokens)
                    .min(metadata.context_window);
            } else if config.provider == "openrouter" {
                continue;
            }
            supported.push(id.clone());
            available.push(metadata);
        }
    }
    catalog.models = supported;
    catalog.selectable = available;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_invalid_or_missing_device_cache_uses_the_release_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("models-dev.json");
        let embedded = initial(&path);
        assert!(!embedded["openai"].is_empty());
        persist(&path, b"{\"openai\":{}}").unwrap();
        assert_eq!(initial(&path), embedded);

        let mut raw: Value = serde_json::from_str(BUILT_IN).unwrap();
        let id = embedded["openai"].keys().next().unwrap();
        raw["openai"]["models"][id]["name"] = serde_json::json!("Cached model");
        persist(&path, &serde_json::to_vec(&raw).unwrap()).unwrap();
        assert_eq!(
            initial(&path)["openai"][id].name.as_deref(),
            Some("Cached model")
        );
    }

    #[test]
    fn invalid_refresh_preserves_the_previous_snapshot_and_cache() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("models-dev.json");
        let active = RwLock::new(initial(&path));
        let mut raw: Value = serde_json::from_str(BUILT_IN).unwrap();
        raw["openai"]["models"]["gpt-6.2-sol"]["name"] = serde_json::json!("New name");
        assert!(accept_snapshot(
            &active,
            &path,
            &serde_json::to_vec(&raw).unwrap()
        ));
        let before = initial(&path);
        assert_eq!(*active.read().unwrap(), before);
        assert!(!accept_snapshot(&active, &path, b"{}"));
        assert_eq!(*active.read().unwrap(), before);
        assert_eq!(initial(&path), before);
    }

    #[test]
    fn only_the_active_metadata_snapshot_and_the_connection_determine_choices() {
        let config: Config =
            serde_json::from_value(serde_json::json!({"provider":"openai","endpoint":null}))
                .unwrap();
        let mut catalog = discovery::Catalog {
            source: discovery::Source::Account,
            models: vec!["gpt-6.2-sol".into(), "unmatched".into()],
            ..Default::default()
        };
        let mut snapshot = parse(BUILT_IN.as_bytes()).unwrap();
        let observed = catalog.clone();
        qualify_from(&config, &mut catalog, &snapshot);
        assert_eq!(catalog.models, ["gpt-6.2-sol"]);
        assert_eq!(catalog.selectable[0].max_tokens, 128000);
        assert!(catalog.selectable[0].image_input);
        snapshot.get_mut("openai").unwrap().remove("gpt-6.2-sol");
        catalog = observed;
        qualify_from(&config, &mut catalog, &snapshot);
        assert!(catalog.models.is_empty());
    }
}
