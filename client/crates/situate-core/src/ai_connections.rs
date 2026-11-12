use super::*;

#[cfg(test)]
#[path = "ai_connections_tests.rs"]
mod tests;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

const MANIFEST: &str = "ai-connections.json";
pub const ASSOCIATION_REQUIRED: &str = "native.ai.storage.associationRequired";
const INVALID: &str = "native.ai.storage.invalid";
const MISSING: &str = "native.ai.access.required";

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    pub id: String,
    pub revision: String,
    pub config: Value,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub version: u8,
    pub workspace_id: String,
    pub selected: Option<String>,
    pub connections: Vec<Record>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Binding {
    version: u8,
    locations: BTreeMap<String, std::path::PathBuf>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Publication {
    version: u8,
    phase: PublicationPhase,
    before: Option<Manifest>,
    after: Manifest,
    secret: Option<PendingSecret>,
}
#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PublicationPhase {
    Prepared,
    Publishing,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PendingSecret {
    record: Record,
    envelope: Envelope,
    previous_key: Option<String>,
}
fn id() -> String {
    XChaCha20Poly1305::generate_nonce(&mut OsRng)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn valid_id(id: &str) -> bool {
    id.len() == 48
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn check_id(id: &str) -> Result<(), String> {
    if valid_id(id) {
        Ok(())
    } else {
        Err(INVALID.into())
    }
}
fn publish(storage: &Storage, name: &str, bytes: &[u8]) -> Result<(), String> {
    if !storage.replace(name, &format!("{}-{}.tmp", name, id()), bytes)? {
        return Err("native.ai.access.durability".into());
    }
    Ok(())
}
impl Storage {
    pub(super) fn lock_device_credentials(&self) -> Result<StorageLock, String> {
        let manifest = match self.connection_manifest()? {
            Some(manifest) => manifest,
            None => {
                let _initialization = self.device()?.lock_named("initialization.lock")?;
                match self.connection_manifest()? {
                    Some(manifest) => manifest,
                    None => {
                        let manifest = Manifest {
                            version: 1,
                            workspace_id: self.workspace_identity()?,
                            selected: None,
                            connections: vec![],
                        };
                        self.bind(&manifest)?;
                        self.publish_manifest(&manifest)?;
                        manifest
                    }
                }
            }
        };
        self.device()?
            .lock_named(&format!("credentials-{}.lock", manifest.workspace_id))
    }
    pub fn with_device_store(mut self, path: &Path) -> Result<Self, String> {
        if path.starts_with(&self.location) {
            return Err(ERROR.into());
        }
        let (root, components) = storage_root(path)?;
        let mut dir = Dir::open_ambient_dir(root, ambient_authority()).map_err(|_| ERROR)?;
        for component in components {
            let Component::Normal(name) = component else {
                return Err(ERROR.into());
            };
            dir = cap_primitives::fs::open_dir_nofollow(&dir.into_std_file(), Path::new(name))
                .map(Dir::from_std_file)
                .map_err(|_| ERROR)?;
        }
        self.device = Some(Box::new(Storage {
            dir,
            scope: String::new(),
            conversation_indexes: Default::default(),
            location: path.to_owned(),
            device: None,
            access_guard: None,
        }));
        Ok(self)
    }
    fn device(&self) -> Result<&Storage, String> {
        self.device.as_deref().ok_or_else(|| ERROR.into())
    }
    fn existing_workspace_identity(&self) -> Result<Option<String>, String> {
        Ok(self
            .bindings()?
            .locations
            .into_iter()
            .find(|(_, location)| location == &self.location)
            .map(|(id, _)| id))
    }
    fn workspace_identity(&self) -> Result<String, String> {
        if let Some(identity) = self.existing_workspace_identity()? {
            return Ok(identity);
        }
        let _lock = self.device()?.lock_named("associations.lock")?;
        let mut bindings = self.bindings()?;
        if let Some((id, _)) = bindings
            .locations
            .iter()
            .find(|(_, location)| **location == self.location)
        {
            return Ok(id.clone());
        }
        let identity = id();
        bindings
            .locations
            .insert(identity.clone(), self.location.clone());
        publish(
            self.device()?,
            "associations.json",
            &serde_json::to_vec(&bindings).map_err(|_| ERROR)?,
        )?;
        Ok(identity)
    }
    pub fn connection_manifest(&self) -> Result<Option<Manifest>, String> {
        if self.device.is_none() {
            return Ok(None);
        }
        let Some(identity) = self.existing_workspace_identity()? else {
            return Ok(None);
        };
        let name = format!("{identity}-{MANIFEST}");
        let Some(bytes) = self.device()?.read_named(&name, 262_144)? else {
            return Ok(None);
        };
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        check_id(&manifest.workspace_id)?;
        if manifest.version != 1 || manifest.connections.len() > 100 {
            return Err(INVALID.into());
        }
        let mut seen = HashSet::new();
        for record in &manifest.connections {
            check_id(&record.id)?;
            check_id(&record.revision)?;
            if !seen.insert(&record.id) || record.config["connectionId"] != record.id {
                return Err(INVALID.into());
            }
        }
        if manifest
            .selected
            .as_ref()
            .is_some_and(|id| !seen.contains(id))
        {
            return Err(INVALID.into());
        }
        Ok(Some(manifest))
    }
    fn bindings(&self) -> Result<Binding, String> {
        let Some(bytes) = self.device()?.read_named("associations.json", 1_048_576)? else {
            return Ok(Binding {
                version: 1,
                locations: BTreeMap::new(),
            });
        };
        let binding: Binding = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        if binding.version != 1 || binding.locations.keys().any(|id| !valid_id(id)) {
            return Err(INVALID.into());
        }
        Ok(binding)
    }
    fn authorize(&self, manifest: &Manifest) -> Result<(), String> {
        if self.bindings()?.locations.get(&manifest.workspace_id) != Some(&self.location) {
            return Err(ASSOCIATION_REQUIRED.into());
        }
        Ok(())
    }
    fn publish_manifest(&self, manifest: &Manifest) -> Result<(), String> {
        let bytes = serde_json::to_vec(manifest).map_err(|_| ERROR)?;
        if bytes.len() > 262_144 {
            return Err(ERROR.into());
        }
        #[cfg(test)]
        if tests::FAIL_MANIFEST.with(std::cell::Cell::get) {
            return Err(ERROR.into());
        }
        publish(
            self.device()?,
            &format!("{}-{}", self.workspace_identity()?, MANIFEST),
            &bytes,
        )
    }
    fn pending_name(&self) -> Result<Option<String>, String> {
        Ok(self
            .connection_manifest()?
            .map(|m| format!("publication-{}.json", m.workspace_id)))
    }
    pub fn has_pending_connection_publication(&self) -> Result<bool, String> {
        let Some(name) = self.pending_name()? else {
            return Ok(false);
        };
        Ok(self.device()?.read_named(&name, 1_048_576)?.is_some())
    }
    pub fn conflicting_connection_publication(&self) -> Result<Option<Record>, String> {
        let Some(name) = self.pending_name()? else {
            return Ok(None);
        };
        let Some(bytes) = self.device()?.read_named(&name, 1_048_576)? else {
            return Ok(None);
        };
        let pending: Publication = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        match self.merge_publication(&pending, pending.phase == PublicationPhase::Prepared) {
            Ok(_) => Ok(None),
            Err(error) if error == "native.ai.storage.publicationConflict" => {
                Ok(pending.secret.map(|s| s.record).or_else(|| {
                    pending.before.and_then(|before| {
                        before
                            .connections
                            .into_iter()
                            .find(|r| !pending.after.connections.iter().any(|next| r.id == next.id))
                    })
                }))
            }
            Err(error) => Err(error),
        }
    }
    pub fn recover_connection_publication(&self, keys: &impl KeyStore) -> Result<(), String> {
        let Some(name) = self.pending_name()? else {
            return Ok(());
        };
        let Some(bytes) = self.device()?.read_named(&name, 1_048_576)? else {
            return Ok(());
        };
        let pending: Publication = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        self.finish_publication(keys, &name, pending)
    }
    fn finish_publication(
        &self,
        keys: &impl KeyStore,
        name: &str,
        mut pending: Publication,
    ) -> Result<(), String> {
        let allow_additions = pending.phase == PublicationPhase::Prepared;
        self.merge_publication(&pending, allow_additions)?;
        self.authorize(&pending.after)?;
        if let Some(secret) = &pending.secret {
            if !pending.after.connections.contains(&secret.record) {
                return Err(INVALID.into());
            }
            let bytes = serde_json::to_vec(&secret.envelope).map_err(|_| ERROR)?;
            Self::decrypt_bytes(keys, &pending.after, &secret.record, &bytes)?;
            publish(
                self.device()?,
                &Self::secret_name(&pending.after, &secret.record),
                &bytes,
            )?;
        }
        let (mut current, mut merged) = self.merge_publication(&pending, allow_additions)?;
        if current != merged && pending.phase == PublicationPhase::Prepared {
            // Persist intent before rename: an interrupted publication cannot prove
            // whether a missing new record was never published or later removed.
            pending.phase = PublicationPhase::Publishing;
            pending = self.write_publication(name, &pending)?;
            (current, merged) = self.merge_publication(&pending, allow_additions)?;
        }
        if current != merged {
            self.publish_manifest(&merged)?;
        }
        if !self.device()?.sync_directory() {
            return Err("native.ai.access.durability".into());
        }
        if self.connection_manifest()?.as_ref() != Some(&merged) {
            return Err("native.ai.storage.publicationConflict".into());
        }
        if let Some(before) = &pending.before {
            for old in &before.connections {
                if !pending
                    .after
                    .connections
                    .iter()
                    .any(|r| r.id == old.id && r.revision == old.revision)
                {
                    self.forget_record(keys, before, old)?;
                }
            }
        }
        if let Some(previous) = pending
            .secret
            .as_ref()
            .and_then(|s| s.previous_key.as_ref())
        {
            check_id(previous)?;
            keys.delete(&format!("connection:{previous}"))?;
        }
        self.device()?.dir.remove_file(name).map_err(|_| ERROR)?;
        if !self.device()?.sync_directory() {
            return Err(ERROR.into());
        }
        Ok(())
    }
    fn merge_publication(
        &self,
        pending: &Publication,
        allow_additions: bool,
    ) -> Result<(Manifest, Manifest), String> {
        let conflict = "native.ai.storage.publicationConflict";
        let mut current = self.connection_manifest()?.ok_or(conflict)?;
        let original = current.clone();
        let before = pending.before.as_ref().ok_or(conflict)?;
        if pending.version != 1
            || current.workspace_id != before.workspace_id
            || current.workspace_id != pending.after.workspace_id
        {
            return Err(conflict.into());
        }
        for old in &before.connections {
            let next = pending.after.connections.iter().find(|r| r.id == old.id);
            let is_secret = pending
                .secret
                .as_ref()
                .is_some_and(|s| s.record.id == old.id);
            if next == Some(old) && !is_secret {
                continue;
            }
            let found = current.connections.iter().find(|r| r.id == old.id);
            if found != Some(old) && found != next {
                return Err(conflict.into());
            }
            if found == Some(old) && next != Some(old) {
                current.connections.retain(|r| r.id != old.id);
                if let Some(next) = next {
                    current.connections.push(next.clone());
                }
            }
        }
        for next in &pending.after.connections {
            if !before.connections.iter().any(|r| r.id == next.id) {
                match current.connections.iter().find(|r| r.id == next.id) {
                    Some(found) if found != next => return Err(conflict.into()),
                    Some(_) => (),
                    None if allow_additions => current.connections.push(next.clone()),
                    None => return Err(conflict.into()),
                }
            }
        }
        if before.selected != pending.after.selected && current.selected == before.selected {
            current.selected = pending.after.selected.clone();
        }
        if current
            .selected
            .as_ref()
            .is_some_and(|id| !current.connections.iter().any(|r| &r.id == id))
        {
            current.selected = None;
        }
        Ok((original, current))
    }
    pub fn discard_connection_publication(
        &self,
        keys: &impl KeyStore,
        id: &str,
    ) -> Result<bool, String> {
        let Some(name) = self.pending_name()? else {
            return Ok(false);
        };
        let Some(bytes) = self.device()?.read_named(&name, 1_048_576)? else {
            return Ok(false);
        };
        let pending: Publication = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        self.authorize(&pending.after)?;
        if let Some(secret) = &pending.secret {
            if secret.record.id != id {
                return Ok(false);
            }
            check_id(&secret.envelope.key_id)?;
            keys.delete(&format!("connection:{}", secret.envelope.key_id))?;
            if let Some(previous) = &secret.previous_key {
                check_id(previous)?;
                keys.delete(&format!("connection:{previous}"))?;
            }
            self.forget_record(keys, &pending.after, &secret.record)?;
            if let Some(old) = pending
                .before
                .as_ref()
                .and_then(|before| before.connections.iter().find(|r| r.id == id))
            {
                self.forget_record(keys, pending.before.as_ref().ok_or(INVALID)?, old)?;
            }
        } else {
            let Some(before) = pending.before.as_ref() else {
                return Err(INVALID.into());
            };
            let Some(old) = before.connections.iter().find(|r| r.id == id) else {
                return Ok(false);
            };
            if pending.after.connections.iter().any(|r| r.id == id) {
                return Ok(false);
            }
            self.forget_record(keys, before, old)?;
        }
        self.device()?.dir.remove_file(&name).map_err(|_| ERROR)?;
        if !self.device()?.sync_directory() {
            return Err(ERROR.into());
        }
        Ok(true)
    }
    fn commit_connections(
        &self,
        keys: &impl KeyStore,
        before: Option<Manifest>,
        after: Manifest,
        secret: Option<PendingSecret>,
    ) -> Result<(), String> {
        let name = format!("publication-{}.json", after.workspace_id);
        if self.device()?.read_named(&name, 1_048_576)?.is_some() {
            return Err("native.ai.storage.publicationPending".into());
        }
        let pending = Publication {
            version: 1,
            phase: PublicationPhase::Prepared,
            before,
            after,
            secret,
        };
        let recovered = self.write_publication(&name, &pending)?;
        self.finish_publication(keys, &name, recovered)
    }
    fn write_publication(&self, name: &str, pending: &Publication) -> Result<Publication, String> {
        let bytes = serde_json::to_vec(pending).map_err(|_| ERROR)?;
        if bytes.len() > 1_048_576 {
            return Err(ERROR.into());
        }
        publish(self.device()?, name, &bytes)?;
        let readback = self.device()?.read_named(name, 1_048_576)?.ok_or(ERROR)?;
        if readback != bytes {
            return Err(INVALID.into());
        }
        serde_json::from_slice(&readback).map_err(|_| INVALID.into())
    }
    fn bind(&self, manifest: &Manifest) -> Result<(), String> {
        let _transaction = self.device()?.lock_named("associations.lock")?;
        let mut bindings = self.bindings()?;
        bindings
            .locations
            .insert(manifest.workspace_id.clone(), self.location.clone());
        publish(
            self.device()?,
            "associations.json",
            &serde_json::to_vec(&bindings).map_err(|_| ERROR)?,
        )
    }
    pub fn new_connection_id() -> String {
        id()
    }
    pub fn connection_record(&self, id: &str) -> Result<Record, String> {
        check_id(id)?;
        self.connection_manifest()?
            .ok_or(MISSING)?
            .connections
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| MISSING.into())
    }
    pub fn selected_connection(&self) -> Result<Option<Record>, String> {
        let Some(manifest) = self.connection_manifest()? else {
            return Ok(None);
        };
        Ok(manifest
            .connections
            .into_iter()
            .find(|r| Some(&r.id) == manifest.selected.as_ref()))
    }
    pub fn select_connection(&self, id: &str) -> Result<(), String> {
        let mut manifest = self.connection_manifest()?.ok_or(MISSING)?;
        self.authorize(&manifest)?;
        if !manifest.connections.iter().any(|r| r.id == id) {
            return Err(MISSING.into());
        }
        manifest.selected = Some(id.into());
        self.publish_manifest(&manifest)
    }
    fn aad(manifest: &Manifest, record: &Record) -> Result<Vec<u8>, String> {
        serde_json::to_vec(&(
            "situate-device-connection-v1",
            &manifest.workspace_id,
            record,
        ))
        .map_err(|_| ERROR.into())
    }
    fn secret_name(manifest: &Manifest, record: &Record) -> String {
        format!(
            "{}-{}-{}.json",
            manifest.workspace_id, record.id, record.revision
        )
    }
    fn decrypt_record(
        &self,
        keys: &impl KeyStore,
        manifest: &Manifest,
        record: &Record,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        if !self
            .bindings()?
            .locations
            .contains_key(&manifest.workspace_id)
        {
            return Ok(None);
        }
        self.authorize(manifest)?;
        let Some(bytes) = self
            .device()?
            .read_named(&Self::secret_name(manifest, record), 262_144)?
        else {
            return Ok(None);
        };
        Self::decrypt_bytes(keys, manifest, record, &bytes).map(Some)
    }
    fn decrypt_bytes(
        keys: &impl KeyStore,
        manifest: &Manifest,
        record: &Record,
        bytes: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, String> {
        let envelope: Envelope = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
        if envelope.version != 1 || envelope.nonce.len() != 24 || !valid_id(&envelope.key_id) {
            return Err(INVALID.into());
        }
        let key = Zeroizing::new(keys.get(&format!("connection:{}", envelope.key_id))?);
        let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|_| LOCKED)?;
        let data = cipher
            .decrypt(
                envelope.nonce.as_slice().into(),
                Payload {
                    msg: &envelope.ciphertext,
                    aad: &Self::aad(manifest, record)?,
                },
            )
            .map(Zeroizing::new)
            .map_err(|_| LOCKED)?;
        Ok(data)
    }
    pub fn load_connection(
        &self,
        keys: &impl KeyStore,
        id: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        let manifest = self.connection_manifest()?.ok_or(MISSING)?;
        let record = manifest
            .connections
            .iter()
            .find(|r| r.id == id)
            .ok_or(MISSING)?;
        self.decrypt_record(keys, &manifest, record)
    }
    pub fn load_captured_connection(
        &self,
        keys: &impl KeyStore,
        captured: &Manifest,
        record: &Record,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        if captured.version != 1 || !captured.connections.contains(record) {
            return Err(INVALID.into());
        }
        check_id(&captured.workspace_id)?;
        check_id(&record.id)?;
        check_id(&record.revision)?;
        self.decrypt_record(keys, captured, record)
    }
    pub(super) fn load_selected_connection(
        &self,
        keys: &impl KeyStore,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        let Some(record) = self.selected_connection()? else {
            return Ok(None);
        };
        self.load_connection(keys, &record.id)
    }
    fn prepare_secret(
        &self,
        keys: &impl KeyStore,
        manifest: &Manifest,
        record: &Record,
        data: &[u8],
    ) -> Result<PendingSecret, String> {
        if data.len() > 65_536 {
            return Err(ERROR.into());
        }
        let old = self
            .device()?
            .read_named(&Self::secret_name(manifest, record), 262_144)?
            .map(|bytes| serde_json::from_slice::<Envelope>(&bytes).map_err(|_| INVALID.to_owned()))
            .transpose()?;
        let key = Zeroizing::new(XChaCha20Poly1305::generate_key(&mut OsRng).to_vec());
        let key_id = id();
        let account = format!("connection:{key_id}");
        keys.set(&account, &key)?;
        if *Zeroizing::new(keys.get(&account)?) != *key {
            return Err(LOCKED.into());
        }
        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
        let ciphertext = XChaCha20Poly1305::new_from_slice(&key)
            .map_err(|_| ERROR)?
            .encrypt(
                &nonce,
                Payload {
                    msg: data,
                    aad: &Self::aad(manifest, record)?,
                },
            )
            .map_err(|_| ERROR)?;
        Ok(PendingSecret {
            record: record.clone(),
            envelope: Envelope {
                version: 1,
                key_id,
                nonce: nonce.to_vec(),
                ciphertext,
            },
            previous_key: old.map(|old| old.key_id),
        })
    }
    pub fn save_connection(
        &self,
        keys: &impl KeyStore,
        id: &str,
        config: Value,
        data: &[u8],
        replace: bool,
    ) -> Result<(), String> {
        check_id(id)?;
        if config["connectionId"] != id {
            return Err(INVALID.into());
        }
        self.recover_connection_publication(keys)?;
        let mut manifest = match self.connection_manifest()? {
            Some(manifest) => {
                if !self
                    .bindings()?
                    .locations
                    .contains_key(&manifest.workspace_id)
                {
                    self.bind(&manifest)?;
                }
                self.authorize(&manifest)?;
                manifest
            }
            None => {
                let manifest = Manifest {
                    version: 1,
                    workspace_id: self.workspace_identity()?,
                    selected: None,
                    connections: vec![],
                };
                self.bind(&manifest)?;
                self.publish_manifest(&manifest)?;
                manifest
            }
        };
        let before = manifest.clone();
        let position = manifest.connections.iter().position(|r| r.id == id);
        if replace != position.is_some()
            || (position.is_none() && manifest.connections.len() >= 100)
        {
            return Err(INVALID.into());
        }
        if let Some(index) = position {
            // An unreadable previous record is never silently replaced.
            self.decrypt_record(keys, &manifest, &manifest.connections[index])?;
        }
        let revision = position
            .and_then(|i| {
                let old = &manifest.connections[i];
                (old.config == config).then(|| old.revision.clone())
            })
            .unwrap_or_else(self::id);
        let record = Record {
            id: id.into(),
            revision,
            config,
        };
        let secret = self.prepare_secret(keys, &manifest, &record, data)?;
        match position {
            Some(i) => manifest.connections[i] = record,
            None => manifest.connections.push(record),
        }
        if !replace && manifest.selected.is_none() {
            manifest.selected = Some(id.into());
        }
        self.commit_connections(keys, Some(before), manifest, Some(secret))
    }
    pub(super) fn refresh_selected_connection(
        &self,
        keys: &impl KeyStore,
        data: &[u8],
    ) -> Result<(), String> {
        self.recover_connection_publication(keys)?;
        let manifest = self.connection_manifest()?.ok_or(MISSING)?;
        self.authorize(&manifest)?;
        let record = manifest
            .connections
            .iter()
            .find(|r| Some(&r.id) == manifest.selected.as_ref())
            .ok_or(MISSING)?;
        self.refresh_connection(keys, &manifest, record, data)
    }
    /// The caller resolves pending publication before renewal and holds the credential
    /// lock from the authenticated snapshot read through this save. A reconciliation
    /// conflict retains the returned grant in the device journal.
    pub fn refresh_connection(
        &self,
        keys: &impl KeyStore,
        captured: &Manifest,
        record: &Record,
        data: &[u8],
    ) -> Result<(), String> {
        self.load_captured_connection(keys, captured, record)?
            .ok_or(MISSING)?;
        let value: Value = serde_json::from_slice(data).map_err(|_| INVALID)?;
        if value["config"] != record.config {
            return Err(INVALID.into());
        }
        let secret = self.prepare_secret(keys, captured, record, data)?;
        self.commit_connections(keys, Some(captured.clone()), captured.clone(), Some(secret))
    }
    pub fn rename_connection(
        &self,
        keys: &impl KeyStore,
        id: &str,
        label: &str,
    ) -> Result<(), String> {
        let label = label.trim();
        if label.is_empty() || label.len() > 256 || label.chars().any(char::is_control) {
            return Err("native.ai.connection.labelInvalid".into());
        }
        self.recover_connection_publication(keys)?;
        let mut manifest = self.connection_manifest()?.ok_or(MISSING)?;
        self.authorize(&manifest)?;
        if manifest.connections.iter().any(|record| {
            record.id != id
                && record.config["label"]
                    .as_str()
                    .is_some_and(|other| other.eq_ignore_ascii_case(label))
        }) {
            return Err("native.ai.connection.labelInvalid".into());
        }
        let index = manifest
            .connections
            .iter()
            .position(|record| record.id == id)
            .ok_or(MISSING)?;
        let record = &manifest.connections[index];
        let mut config = record.config.clone();
        config["label"] = Value::String(label.into());
        if let Some(bytes) = self.decrypt_record(keys, &manifest, record)? {
            let mut connection: Value = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
            connection["config"] = config.clone();
            return self.save_connection(
                keys,
                id,
                config,
                &serde_json::to_vec(&connection).map_err(|_| ERROR)?,
                true,
            );
        }
        let before = manifest.clone();
        manifest.connections[index].config = config;
        manifest.connections[index].revision = self::id();
        self.commit_connections(keys, Some(before), manifest, None)
    }
    pub fn forget_connection(&self, keys: &impl KeyStore, id: &str) -> Result<(), String> {
        let discarded = self.discard_connection_publication(keys, id)?;
        let manifest = self.connection_manifest()?.ok_or(MISSING)?;
        self.authorize(&manifest)?;
        let Some(record) = manifest.connections.iter().find(|r| r.id == id) else {
            return if discarded {
                Ok(())
            } else {
                Err(MISSING.into())
            };
        };
        self.forget_record(keys, &manifest, record)
    }
    fn forget_record(
        &self,
        keys: &impl KeyStore,
        manifest: &Manifest,
        record: &Record,
    ) -> Result<(), String> {
        if let Some(bytes) = self
            .device()?
            .read_named(&Self::secret_name(manifest, record), 262_144)?
        {
            let envelope: Envelope = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
            check_id(&envelope.key_id)?;
            keys.delete(&format!("connection:{}", envelope.key_id))?;
        }
        match self
            .device()?
            .dir
            .remove_file(Self::secret_name(manifest, record))
        {
            Ok(()) => {
                if self.device()?.sync_directory() {
                    Ok(())
                } else {
                    Err(ERROR.into())
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(ERROR.into()),
        }
    }
    pub fn remove_connection(&self, keys: &impl KeyStore, id: Option<&str>) -> Result<(), String> {
        let Some(mut manifest) = self.connection_manifest()? else {
            return Ok(());
        };
        self.authorize(&manifest)?;
        let Some(id) = id.or(manifest.selected.as_deref()).map(str::to_owned) else {
            return Ok(());
        };
        let discarded = self.discard_connection_publication(keys, &id)?;
        if !manifest.connections.iter().any(|r| r.id == id) {
            return if discarded {
                Ok(())
            } else {
                Err(MISSING.into())
            };
        }
        let before = manifest.clone();
        manifest.connections.retain(|r| r.id != id);
        if manifest.selected.as_ref() == Some(&id) {
            manifest.selected = None;
        }
        self.commit_connections(keys, Some(before), manifest, None)
    }
    pub(super) fn read_workspace_preference(
        &self,
        name: &str,
        limit: u64,
    ) -> Result<Option<Vec<u8>>, String> {
        self.device()?.read_named(
            &format!("{}-{name}.json", self.workspace_identity()?),
            limit,
        )
    }
    pub(super) fn save_workspace_preference(&self, name: &str, bytes: &[u8]) -> Result<(), String> {
        publish(
            self.device()?,
            &format!("{}-{name}.json", self.workspace_identity()?),
            bytes,
        )
    }
    fn conversation_preferences_name(&self, conversation: &str) -> Result<String, String> {
        if conversation.is_empty()
            || conversation.len() > 128
            || !conversation
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Err(INVALID.into());
        }
        Ok(format!(
            "conversation-{}-{conversation}.json",
            self.workspace_identity()?
        ))
    }
    pub fn read_conversation_preferences(
        &self,
        conversation: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        if self.existing_workspace_identity()?.is_none() {
            return Ok(None);
        }
        self.device()?
            .read_named(&self.conversation_preferences_name(conversation)?, 65_536)
    }
    pub fn save_conversation_preferences(
        &self,
        conversation: &str,
        bytes: &[u8],
    ) -> Result<(), String> {
        if bytes.len() > 65_536 {
            return Err(ERROR.into());
        }
        publish(
            self.device()?,
            &self.conversation_preferences_name(conversation)?,
            bytes,
        )
    }
    pub fn lock_preferences(&self) -> Result<StorageLock, String> {
        self.device()?
            .lock_named(&format!("preferences-{}.lock", self.workspace_identity()?))
    }
    pub fn read_connection_model(&self, id: &str) -> Result<Option<Vec<u8>>, String> {
        check_id(id)?;
        self.device()?.read_named(&format!("model-{id}.json"), 4096)
    }
    pub fn save_connection_model(&self, id: &str, bytes: &[u8]) -> Result<(), String> {
        check_id(id)?;
        if bytes.len() > 4096 {
            return Err(ERROR.into());
        }
        publish(self.device()?, &format!("model-{id}.json"), bytes)
    }
    pub fn read_connection_settings(&self, id: &str) -> Result<Option<Vec<u8>>, String> {
        check_id(id)?;
        self.device()?
            .read_named(&format!("settings-{id}.json"), 65_536)
    }
    pub fn save_connection_settings(&self, id: &str, bytes: &[u8]) -> Result<(), String> {
        check_id(id)?;
        if bytes.len() > 65_536 {
            return Err(ERROR.into());
        }
        publish(self.device()?, &format!("settings-{id}.json"), bytes)
    }
}
