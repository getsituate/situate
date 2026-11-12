use crate::{
    ai_storage::Storage, conversation_runtime::ContentReference, reference_storage::LocalReference,
};
use serde::{Deserialize, Serialize};
use sha1collisiondetection::Sha1CD;
use std::{collections::HashSet, path::Path};

const FILE: &str = "native-onboarding.json";
const INVALID: &str = "native.onboarding.storage.invalid";
const FAILED: &str = "native.onboarding.storage.failed";
const CONFLICT: &str = "native.onboarding.storage.conflict";
const MAX_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Access,
    Method,
    Proposal,
    Sources,
    Review,
    Support,
    Complete,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Intent {
    Keep,
    Change,
    #[default]
    Help,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Choice {
    Develop,
    Save,
    Discard,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportIdea {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub reason: String,
    pub assignment: String,
    #[serde(deserialize_with = "required")]
    pub choice: Option<Choice>,
    pub development_id: String,
    pub plugin_id: String,
    #[serde(deserialize_with = "required")]
    pub note_path: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstructionBase {
    pub text: String,
    pub revision: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnboardingRecord<R = ContentReference> {
    pub schema_version: u8,
    pub step: Step,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub fresh: bool,
    #[serde(default)]
    pub intent: Intent,
    #[serde(default)]
    pub entered: bool,
    pub description: String,
    pub approaches: Vec<String>,
    pub feedback: String,
    pub proposal: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub open_points: Vec<String>,
    #[serde(deserialize_with = "required")]
    pub instruction_base: Option<InstructionBase>,
    #[serde(deserialize_with = "required")]
    pub instruction_revision: Option<String>,
    #[serde(deserialize_with = "required")]
    pub method_conversation_id: Option<String>,
    pub source_description: String,
    #[serde(deserialize_with = "required")]
    pub source_conversation_id: Option<String>,
    #[serde(deserialize_with = "required")]
    pub support_conversation_id: Option<String>,
    pub imported: Vec<R>,
    pub ideas: Vec<SupportIdea>,
    pub paused: bool,
}

fn required<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}

impl Default for OnboardingRecord {
    fn default() -> Self {
        Self {
            schema_version: 1,
            step: Step::Access,
            conversation_id: None,
            fresh: false,
            intent: Intent::Help,
            entered: false,
            description: String::new(),
            approaches: vec![],
            feedback: String::new(),
            proposal: String::new(),
            open_points: vec![],
            instruction_base: None,
            instruction_revision: None,
            method_conversation_id: None,
            source_description: String::new(),
            source_conversation_id: None,
            support_conversation_id: None,
            imported: vec![],
            ideas: vec![],
            paused: false,
        }
    }
}

impl<R> OnboardingRecord<R> {
    fn map_references<T>(
        self,
        mut map: impl FnMut(R) -> Result<T, ()>,
    ) -> Result<OnboardingRecord<T>, ()> {
        Ok(OnboardingRecord {
            schema_version: self.schema_version,
            step: self.step,
            conversation_id: self.conversation_id,
            fresh: self.fresh,
            intent: self.intent,
            entered: self.entered,
            description: self.description,
            approaches: self.approaches,
            feedback: self.feedback,
            proposal: self.proposal,
            open_points: self.open_points,
            instruction_base: self.instruction_base,
            instruction_revision: self.instruction_revision,
            method_conversation_id: self.method_conversation_id,
            source_description: self.source_description,
            source_conversation_id: self.source_conversation_id,
            support_conversation_id: self.support_conversation_id,
            imported: self
                .imported
                .into_iter()
                .map(&mut map)
                .collect::<Result<_, _>>()?,
            ideas: self.ideas,
            paused: self.paused,
        })
    }
}

fn valid_revision(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

impl OnboardingRecord {
    pub fn validate(&self, scope: &str) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("native.onboarding.storage.unsupported".into());
        }
        if [
            &self.description,
            &self.feedback,
            &self.proposal,
            &self.source_description,
        ]
        .iter()
        .any(|s| s.len() > 65_536)
            || (self.entered
                && (self.instruction_revision.is_none()
                    || matches!(self.step, Step::Access | Step::Method)))
            || self.open_points.len() > 8
            || self
                .open_points
                .iter()
                .any(|s| s.trim().is_empty() || s.len() > 2048)
            || self.approaches.len() > 32
            || self.approaches.iter().any(|s| s.len() > 256)
            || self
                .instruction_base
                .as_ref()
                .is_some_and(|b| b.text.len() > 65_536 || !valid_revision(&b.revision))
            || self
                .instruction_revision
                .as_ref()
                .is_some_and(|s| !valid_revision(s))
            || [
                &self.conversation_id,
                &self.method_conversation_id,
                &self.source_conversation_id,
                &self.support_conversation_id,
            ]
            .iter()
            .any(|id| id.as_ref().is_some_and(|s| !valid_id(s)))
            || self.imported.len() > 10_000
            || self
                .imported
                .iter()
                .any(|r| !r.validate() || r.workspace_id() != scope)
            || self.ideas.len() > 32
        {
            return Err(INVALID.into());
        }
        let mut ids = HashSet::new();
        let mut developments = HashSet::new();
        for idea in &self.ideas {
            if !valid_id(&idea.id)
                || !ids.insert(&idea.id)
                || !developments.insert(&idea.development_id)
                || idea.title.trim().is_empty()
                || idea.title.len() > 512
                || idea.detail.len() > 65_536
                || idea.reason.len() > 65_536
                || idea.assignment.len() > 16_384
                || (idea.choice == Some(Choice::Develop) && idea.assignment.trim().is_empty())
                || !uuid::Uuid::parse_str(&idea.development_id)
                    .is_ok_and(|id| id.to_string() == idea.development_id)
                || !crate::plugins::valid_id(&idea.plugin_id)
                || idea.note_path.as_ref().is_some_and(|path| {
                    path.len() > 4096 || crate::content::validate_portable_path(path).is_err()
                })
            {
                return Err(INVALID.into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub record: Option<OnboardingRecord>,
    pub revision: Option<String>,
    pub writable: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope<R> {
    version: u8,
    generation: String,
    record: OnboardingRecord<R>,
}

pub struct OnboardingStorage(Storage);
impl OnboardingStorage {
    pub fn open(root: &Path, scope: &str) -> Result<Self, String> {
        Storage::open(root, scope)
            .map(Self)
            .map_err(|_| FAILED.into())
    }
    pub fn from_storage(storage: Storage) -> Self {
        Self(storage)
    }
    pub fn load(&self) -> Result<Snapshot, String> {
        self.read()?
            .map(|bytes| decode(&bytes, &self.0.scope))
            .unwrap_or_else(|| {
                Ok(Snapshot {
                    record: None,
                    revision: None,
                    writable: true,
                })
            })
    }
    pub fn initialize(&self) -> Result<Snapshot, String> {
        let saved = self.load()?;
        if saved.record.is_some() {
            return Ok(saved);
        }
        self.save(None, OnboardingRecord::default())
    }
    pub fn save(
        &self,
        expected_revision: Option<&str>,
        record: OnboardingRecord,
    ) -> Result<Snapshot, String> {
        record.validate(&self.0.scope)?;
        let stored = record
            .map_references(|r| LocalReference::store(r, &self.0.scope))
            .map_err(|_| INVALID)?;
        let bytes = encode(stored)?;
        let _lock = self
            .0
            .lock_named("native-onboarding.lock")
            .map_err(|_| "native.onboarding.storage.busy")?;
        let previous = self.read()?;
        let previous_snapshot = previous
            .as_deref()
            .map(|bytes| decode(bytes, &self.0.scope))
            .transpose()?;
        let revision = previous_snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.revision.as_deref());
        if revision != expected_revision {
            return Err(CONFLICT.into());
        }
        let saved = decode(&bytes, &self.0.scope)?;
        if saved
            .record
            .as_ref()
            .is_some_and(|record| record.entered && record.step == Step::Proposal)
            && !previous_snapshot
                .and_then(|snapshot| snapshot.record)
                .is_some_and(|record| record.entered)
        {
            return Err(INVALID.into());
        }
        if self.read()? != previous {
            return Err(CONFLICT.into());
        }
        if !self
            .0
            .replace(
                FILE,
                &format!("native-onboarding-{}.tmp", uuid::Uuid::new_v4()),
                &bytes,
            )
            .map_err(|_| FAILED)?
        {
            return Err("native.onboarding.storage.durability".into());
        }
        Ok(saved)
    }
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        match self.0.dir.symlink_metadata(FILE) {
            Ok(metadata) if metadata.is_file() => {}
            Ok(_) => return Err(FAILED.into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(FAILED.into()),
        }
        self.0
            .read_named(FILE, MAX_BYTES)
            .map_err(|_| FAILED.into())
    }
}

fn encode<R: Serialize>(record: OnboardingRecord<R>) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(&Envelope {
        version: 1,
        generation: uuid::Uuid::new_v4().to_string(),
        record,
    })
    .map_err(|_| INVALID)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("native.onboarding.storage.tooLarge".into());
    }
    Ok(bytes)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) fn initialize_marker(marker: &cap_std::fs::Dir) -> std::io::Result<()> {
    #[cfg(test)]
    use crate::workspaces::onboarding_tests::{Checkpoint, checkpoint};
    use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
    use cap_std::fs::{OpenOptions, OpenOptionsExt};
    use std::io::Write;

    let bytes = encode(OnboardingRecord::default()).map_err(std::io::Error::other)?;
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .mode(0o600)
        .follow(FollowSymlinks::No);
    let mut file = marker.open_with(FILE, &options)?;
    #[cfg(test)]
    checkpoint(Checkpoint::ProgressWrite, marker)?;
    file.write_all(&bytes)?;
    #[cfg(test)]
    checkpoint(Checkpoint::ProgressSync, marker)?;
    file.sync_all()
}

fn decode(bytes: &[u8], scope: &str) -> Result<Snapshot, String> {
    let raw: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if raw
        .get("version")
        .and_then(|v| v.as_u64())
        .is_some_and(|v| v != 1)
        || raw
            .pointer("/record/schemaVersion")
            .and_then(|v| v.as_u64())
            .is_some_and(|v| v != 1)
    {
        return Err("native.onboarding.storage.unsupported".into());
    }
    let envelope: Envelope<LocalReference> = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if envelope.version != 1
        || !uuid::Uuid::parse_str(&envelope.generation)
            .is_ok_and(|id| id.to_string() == envelope.generation)
    {
        return Err(INVALID.into());
    }
    let record = envelope
        .record
        .map_references(|r| r.bind(scope))
        .map_err(|_| INVALID)?;
    record.validate(scope)?;
    let mut hash = Sha1CD::default();
    hash.update(bytes);
    let digest = hash.finalize_cd().map_err(|_| INVALID)?;
    Ok(Snapshot {
        record: Some(record),
        revision: Some(digest.iter().map(|b| format!("{b:02x}")).collect()),
        writable: true,
    })
}

#[cfg(test)]
#[path = "onboarding_tests.rs"]
mod tests;
