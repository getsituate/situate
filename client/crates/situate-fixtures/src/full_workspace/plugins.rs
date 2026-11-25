use serde_json::{Value, json};
use situate_core::{
    content::SaveOutcome,
    plugins::{
        runtime,
        storage::{self, Area},
    },
};
use std::{fs, path::Path};

pub(super) fn seed(root: &Path, archive: &Path) -> Result<(), String> {
    for (id, name, description, fields, path, contents) in [
        (
            "garden-review",
            "Garden review",
            "Guides the weekly garden review.",
            json!({"kind":"tool","skills":["review.md"]}),
            "review.md",
            "# Weekly garden review\n\nRead the open project notes and list unfinished tasks. Separate actions you can take now from decisions that depend on the weather or a volunteer. Keep the summary short and do not mark anything complete without evidence.\n",
        ),
        (
            "garden-calendar",
            "Garden calendar",
            "Provides the garden's sample schedule.",
            json!({"kind":"connection","serviceEntry":"service.js","exports":["listEvents"]}),
            "service.js",
            include_str!("calendar.js"),
        ),
        (
            "garden-archive",
            "Garden archive",
            "Lists and opens documents from a local folder.",
            json!({"kind":"source","serviceEntry":"service.js","exports":["documentSourceDescribe","documentSourceList","documentLibraryDescribe","documentLibraryList","documentLibrarySearch","documentLibraryReadOriginal"]}),
            "service.js",
            include_str!("archive.js"),
        ),
        (
            "garden-board",
            "Garden board",
            "Shows the schedule and archive on one page.",
            json!({"kind":"tool","uiEntry":"view.js","dependencies":["garden-calendar","garden-archive"]}),
            "view.js",
            include_str!("board.js"),
        ),
    ] {
        install(root, id, name, description, fields, (path, contents))
            .map_err(|error| format!("Could not install {id}: {error}"))?;
        if id == "garden-archive" {
            let folder = archive.to_str().ok_or("Unsupported document folder path")?;
            let config = json!({"folder":folder}).to_string();
            if !matches!(
                storage::write(root, id, Area::Config, "folder.json", &config, None)?,
                SaveOutcome::Saved { .. }
            ) {
                return Err("Could not configure the garden archive".into());
            }
        }
        let listing = runtime::list(root)?;
        runtime::set_enabled(root, id, true, listing.revision.as_deref())
            .map_err(|error| format!("Could not enable {id}: {error}"))?;
    }
    let listing = runtime::prepare(root)?;
    for plugin in listing.plugins {
        if !plugin.enabled || plugin.revision.is_none() || plugin.error.is_some() {
            return Err(format!("Could not prepare {}", plugin.id));
        }
    }
    Ok(())
}

fn install(
    root: &Path,
    id: &str,
    name: &str,
    description: &str,
    fields: Value,
    file: (&str, &str),
) -> std::io::Result<()> {
    let mut manifest = json!({
        "schemaVersion": 3, "id": id, "name": name, "description": description,
    });
    manifest
        .as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    let code = root.join(".situate/plugins").join(id).join("code");
    fs::create_dir_all(&code)?;
    fs::write(code.join(file.0), file.1)?;
    fs::write(
        code.join("plugin.json"),
        serde_json::to_string_pretty(&manifest)?,
    )
}
