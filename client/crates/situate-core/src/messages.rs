use crate::localization::Language;
use serde_json::Value;
use std::{collections::HashMap, sync::OnceLock};

pub fn error(key: &str, params: Value) -> String {
    debug_assert!(
        parameters_match(&text(Language::En, key), &params),
        "invalid message parameters for {key}"
    );
    serde_json::json!({"key": key, "params": params}).to_string()
}

fn parameters_match(template: &str, params: &Value) -> bool {
    if template.contains("${")
        || template.contains("\\(")
        || template.contains("{}")
        || template
            .as_bytes()
            .windows(2)
            .any(|pair| pair[0] == b'$' && pair[1].is_ascii_alphabetic())
    {
        return false;
    }
    let Some(params) = params.as_object() else {
        return false;
    };
    let mut names = std::collections::BTreeSet::new();
    let mut remaining = template;
    while let Some((_, after)) = remaining.split_once('{') {
        let Some((name, tail)) = after.split_once('}') else {
            return false;
        };
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return false;
        }
        names.insert(name);
        remaining = tail;
    }
    names == params.keys().map(String::as_str).collect()
}

pub fn supplied(error: impl std::fmt::Display, fallback: &str) -> String {
    let message = error.to_string();
    if message.starts_with("native.")
        || serde_json::from_str::<Value>(&message)
            .ok()
            .and_then(|v| {
                v.get("key")
                    .and_then(Value::as_str)
                    .map(|k| k.starts_with("native."))
            })
            .unwrap_or(false)
    {
        message
    } else {
        fallback.into()
    }
}

pub fn text(language: Language, key: &str) -> String {
    static EN: OnceLock<HashMap<String, String>> = OnceLock::new();
    static DE: OnceLock<HashMap<String, String>> = OnceLock::new();
    let english = EN.get_or_init(|| {
        let mut catalog: HashMap<String, String> = serde_json::from_str(include_str!(
            "../../../packages/localization/src/catalogs/en.native.json"
        ))
        .expect("valid English native catalog");
        catalog.extend(
            serde_json::from_str::<HashMap<String, String>>(include_str!(
                "../../../packages/localization/src/catalogs/en.layout-native.json"
            ))
            .expect("valid English layout catalog"),
        );
        catalog
    });
    let selected = if language == Language::De {
        DE.get_or_init(|| {
            let mut catalog: HashMap<String, String> = serde_json::from_str(include_str!(
                "../../../packages/localization/src/catalogs/de.native.json"
            ))
            .expect("valid German native catalog");
            catalog.extend(
                serde_json::from_str::<HashMap<String, String>>(include_str!(
                    "../../../packages/localization/src/catalogs/de.layout-native.json"
                ))
                .expect("valid German layout catalog"),
            );
            catalog
        })
    } else {
        english
    };
    selected
        .get(key)
        .or_else(|| english.get(key))
        .cloned()
        .unwrap_or_else(|| english["native.unavailable"].clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_keys_match_and_native_dialogs_translate() {
        let en: HashMap<String, String> = serde_json::from_str(include_str!(
            "../../../packages/localization/src/catalogs/en.native.json"
        ))
        .unwrap();
        let de: HashMap<String, String> = serde_json::from_str(include_str!(
            "../../../packages/localization/src/catalogs/de.native.json"
        ))
        .unwrap();
        assert_eq!(en.len(), de.len());
        for key in en.keys() {
            assert!(
                de.get(key).is_some_and(|value| !value.trim().is_empty()),
                "{key}"
            );
            let english = &en[key];
            let mut params = serde_json::Map::new();
            let mut remaining = english.as_str();
            while let Some((_, after)) = remaining.split_once('{') {
                let (name, tail) = after.split_once('}').expect("closed placeholder");
                params.insert(name.into(), Value::Null);
                remaining = tail;
            }
            assert!(
                parameters_match(english, &Value::Object(params.clone())),
                "{key}"
            );
            assert!(parameters_match(&de[key], &Value::Object(params)), "{key}");
        }
        assert_eq!(
            text(Language::De, "native.workspace.dialog.chooseFolder"),
            "Arbeitsbereichsordner auswählen"
        );
        assert_eq!(
            text(Language::En, "native.files.dialog.export"),
            "Export a copy"
        );
    }
    #[test]
    fn layout_catalogs_match_and_are_registered() {
        let english: HashMap<String, String> = serde_json::from_str(include_str!(
            "../../../packages/localization/src/catalogs/en.layout-native.json"
        ))
        .unwrap();
        let german: HashMap<String, String> = serde_json::from_str(include_str!(
            "../../../packages/localization/src/catalogs/de.layout-native.json"
        ))
        .unwrap();
        assert_eq!(english.len(), german.len());
        for (key, value) in english {
            assert_eq!(text(Language::En, &key), value);
            assert_eq!(text(Language::De, &key), german[&key]);
            assert!(!german[&key].trim().is_empty());
            assert!(parameters_match(&value, &serde_json::json!({})));
            assert!(parameters_match(&german[&key], &serde_json::json!({})));
        }
    }

    #[test]
    fn parameter_contracts_reject_missing_extra_and_anonymous_placeholders() {
        assert!(parameters_match(
            "At {path}: {error}",
            &serde_json::json!({"path":"Garden", "error":"native.unavailable"})
        ));
        assert!(!parameters_match(
            "At {path}: {error}",
            &serde_json::json!({"path":"Garden"})
        ));
        assert!(!parameters_match(
            "At {path}",
            &serde_json::json!({"path":"Garden", "detail":"extra"})
        ));
        assert!(!parameters_match(
            "At {}",
            &serde_json::json!({"path":"Garden"})
        ));
        for template in [
            "At ${path}",
            "At ${path.path}",
            "At $remaining",
            "At \\(child.path)",
        ] {
            assert!(!parameters_match(
                template,
                &serde_json::json!({"path":"Garden"})
            ));
        }
        for key in [
            "native.workspace.create.partial",
            "native.provider.folder.partial",
            "native.provider.create.partial",
            "native.provider.create.partialWorkspace",
            "native.provider.create.partialDirectory",
            "native.files.metadata.recoveryFailed",
        ] {
            for language in [Language::En, Language::De] {
                assert!(
                    parameters_match(
                        &text(language, key),
                        &serde_json::json!({"path":"Garden", "error":"native.unavailable"})
                    ),
                    "{key}"
                );
            }
        }
        for language in [Language::En, Language::De] {
            for key in [
                "native.provider.documents.path",
                "native.provider.storage.internalPath",
            ] {
                assert!(parameters_match(
                    &text(language, key),
                    &serde_json::json!({"path":"Garden"})
                ));
            }
            assert!(parameters_match(
                &text(language, "native.workspace.location.child"),
                &serde_json::json!({"parent":"native.provider.documents.name", "name":"Garden"})
            ));
            assert!(parameters_match(
                &text(language, "native.workspace.open.rememberFailed"),
                &serde_json::json!({"error":"native.unavailable"})
            ));
            assert!(parameters_match(
                &text(language, "native.workspace.create.openFailed"),
                &serde_json::json!({"display":"Garden", "error":"native.unavailable"})
            ));
            assert!(parameters_match(
                &text(language, "native.files.metadata.changed"),
                &serde_json::json!({"path":"Garden"})
            ));
            assert!(parameters_match(
                &text(language, "native.history.reverseChange"),
                &serde_json::json!({"revision":"abc"})
            ));
        }
    }
    #[test]
    fn structured_errors_preserve_parameters_without_leaking_system_details() {
        let message = error(
            "native.workspace.create.partial",
            serde_json::json!({"path":"Garden", "error":"native.workspace.create.markerFailed"}),
        );
        let payload: Value = serde_json::from_str(&message).unwrap();
        assert_eq!(payload["params"]["path"], "Garden");
        assert_eq!(supplied(message.clone(), "native.unavailable"), message);
        assert_eq!(
            supplied("private platform diagnostic", "native.unavailable"),
            "native.unavailable"
        );
    }
}
