use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path};
const INVALID: &str = "native.plugins.checkInvalid";
const LIMIT: &str = "native.plugins.checkLimit";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HttpFixture {
    pub status: u16,
    pub body: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProcessFixture {
    pub executable: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "process_args"
    )]
    pub args: Option<Vec<String>>,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}
fn process_args<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Vec<String>>, D::Error> {
    Vec::<String>::deserialize(deserializer).map(Some)
}
pub(crate) fn validate_processes(processes: &[ProcessFixture]) -> Result<(), String> {
    let mut keys = std::collections::HashSet::new();
    if processes.len() > 128 {
        return Err(LIMIT.into());
    }
    for fixture in processes {
        let args = fixture.args.as_deref().unwrap_or_default();
        crate::files::validate_process(&fixture.executable, args, 30_000).map_err(|_| INVALID)?;
        if fixture.stdout.len() > 32_768
            || fixture.stderr.len() > 32_768
            || !keys.insert((&fixture.executable, args))
        {
            return Err(INVALID.into());
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fixtures {
    #[serde(skip_serializing_if = "Option::is_none")]
    files: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    config: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    credentials: Option<HashMap<String, String>>,
}

pub(crate) fn synthetic_root(plugin_ids: &[&str]) -> Result<tempfile::TempDir, String> {
    for plugin in plugin_ids {
        crate::plugin_host::identifier(plugin)?;
    }
    let root = tempfile::Builder::new()
        .prefix("situate-plugin-check-")
        .tempdir_in(std::env::temp_dir().canonicalize().map_err(|_| INVALID)?)
        .map_err(|_| INVALID)?;
    let plugins = root.path().join(".situate/plugins");
    std::fs::create_dir_all(&plugins).map_err(|_| INVALID)?;
    // Storage writes require an existing plugin directory, even without fixtures.
    for plugin in plugin_ids {
        std::fs::create_dir(plugins.join(plugin)).map_err(|_| INVALID)?;
    }
    Ok(root)
}

pub(crate) fn seed_fixtures(
    root: &Path,
    scope: &str,
    plugin: &str,
    fixtures: Option<&Fixtures>,
    keys: &crate::plugin_host::EphemeralKeys,
) -> Result<(), String> {
    use situate_core::{
        content::ContentStore,
        plugins::storage::{self, Area},
    };
    let Some(fixtures) = fixtures else {
        return Ok(());
    };
    for values in [
        &fixtures.files,
        &fixtures.config,
        &fixtures.data,
        &fixtures.credentials,
    ]
    .into_iter()
    .flatten()
    {
        if values.len() > 64
            || values
                .iter()
                .any(|(path, text)| path.len() > 512 || text.len() > 262_144)
        {
            return Err(LIMIT.into());
        }
    }
    if let Some(files) = &fixtures.files {
        let mut store = ContentStore::open(root).map_err(|error| error.to_string())?;
        let mut paths: Vec<_> = files.keys().collect();
        paths.sort();
        for path in paths {
            fixture_path(path)?;
            let parts: Vec<_> = path.split('/').collect();
            for index in 1..parts.len() {
                let parent = parts[..index].join("/");
                if !root.join(&parent).exists() {
                    store
                        .create_folder(&parent)
                        .map_err(|error| error.to_string())?;
                }
            }
            let outcome = store
                .agent_write(path, None, &files[path])
                .map_err(|error| error.to_string())?;
            fixture_saved(&outcome)?;
        }
    }
    for (values, area) in [
        (&fixtures.config, Area::Config),
        (&fixtures.data, Area::Data),
    ] {
        if let Some(values) = values {
            for (path, text) in values {
                fixture_path(path)?;
                fixture_saved(&storage::write(root, plugin, area, path, text, None)?)?;
            }
        }
    }
    if let Some(values) = &fixtures.credentials {
        for (name, value) in values {
            crate::plugin_host::seed_test_credential(root, scope, plugin, name, value, keys)?;
        }
    }
    Ok(())
}
fn fixture_saved(outcome: &situate_core::content::SaveOutcome) -> Result<(), String> {
    if matches!(
        outcome,
        situate_core::content::SaveOutcome::Saved { .. }
            | situate_core::content::SaveOutcome::SavedDraftCleanupFailed { .. }
    ) {
        Ok(())
    } else {
        Err(INVALID.into())
    }
}
fn fixture_path(path: &str) -> Result<(), String> {
    situate_core::content::validate_portable_path(path).map_err(|_| INVALID)?;
    if path.split('/').any(|part| part.starts_with('.')) {
        return Err(INVALID.into());
    }
    Ok(())
}
pub(crate) fn worker_evidence(value: &Value) -> Result<u32, String> {
    let assertions = value["assertions"]
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .filter(|n| *n > 0)
        .ok_or(INVALID)?;
    if value["passed"] != true {
        return Err(INVALID.into());
    }
    Ok(assertions)
}

pub(crate) async fn execute_tool(
    context: &crate::ai_plugin_tools::Context,
    tool: situate_agent::ToolRequest,
    progress: situate_agent::ProgressSink,
    cancel: tokio_util::sync::CancellationToken,
) -> situate_agent::ToolOutcome {
    let result = crate::plugin_changes::execute_tool(context, tool, progress, cancel).await;
    match result {
        Ok(value) => situate_agent::ToolOutcome::Completed(tool_result(value)),
        Err(error) => situate_agent::ToolOutcome::Failed(error),
    }
}

fn tool_result(mut value: Value) -> situate_agent::ToolResult {
    let images = value
        .as_object_mut()
        .and_then(|v| v.remove("images"))
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    let mut result = situate_agent::ToolResult::json(value);
    result.is_error |= result.details.get("followUpError").is_some()
        || result.details["passed"] == false
        || result.details["activated"] == false
        || result.details["publication"]["status"] == "outcomeUnknown";
    for mut content in images {
        if let Some(image) = content.as_object_mut() {
            image.insert("type".into(), json!("image"));
        }
        result.content.push(content);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_results_keep_activation_uncertainty_and_native_images_structured() {
        let uncertain = tool_result(
            json!({"activated":false,"publication":{"status":"outcomeUnknown","attempt":"observed"}}),
        );
        assert!(uncertain.is_error);
        assert_eq!(uncertain.details["publication"]["attempt"], "observed");
        let failed_refresh = tool_result(
            json!({"activated":true,"followUpError":"plugins.activationFollowUpFailed","publication":{"status":"published"}}),
        );
        assert!(failed_refresh.is_error);
        assert_eq!(failed_refresh.details["activated"], true);
        let completed = tool_result(
            json!({"activated":true,"publication":{"status":"published"},"images":[{"attachmentId":"native-image","mimeType":"image/png"}]}),
        );
        assert!(!completed.is_error);
        assert_eq!(
            completed.content[1],
            json!({"type":"image","attachmentId":"native-image","mimeType":"image/png"})
        );
        assert!(completed.details.get("images").is_none());
    }

    #[test]
    fn only_explicit_successful_worker_evidence_can_certify_a_check() {
        assert_eq!(
            worker_evidence(&json!({"passed":true,"assertions":3})).unwrap(),
            3
        );
        for value in [
            json!({"assertions":1}),
            json!({"passed":false,"assertions":1}),
            json!({"passed":true,"assertions":0}),
            json!({"passed":true,"assertions":1.5}),
            json!({"passed":true,"assertions":4294967296_u64}),
            json!({"passed":true,"assertions":-1}),
        ] {
            assert!(worker_evidence(&value).is_err(), "{value}");
        }
    }

    #[test]
    fn native_fixtures_seed_only_the_owned_trial_and_preserve_revision_guards() {
        use situate_core::plugins::storage::{self, Area};
        let root = synthetic_root(&["sample"]).unwrap();
        let keys = crate::plugin_host::EphemeralKeys::default();
        let fixtures: Fixtures = serde_json::from_value(json!({"files":{"notes/one.md":"Synthetic"},"config":{"settings.json":"{}"},"data":{"cache.txt":"trial"}})).unwrap();
        seed_fixtures(root.path(), "workspace", "sample", Some(&fixtures), &keys).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.path().join("notes/one.md")).unwrap(),
            "Synthetic"
        );
        assert_eq!(
            storage::read(root.path(), "sample", Area::Config, "settings.json")
                .unwrap()
                .text,
            "{}"
        );
        assert_eq!(
            storage::read(root.path(), "sample", Area::Data, "cache.txt")
                .unwrap()
                .text,
            "trial"
        );
        assert!(seed_fixtures(root.path(), "workspace", "sample", Some(&fixtures), &keys).is_err());
        let escaped: Fixtures =
            serde_json::from_value(json!({"files":{"../escape.txt":"no"}})).unwrap();
        assert!(seed_fixtures(root.path(), "workspace", "sample", Some(&escaped), &keys).is_err());
        let internal: Fixtures =
            serde_json::from_value(json!({"files":{".situate/working-method.md":"no"}})).unwrap();
        assert!(seed_fixtures(root.path(), "workspace", "sample", Some(&internal), &keys).is_err());
        assert!(!root.path().join(".situate/working-method.md").exists());
        assert_eq!(
            std::fs::read_to_string(root.path().join("notes/one.md")).unwrap(),
            "Synthetic"
        );
    }

    #[test]
    fn synthetic_storage_admits_only_selected_owners_and_never_recreates_disposed_ones() {
        use situate_core::plugins::storage::{self, Area};
        let root = synthetic_root(&["one", "two"]).unwrap();
        for plugin in ["one", "two"] {
            storage::write(
                root.path(),
                plugin,
                Area::Config,
                "state.txt",
                "trial",
                None,
            )
            .unwrap();
            assert_eq!(
                storage::read(root.path(), plugin, Area::Config, "state.txt")
                    .unwrap()
                    .text,
                "trial"
            );
        }
        assert!(
            storage::write(
                root.path(),
                "unselected",
                Area::Config,
                "state.txt",
                "unexpected",
                None
            )
            .is_err()
        );
        assert!(!root.path().join(".situate/plugins/unselected").exists());
        crate::plugin_development::clear_trial_storage(root.path()).unwrap();
        assert!(
            storage::write(root.path(), "one", Area::Config, "state.txt", "late", None).is_err()
        );
        assert!(!root.path().join(".situate/plugins/one").exists());
    }

    #[test]
    fn synthetic_storage_rejects_names_that_escape_the_owner_boundary() {
        for plugin in ["../escaped", "/absolute", "nested/plugin", "", ".", ".."] {
            assert!(synthetic_root(&[plugin]).is_err());
        }
    }

    #[test]
    fn process_fixtures_validate_bounds_and_exact_synthetic_requests() {
        let fixture = json!({"executable":"/synthetic/tool","args":[],"exitCode":-2147483648_i64,"stdout":"","stderr":""});
        let parsed: ProcessFixture = serde_json::from_value(fixture.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), fixture);
        let fixtures = vec![parsed];
        validate_processes(&fixtures).unwrap();
        let maximum: Vec<_> = (0..128)
            .map(|index| {
                let mut fixture = fixtures[0].clone();
                fixture.args = Some(vec![index.to_string()]);
                fixture
            })
            .collect();
        validate_processes(&maximum).unwrap();
        let mut omitted_args = fixture.clone();
        omitted_args.as_object_mut().unwrap().remove("args");
        let omitted: ProcessFixture = serde_json::from_value(omitted_args.clone()).unwrap();
        assert!(omitted.args.is_none());
        assert_eq!(serde_json::to_value(&omitted).unwrap(), omitted_args);
        assert!(validate_processes(&[fixtures[0].clone(), omitted]).is_err());
        assert!(validate_processes(&vec![fixtures[0].clone(); 129]).is_err());
        assert!(validate_processes(&vec![fixtures[0].clone(); 2]).is_err());
        for (key, value) in [
            ("executable", json!("relative")),
            ("executable", json!(format!("/{}", "a".repeat(4096)))),
            ("args", json!(vec!["a"; 257])),
            ("args", json!(["a".repeat(65_537)])),
            ("stdout", json!("é".repeat(16_385))),
            ("stderr", json!("a".repeat(32_769))),
        ] {
            let mut invalid = fixture.clone();
            invalid[key] = value;
            let invalid: ProcessFixture = serde_json::from_value(invalid).unwrap();
            assert!(validate_processes(&[invalid]).is_err(), "{key}");
        }
        for (key, value) in [
            ("exitCode", json!(2147483648_i64)),
            ("exitCode", json!(-2147483649_i64)),
            ("exitCode", json!(1.5)),
            ("args", Value::Null),
            ("args", json!("argument")),
            ("cwd", json!("/tmp")),
            ("env", json!({})),
        ] {
            let mut invalid = fixture.clone();
            invalid[key] = value;
            assert!(
                serde_json::from_value::<ProcessFixture>(invalid).is_err(),
                "{key}"
            );
        }
        let mut boundary = fixtures[0].clone();
        boundary.stdout = "é".repeat(16_384);
        boundary.stderr = "x".repeat(32_768);
        validate_processes(&[boundary]).unwrap();
    }
}
