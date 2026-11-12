use super::*;
use chacha20poly1305::{
    XChaCha20Poly1305,
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
};
use zeroize::Zeroizing;

pub type Secret = Zeroizing<Vec<u8>>;

const ERROR: &str = "native.plugins.hostFailed";
const FILE: &str = "credentials.json";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    version: u32,
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

pub fn new_key() -> Zeroizing<Vec<u8>> {
    Zeroizing::new(XChaCha20Poly1305::generate_key(&mut OsRng).to_vec())
}

fn owner(root: &Path, id: &str, expected: &str) -> Result<Dir, String> {
    let plugin = folder::plugin(root, id)?;
    let marker = child(&plugin, ".runtime").map_err(|e| e.to_string())?;
    if folder::read(&marker, "identity")?.as_deref() != Some(expected.as_bytes()) {
        return Err("native.plugins.stateConflict".into());
    }
    Ok(marker)
}

pub fn load(
    root: &Path,
    id: &str,
    scope: &str,
    key: &[u8],
    expected: &str,
) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
    let marker = owner(root, id, expected)?;
    let Some(bytes) = folder::read(&marker, FILE)? else {
        return Ok(None);
    };
    let envelope: Envelope = serde_json::from_slice(&bytes).map_err(|_| ERROR)?;
    if envelope.version != 1 || envelope.nonce.len() != 24 {
        return Err(ERROR.into());
    }
    let aad = format!("plugin:{scope}:{id}:{expected}");
    XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| ERROR)?
        .decrypt(
            envelope.nonce.as_slice().into(),
            Payload {
                msg: &envelope.ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .map(Zeroizing::new)
        .map(Some)
        .map_err(|_| ERROR.into())
}

pub fn save(
    root: &Path,
    id: &str,
    scope: &str,
    key: &[u8],
    bytes: &[u8],
    expected: &str,
) -> Result<(), String> {
    if bytes.len() > 65_536 {
        return Err("native.plugins.tooLarge".into());
    }
    let marker = owner(root, id, expected)?;
    let aad = format!("plugin:{scope}:{id}:{expected}");
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| ERROR)?
        .encrypt(
            &nonce,
            Payload {
                msg: bytes,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| ERROR)?;
    let bytes = serde_json::to_vec(&Envelope {
        version: 1,
        nonce: nonce.to_vec(),
        ciphertext,
    })
    .map_err(|_| ERROR)?;
    if !folder::replace(&marker, FILE, &bytes)? {
        return Err("native.plugins.stateOutcomeUnknown".into());
    }
    Ok(())
}

pub fn pending_migration(root: &Path) -> Result<Vec<String>, String> {
    let mut pending = vec![];
    for (id, marker) in folder::records(root)? {
        if folder::read(&marker, "credential-migration")?.as_deref() == Some(b"pending") {
            pending.push(id);
        }
    }
    Ok(pending)
}

pub fn finish_migration(root: &Path, id: &str) -> Result<(), String> {
    let marker = folder::metadata(&folder::plugin(root, id)?)?;
    if !folder::replace(&marker, "credential-migration", b"complete")? {
        return Err("native.plugins.stateOutcomeUnknown".into());
    }
    Ok(())
}

pub fn sync(root: &Path, id: &str) -> Result<(), String> {
    let plugin = folder::plugin(root, id)?;
    let marker = folder::metadata(&plugin)?;
    folder::sync_metadata(&marker)?;
    crate::durable_storage::sync_directory(&plugin)
        .map_err(|_| "native.plugins.stateOutcomeUnknown".into())
}
