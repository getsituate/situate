use crate::{MigrationError, MigrationErrorKind, Result, filesystem};
use cap_std::fs::Dir;
use semver::Version;
use serde_json::{Value, json};

pub const FILE: &str = "migrations.json";
pub(crate) const LIMIT: u64 = 64 * 1024;

pub(crate) fn initial() -> Value {
    json!({"minimumAppVersion":"0.0.0","lastAppliedMigration":0})
}
pub(crate) fn parse(value: &Value) -> Result<(Version, u64)> {
    let invalid = || MigrationError::new(MigrationErrorKind::InvalidMetadata);
    let minimum = value
        .get("minimumAppVersion")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let version = Version::parse(minimum).map_err(|_| invalid())?;
    let position = value
        .get("lastAppliedMigration")
        .and_then(Value::as_u64)
        .ok_or_else(invalid)?;
    Ok((version, position))
}
pub(crate) fn load(dir: &Dir) -> Result<Option<Value>> {
    match dir.symlink_metadata(FILE) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
        Ok(m) if !m.is_file() || m.len() > LIMIT => {
            return Err(MigrationError::new(MigrationErrorKind::InvalidMetadata));
        }
        _ => {}
    }
    let bytes = filesystem::bounded_read(dir, FILE, LIMIT)?;
    Ok(Some(decode(&bytes)?))
}
pub(crate) fn decode(bytes: &[u8]) -> Result<Value> {
    if bytes.len() as u64 > LIMIT {
        return Err(MigrationError::new(MigrationErrorKind::InvalidMetadata));
    }
    use serde::de::Deserializer;
    struct Object;
    impl<'de> serde::de::Visitor<'de> for Object {
        type Value = Value;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("a workspace compatibility object with unique fields")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(
            self,
            mut map: M,
        ) -> std::result::Result<Value, M::Error> {
            let mut fields = serde_json::Map::new();
            while let Some((key, value)) = map.next_entry::<String, Value>()? {
                if fields.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom("duplicate compatibility field"));
                }
            }
            Ok(Value::Object(fields))
        }
    }
    let mut decoder = serde_json::Deserializer::from_slice(bytes);
    let value = decoder
        .deserialize_map(Object)
        .map_err(|_| MigrationError::new(MigrationErrorKind::InvalidMetadata))?;
    decoder
        .end()
        .map_err(|_| MigrationError::new(MigrationErrorKind::InvalidMetadata))?;
    parse(&value)?;
    Ok(value)
}
pub(crate) fn save(dir: &Dir, value: &Value) -> Result<()> {
    parse(value)?;
    let bytes = serde_json::to_vec(value)
        .map_err(|_| MigrationError::new(MigrationErrorKind::InvalidMetadata))?;
    if bytes.len() as u64 > LIMIT {
        return Err(MigrationError::new(MigrationErrorKind::InvalidMetadata));
    }
    filesystem::replace(dir, FILE, &bytes)
}
