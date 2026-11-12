use crate::file_tool::ToolRequest;
use serde_json::{Value, json};
use situate_core::{content, plugins::sources};
use std::path::Path;

const INVALID: &str = "native.plugins.invalidPath";

pub(crate) fn target(path: &str) -> Result<Option<(&str, &str)>, String> {
    let Some(rest) = path.strip_prefix(".situate/plugins/") else {
        return Ok(None);
    };
    let (id, rest) = rest.split_once('/').ok_or(INVALID)?;
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || id.starts_with('-')
        || id.ends_with('-')
    {
        return Err(INVALID.into());
    }
    let path = if rest == "code" {
        ""
    } else {
        rest.strip_prefix("code/").ok_or(INVALID)?
    };
    if !path.is_empty() {
        content::validate_portable_path(path).map_err(|_| INVALID)?;
    }
    Ok(Some((id, path)))
}

pub(crate) fn request(
    root: &Path,
    request: &ToolRequest,
    check_cancelled: impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check_cancelled()?;
    let (id, path) = target(&request.path)?.ok_or(INVALID)?;
    match request.operation.as_str() {
        "read" | "read_revision" => {
            let bytes = if request.operation == "read" {
                sources::read(root, id, path)?.text.into_bytes()
            } else {
                sources::revision(root, id, path, request.revision.as_deref().ok_or(INVALID)?)?
            };
            let text = String::from_utf8(bytes).map_err(|_| "native.files.history.notText")?;
            let mut page = crate::file_tool::text_page(
                &text,
                request.offset,
                request.limit.unwrap_or(16_384),
            )?;
            page["revision"] = json!(content::revision_for_text(&text).map_err(|e| e.to_string())?);
            page["path"] = json!(request.path);
            Ok(page)
        }
        "write" | "edit" => {
            if request.prepare_copy {
                return Err(INVALID.into());
            }
            let text = if request.operation == "edit" {
                let source = sources::read(root, id, path)?;
                if request.expected_revision.as_deref() != Some(&source.revision) {
                    return Err("native.content.base.mismatch".into());
                }
                content::apply_exact_edits(&source.text, &request.edits)
                    .map_err(|e| e.to_string())?
            } else {
                request.text.clone().ok_or(INVALID)?
            };
            check_cancelled()?;
            let mut reply = crate::plugin_sources::dispatch(
                root,
                crate::plugin_sources::Request::Write {
                    plugin_id: id.into(),
                    path: path.into(),
                    text,
                    expected_revision: request.expected_revision.clone(),
                },
            )?;
            reply["isError"] = json!(reply["outcome"].get("Saved").is_none());
            Ok(reply)
        }
        "history" => {
            let entries = sources::file_history(root, id, path)?
                .into_iter()
                .map(|entry| serde_json::to_value(entry).map_err(|_| INVALID.to_owned()))
                .collect::<Result<Vec<_>, _>>()?;
            crate::file_tool::entries_page(entries, request.offset, request.limit.unwrap_or(100))
        }
        "ls" | "find" | "grep" => {
            let prefix = format!(".situate/plugins/{id}/code/");
            let entries = sources::files(root, id)?.into_iter().map(|file| {
                json!({"path":format!("{prefix}{}", file.path),"isDirectory":file.is_directory})
            }).collect();
            crate::file_tool::search(
                request,
                entries,
                |full| {
                    let relative = full.strip_prefix(&prefix).ok_or(INVALID)?;
                    Ok(sources::read(root, id, relative)?.text.into_bytes())
                },
                check_cancelled,
            )
        }
        _ => Err("native.files.operation.unavailable".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(root: &Path, operation: &str, args: Value) -> Result<Value, String> {
        request(
            root,
            &crate::file_tool::parse_native(operation, args)?,
            || Ok(()),
        )
    }

    #[test]
    fn source_paths_exclude_state_history_and_traversal() {
        assert_eq!(target("notes.md").unwrap(), None);
        assert_eq!(
            target(".situate/plugins/mail/code/service.js").unwrap(),
            Some(("mail", "service.js"))
        );
        for path in [
            ".situate/plugins/mail/state.json",
            ".situate/plugins/mail/.situate/history.git",
            ".situate/plugins/mail/code/../state.json",
            ".situate/plugins/mail/code/.situate/history.git",
            ".situate/plugins/Mail/code/a.js",
            ".situate/plugins/-mail/code/a.js",
        ] {
            assert!(target(path).is_err(), "{path}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn file_tools_reject_symlink_escapes_and_cancel_before_access() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        sources::create(root.path(), "mail").unwrap();
        let outside = root.path().join("outside.js");
        std::fs::write(&outside, "unchanged").unwrap();
        std::os::unix::fs::symlink(
            &outside,
            root.path().join(".situate/plugins/mail/code/link.js"),
        )
        .unwrap();
        let path = ".situate/plugins/mail/code/link.js";
        assert!(call(root.path(), "read", json!({"path":path})).is_err());
        assert!(
            call(
                root.path(),
                "write",
                json!({"path":path,"text":"changed","expectedRevision":null})
            )
            .is_err()
        );
        assert_eq!(std::fs::read_to_string(&outside).unwrap(), "unchanged");
        let read = crate::file_tool::parse_native("read", json!({"path":path})).unwrap();
        assert_eq!(
            request(root.path(), &read, || Err(
                "native.ai.request.cancelled".into()
            ))
            .unwrap_err(),
            "native.ai.request.cancelled"
        );
    }

    #[test]
    fn ordinary_file_tools_preserve_plugin_history_and_reject_stale_edits() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        std::fs::create_dir(root.path().join(".situate")).unwrap();
        sources::create(root.path(), "mail").unwrap();
        let path = ".situate/plugins/mail/code/service.js";
        let first = call(
            root.path(),
            "write",
            json!({"path":path,"text":"export const count=1;","expectedRevision":null}),
        )
        .unwrap();
        assert_eq!(first["change"]["store"], "plugin");
        let revision = first["change"]["after"]["revision"].as_str().unwrap();
        let read = call(root.path(), "read", json!({"path":path,"limit":7})).unwrap();
        assert_eq!(read["text"], "export ");
        assert_eq!(read["nextOffset"], 7);
        let edited = call(root.path(), "edit", json!({"path":path,"expectedRevision":read["revision"],"edits":[{"oldText":"count=1","newText":"count=2"}]})).unwrap();
        assert_eq!(edited["change"]["operation"], "modified");
        assert!(call(root.path(), "edit", json!({"path":path,"expectedRevision":read["revision"],"edits":[{"oldText":"count=2","newText":"count=3"}]})).is_err());
        assert!(
            call(
                root.path(),
                "write",
                json!({"path":path,"text":"lost","expectedRevision":read["revision"]}),
            )
            .is_err()
        );
        assert_eq!(
            sources::read(root.path(), "mail", "service.js")
                .unwrap()
                .text,
            "export const count=2;"
        );
        assert_eq!(
            call(
                root.path(),
                "read_revision",
                json!({"path":path,"revision":revision})
            )
            .unwrap()["text"],
            "export const count=1;"
        );
        let history = call(root.path(), "history", json!({"path":path})).unwrap();
        assert!(history["total"].as_u64().unwrap() >= 2);
        for operation in ["ls", "find", "grep"] {
            let mut args = json!({"path":".situate/plugins/mail/code"});
            if operation != "ls" {
                args["query"] = json!(if operation == "grep" {
                    "count=2"
                } else {
                    "service"
                });
            }
            let found = call(root.path(), operation, args).unwrap();
            assert_eq!(found["entries"][0]["path"], path);
        }
        assert!(
            call(
                root.path(),
                "write",
                json!({"path":path,"text":"copy","expectedRevision":null,"prepareCopy":true})
            )
            .is_err()
        );
    }
}
