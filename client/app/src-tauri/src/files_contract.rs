use serde::{Deserialize, Serialize};
use situate_core::content::TextVersion;

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WireRequest {
    Snapshot {
        workspace_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        plugin_id: Option<String>,
        #[serde(
            default,
            deserialize_with = "present_value",
            skip_serializing_if = "Option::is_none"
        )]
        include_deleted: Option<bool>,
    },
    Read {
        workspace_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        plugin_id: Option<String>,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    InspectTasks {
        workspace_id: String,
        path: String,
    },
    CaptureReference {
        workspace_id: String,
        path: String,
        #[serde(
            default,
            deserialize_with = "present_value",
            skip_serializing_if = "Option::is_none"
        )]
        expected_revision: Option<String>,
    },
    ResolveReference {
        workspace_id: String,
        reference: situate_core::conversation_runtime::ContentReference,
        #[serde(
            default,
            deserialize_with = "present_value",
            skip_serializing_if = "Option::is_none"
        )]
        render: Option<bool>,
    },
    Stage {
        workspace_id: String,
        path: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        base: Option<TextVersion>,
    },
    Save {
        workspace_id: String,
        path: String,
        text: String,
        base: TextVersion,
        #[serde(skip_serializing_if = "Option::is_none")]
        confirm_id_change: Option<bool>,
    },
    Resolve {
        workspace_id: String,
        path: String,
        token: String,
        choice: Choice,
    },
    Discard {
        workspace_id: String,
        path: String,
    },
    Create {
        workspace_id: String,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        destination: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    Mkdir {
        workspace_id: String,
        path: String,
    },
    Rename {
        workspace_id: String,
        path: String,
        destination: String,
    },
    Copy {
        workspace_id: String,
        path: String,
        destination: String,
    },
    Delete {
        workspace_id: String,
        path: String,
    },
    History {
        workspace_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        exact_path: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        revision: Option<String>,
    },
    Revision {
        workspace_id: String,
        path: String,
        revision: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        exact_path: Option<bool>,
    },
    Restore {
        workspace_id: String,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        revision: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        destination: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        base: Option<TextVersion>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    HistoricalCopy {
        workspace_id: String,
        path: String,
        revision: String,
        destination: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        exact_path: Option<bool>,
    },
    Revert {
        workspace_id: String,
        path: String,
        revision: String,
    },
    OpenExternal {
        workspace_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        plugin_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        href: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        destination: Option<String>,
    },
    Resource {
        workspace_id: String,
        path: String,
    },
    Export {
        workspace_id: String,
        path: String,
        text: String,
    },
    Detach {
        workspace_id: String,
        #[serde(
            default,
            deserialize_with = "present_value",
            skip_serializing_if = "Option::is_none"
        )]
        force: Option<bool>,
    },
    QuitReady {
        workspace_id: String,
        token: String,
    },
    CancelQuit {
        workspace_id: String,
        token: String,
    },
}

fn present_value<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Choice {
    Editor,
    External,
}

impl WireRequest {
    fn valid(&self) -> bool {
        match self {
            Self::CaptureReference {
                expected_revision, ..
            } => expected_revision.as_ref().is_none_or(|revision| {
                revision.len() == 40
                    && revision
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            }),
            Self::ResolveReference {
                workspace_id,
                reference,
                ..
            } => reference.validate() && workspace_id == reference.workspace_id(),
            Self::Restore {
                revision,
                destination,
                base,
                text,
                ..
            } => match revision {
                Some(_) => base.is_none() && text.is_none(),
                None => destination.is_none() && base.is_some() && text.is_some(),
            },
            Self::OpenExternal {
                path,
                href,
                destination,
                ..
            } => {
                (path.is_some() && href.is_none() && destination.is_none())
                    || (path.is_none() && href.is_some() && destination.is_some())
            }
            Self::History {
                path,
                exact_path: Some(true),
                revision,
                ..
            } => path.is_some() && revision.is_some(),
            Self::History { revision, .. } => revision.is_none(),
            _ => true,
        }
    }
}
impl<'de> Deserialize<'de> for super::Request {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = WireRequest::deserialize(deserializer)
            .map_err(|_| serde::de::Error::custom("Invalid file request."))?;
        if !wire.valid() {
            return Err(serde::de::Error::custom("Invalid file request."));
        }
        let value = serde_json::to_value(wire).map_err(serde::de::Error::custom)?;
        let fields: super::RequestFields = serde_json::from_value(value)
            .map_err(|_| serde::de::Error::custom("Invalid file request."))?;
        Ok(fields.into())
    }
}
