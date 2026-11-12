use super::Operation;
use serde::{Deserialize, Serialize};
use situate_core::content::TextVersion;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    path: String,
    version: TextVersion,
    html: String,
    issues: Vec<Issue>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Issue {
    line: usize,
    message: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    path: String,
    is_directory: bool,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Draft {
    path: String,
    #[serde(deserialize_with = "required_nullable")]
    base: Option<TextVersion>,
    text: String,
}
fn required_nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeletedEntry {
    path: String,
    revision: String,
    is_directory: bool,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    writable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    can_export: Option<bool>,
    #[serde(deserialize_with = "required_nullable")]
    reason: Option<String>,
    entries: Vec<Entry>,
    drafts: Vec<Draft>,
    #[serde(skip_serializing_if = "Option::is_none")]
    deleted: Option<Vec<DeletedEntry>>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryEntry {
    revision: String,
    message: String,
    timestamp: i64,
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    deleted: Option<bool>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum OkPayload {
    Reference(ReferencePayload),
    ResolvedReference(ResolvedReferencePayload),
    Snapshot(SnapshotPayload),
    Document(DocumentPayload),
    Tasks(TasksPayload),
    History(HistoryPayload),
    Resource(ResourcePayload),
    Empty(EmptyPayload),
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SnapshotPayload {
    snapshot: Snapshot,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReferencePayload {
    reference: situate_core::conversation_runtime::ContentReference,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResolvedReferencePayload {
    reference: situate_core::conversation_runtime::ContentReference,
    document: Document,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentPayload {
    document: Document,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TasksPayload {
    document: Document,
    tasks: Vec<situate_core::metadata::Task>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryPayload {
    history: Vec<HistoryEntry>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourcePayload {
    data_url: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EmptyPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Reply {
    Ok {
        #[serde(flatten)]
        payload: OkPayload,
    },
    Saved {
        document: Document,
        #[serde(
            default,
            deserialize_with = "present_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        submitted_revision: Option<Option<String>>,
        #[serde(
            default,
            deserialize_with = "present_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        message: Option<Option<String>>,
    },
    SavedHistoryFailed {
        document: Document,
        message: String,
        #[serde(
            default,
            deserialize_with = "present_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        submitted_revision: Option<Option<String>>,
    },
    SavedDraftCleanupFailed {
        document: Document,
        message: String,
        #[serde(
            default,
            deserialize_with = "present_nullable",
            skip_serializing_if = "Option::is_none"
        )]
        submitted_revision: Option<Option<String>>,
    },
    Conflict {
        editor: String,
        external: TextVersion,
        base: TextVersion,
        token: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    Binary,
    Deleted,
    Changed {
        #[serde(skip_serializing_if = "Option::is_none")]
        base: Option<TextVersion>,
    },
    IdentityConfirmation,
    Cancelled,
    PartialFailure {
        changed_paths: Vec<String>,
        #[serde(deserialize_with = "required_nullable")]
        recovery_revision: Option<String>,
        message: String,
    },
}
fn present_nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}
impl Reply {
    pub(super) fn validate(
        operation: &Operation,
        value: serde_json::Value,
    ) -> Result<Self, String> {
        let reply: Self = serde_json::from_value(value.clone())
            .map_err(|_| "Invalid file response.".to_owned())?;
        let normalized =
            serde_json::to_value(&reply).map_err(|_| "Invalid file response.".to_owned())?;
        if value
            .as_object()
            .is_none_or(|fields| fields.keys().any(|key| normalized.get(key).is_none()))
        {
            return Err("Invalid file response.".into());
        }
        use Operation as O;
        let valid = matches!(
            (&reply, operation),
            (
                Self::Ok {
                    payload: OkPayload::Reference(_)
                },
                O::CaptureReference
            ) | (
                Self::Ok {
                    payload: OkPayload::ResolvedReference(_)
                },
                O::ResolveReference
            ) | (
                Self::Ok {
                    payload: OkPayload::Snapshot(_),
                },
                O::Snapshot,
            ) | (
                Self::Ok {
                    payload: OkPayload::Document(_),
                },
                O::Read | O::Revision | O::OpenExternal,
            ) | (
                Self::Ok {
                    payload: OkPayload::Tasks(_),
                },
                O::InspectTasks,
            ) | (
                Self::Ok {
                    payload: OkPayload::History(_),
                },
                O::History,
            ) | (
                Self::Ok {
                    payload: OkPayload::Resource(_),
                },
                O::Resource,
            ) | (
                Self::Ok {
                    payload: OkPayload::Empty(_),
                },
                O::Stage
                    | O::Discard
                    | O::Mkdir
                    | O::Rename
                    | O::Copy
                    | O::Delete
                    | O::HistoricalCopy
                    | O::Restore
                    | O::Revert
                    | O::OpenExternal
                    | O::Export
                    | O::Detach
                    | O::QuitReady
                    | O::CancelQuit,
            ) | (
                Self::Saved { .. }
                    | Self::SavedHistoryFailed { .. }
                    | Self::SavedDraftCleanupFailed { .. },
                O::Save | O::Resolve | O::Create | O::Restore | O::Revert,
            ) | (
                Self::Conflict { .. } | Self::Changed { .. },
                O::Save | O::Resolve | O::Restore | O::Revert,
            ) | (
                Self::Deleted,
                O::Read
                    | O::InspectTasks
                    | O::Revision
                    | O::Save
                    | O::Resolve
                    | O::Restore
                    | O::Revert
                    | O::ResolveReference,
            ) | (Self::Binary, O::Read)
                | (Self::IdentityConfirmation, O::Save)
                | (Self::Cancelled, O::Export)
                | (
                    Self::PartialFailure { .. },
                    O::Mkdir
                        | O::Rename
                        | O::Copy
                        | O::Delete
                        | O::HistoricalCopy
                        | O::Restore
                        | O::Revert,
                )
        );
        let reference_valid = match &reply {
            Self::Ok {
                payload: OkPayload::Reference(payload),
            } => {
                payload.reference.validate()
                    && matches!(
                        &payload.reference,
                        situate_core::conversation_runtime::ContentReference::Live { .. }
                    )
            }
            Self::Ok {
                payload: OkPayload::ResolvedReference(payload),
            } => payload.reference.validate(),
            _ => true,
        };
        if valid && reference_valid {
            Ok(reply)
        } else {
            Err("Invalid file response.".into())
        }
    }
}
