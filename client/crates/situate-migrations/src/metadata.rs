use crate::{
    MigrationDescriptor, MigrationError, MigrationErrorKind, Result, filesystem, registry,
};
use cap_std::fs::Dir;
use semver::Version;
use serde_json::{Value, json};

pub const FILE: &str = "migrations.json";
pub(crate) const LIMIT: u64 = 64 * 1024;

pub(crate) fn initial() -> Value {
    json!({"minimumAppVersion":"0.0.0","lastAppliedMigration":0})
}
pub(crate) struct Metadata<'a> {
    pub legacy_floor: &'a str,
    pub position: u64,
    pub reader_epoch: Option<u64>,
}

pub(crate) fn parse(value: &Value) -> Result<Metadata<'_>> {
    let invalid = || MigrationError::new(MigrationErrorKind::InvalidMetadata);
    let minimum = value
        .get("minimumAppVersion")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    Version::parse(minimum).map_err(|_| invalid())?;
    let position = value
        .get("lastAppliedMigration")
        .and_then(Value::as_u64)
        .ok_or_else(invalid)?;
    let reader_epoch = value
        .get("minimumReaderEpoch")
        .map(|epoch| {
            epoch
                .as_u64()
                .filter(|epoch| *epoch <= position)
                .ok_or_else(invalid)
        })
        .transpose()?;
    Ok(Metadata {
        legacy_floor: minimum,
        position,
        reader_epoch,
    })
}

pub(crate) fn require_reader(value: &Value, migrations: &[MigrationDescriptor]) -> Result<u64> {
    let metadata = parse(value)?;
    let expected = registry::reader_at(migrations, metadata.position);
    if let Some(epoch) = metadata.reader_epoch {
        let supported = registry::reader_at(migrations, u64::MAX);
        if epoch > supported.epoch {
            return Err(MigrationError::new(
                MigrationErrorKind::ReaderUpdateRequired,
            ));
        }
        if epoch != expected.epoch || metadata.legacy_floor != expected.legacy_floor {
            return Err(MigrationError::new(MigrationErrorKind::InvalidMetadata));
        }
    } else if metadata.legacy_floor != expected.legacy_floor
        // Before sealed releases, development builds recorded the package version for migration 3.
        && !(expected.epoch == 3 && metadata.position == 3 && metadata.legacy_floor == "0.1.6")
    {
        return Err(MigrationError::update(metadata.legacy_floor));
    }
    Ok(metadata.position)
}

pub(crate) fn advance(value: &mut Value, position: u64, migrations: &[MigrationDescriptor]) {
    let reader = registry::reader_at(migrations, position);
    value["minimumAppVersion"] = reader.legacy_floor.into();
    value["minimumReaderEpoch"] = reader.epoch.into();
    value["lastAppliedMigration"] = position.into();
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
