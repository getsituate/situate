use situate_core::{
    content::SaveOutcome,
    plugins::{
        publication, runtime, sources,
        storage::{self, Area},
    },
};
use std::fs;

pub(crate) fn service_source() -> &'static str {
    r#"export default () => {
      let count = 0, release;
      const read = async () => ({content:[{type:'text',text:String(count)}],details:{}});
      const entered = async (args, host) => {
        const before = await host.config.read('invocation.json');
        const saved = await host.config.write('invocation.json', args.invocation, before.revision);
        if (!saved.Saved) throw new Error('plugins.checkFailed');
      };
      const hold = async (args, host) => {
        const pending = new Promise(resolve => { release=resolve; });
        await entered(args, host);
        return pending;
      };
      return {
        tools:[{name:'count',description:'Read the synthetic counter.',parameters:{type:'object',properties:{},additionalProperties:false},execute:read}],
        exports:{count:read,readCount:async()=>count,increment:async()=>++count,
          hold,release:async()=>{release?.();return true;},hang:async(args,host)=>{await entered(args,host);for(;;){}}}
      };
    };"#
}

pub(crate) fn write_source(
    root: &std::path::Path,
    id: &str,
    path: &str,
    text: &str,
) -> Result<(), String> {
    let expected = sources::read(root, id, path)
        .ok()
        .map(|version| version.revision);
    match sources::write(root, id, path, text, expected.as_deref())? {
        SaveOutcome::Saved { .. } => Ok(()),
        _ => Err("Synthetic plugin source was not acknowledged".into()),
    }
}

fn prepare_unavailable_service(root: &std::path::Path, hung: bool) -> Result<(), String> {
    let (id, name, source) = if hung {
        (
            "native-hung-init",
            "Native hung initialization",
            "export default () => { for (;;) {} };".to_owned(),
        )
    } else {
        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Synthetic initialization clock unavailable")?
            .as_millis()
            + 30_000;
        // After the hung initializer's deadline, reevaluation would expose a different error.
        let source = format!(
            "export default () => {{ throw new Error(Date.now() < {cutoff} ? 'plugins.checkFailed' : 'plugins.checkAssertionFailed'); }};"
        );
        (
            "native-failing-init",
            "Native failing initialization",
            source,
        )
    };
    if !root.join(".situate/plugins").join(id).exists() {
        sources::create(root, id)?;
    }
    write_source(
        root,
        id,
        "plugin.json",
        &serde_json::json!({
            "schemaVersion":2, "id":id, "name":name,
            "description":"Synthetic service initialization failure.",
            "serviceEntry":"service.js", "exports":[]
        })
        .to_string(),
    )?;
    write_source(root, id, "service.js", &source)?;
    let selected = vec![sources::snapshot(root, id)?];
    let checked = publication::checked_closure(root, &selected)?;
    if publication::publish(root, &selected, &checked, &[])?.status
        != publication::PublicationStatus::Published
    {
        return Err("Initialization fixture was not published".into());
    }
    let before = runtime::list(root)?;
    runtime::set_enabled(root, id, true, before.revision.as_deref())?;
    Ok(())
}

#[tauri::command]
pub fn smoke_plugin_runtime_source(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: String,
    operation: Option<String>,
) -> Result<Option<String>, String> {
    crate::ai::plugin_checks_smoke::owned(&app)?;
    let authorization = crate::workspaces::authorization_session(&app, window.label(), &scope)?;
    crate::workspaces::with_authorization_session(
        &app,
        window.label(),
        &authorization,
        |location| {
            let _access = crate::ai::local_storage(&app, location)?;
            let root = crate::ai::plugin_checks_smoke::owned_workspace(&app, location)?;
            let plugin = root.join(".situate/plugins/native-counter");
            match operation.as_deref().unwrap_or("prepare") {
                "invocationEntered" => {
                    return Ok(Some(
                        storage::read(&root, "native-counter", Area::Config, "invocation.json")?
                            .text,
                    ));
                }
                "prepareFailedInitializer" => {
                    return prepare_unavailable_service(&root, false).map(|()| None);
                }
                "prepareHungInitializer" => {
                    return prepare_unavailable_service(&root, true).map(|()| None);
                }
                "clearFailedInitializers" => {
                    for id in ["native-failing-init", "native-hung-init"] {
                        let before = runtime::list(&root)?;
                        if before
                            .plugins
                            .iter()
                            .any(|plugin| plugin.id == id && plugin.enabled)
                        {
                            runtime::set_enabled(&root, id, false, before.revision.as_deref())?;
                        }
                        let path = root.join(".situate/plugins").join(id);
                        match fs::symlink_metadata(&path) {
                            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {
                                fs::remove_dir_all(path)
                                    .map_err(|_| "Could not remove initialization fixture")?;
                            }
                            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                            _ => return Err("Initialization fixture boundary is invalid".into()),
                        }
                    }
                    return Ok(None);
                }
                "remove" => {
                    let meta =
                        fs::symlink_metadata(&plugin).map_err(|_| "Counter plugin is absent")?;
                    if !meta.is_dir() || meta.file_type().is_symlink() {
                        return Err("Counter plugin boundary is invalid".into());
                    }
                    fs::remove_dir_all(&plugin).map_err(|_| "Could not remove counter plugin")?;
                    return Ok(None);
                }
                "assertAbsent" => {
                    if !matches!(fs::symlink_metadata(&plugin),Err(error) if error.kind()==std::io::ErrorKind::NotFound)
                        || runtime::list(&root)?
                            .plugins
                            .iter()
                            .any(|p| p.id == "native-counter")
                    {
                        return Err("Counter plugin was not removed".into());
                    }
                    return Ok(None);
                }
                "reinstall" if fs::symlink_metadata(&plugin).is_ok() => {
                    return Err("Counter plugin still exists".into());
                }
                "prepare" | "reinstall" => (),
                _ => return Err("Unknown counter fixture operation".into()),
            }
            if !root.join(".situate/plugins/native-review").exists() {
                sources::create(&root, "native-review")?;
                write_source(&root,"native-review","plugin.json",&serde_json::json!({"schemaVersion":2,"id":"native-review","name":"Native review","description":"Disabled source inspection fixture.","serviceEntry":"service.js","skills":["SKILL.md"]}).to_string())?;
                write_source(
                    &root,
                    "native-review",
                    "service.js",
                    "export default () => ({});",
                )?;
                write_source(
                    &root,
                    "native-review",
                    "SKILL.md",
                    "Inspect synthetic code without enabling it.",
                )?;
            }
            if !plugin.exists() {
                sources::create(&root, "native-counter")?;
            }
            write_source(&root,"native-counter","plugin.json",&serde_json::json!({
            "schemaVersion":2,"id":"native-counter","name":"Native counter","description":"Count synthetic interactions.","serviceEntry":"service.js","uiEntry":"ui.js","skills":["SKILL.md"],"exports":["count","readCount","increment","hold","release","hang"]
        }).to_string())?;
            write_source(&root, "native-counter", "service.js", service_source())?;
            write_source(
                &root,
                "native-counter",
                "ui.js",
                include_str!("plugin-runtime-fixture.js"),
            )?;
            write_source(
                &root,
                "native-counter",
                "SKILL.md",
                "Use the counter to count synthetic interactions.",
            )?;
            let selected = vec![sources::snapshot(&root, "native-counter")?];
            let checked = publication::checked_closure(&root, &selected)?;
            if publication::publish(&root, &selected, &checked, &[])?.status
                != publication::PublicationStatus::Published
            {
                return Err("Counter fixture was not published".into());
            }
            let previous =
                storage::read(&root, "native-counter", Area::Config, "invocation.json").ok();
            if !matches!(
                storage::write(
                    &root,
                    "native-counter",
                    Area::Config,
                    "invocation.json",
                    "",
                    previous.as_ref().map(|version| version.revision.as_str())
                )?,
                SaveOutcome::Saved { .. }
            ) {
                return Err("Invocation fixture was not initialized".into());
            }
            let before = runtime::list(&root)?;
            runtime::set_enabled(&root, "native-counter", true, before.revision.as_deref())?;
            Ok(None)
        },
    )
}
