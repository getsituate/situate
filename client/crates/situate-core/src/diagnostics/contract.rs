use serde::{Deserialize, Deserializer, Serialize, de::Error};
use serde_json::{Map, Value};
use std::sync::OnceLock;
use uuid::Uuid;

pub const MAX_EVENT_BYTES: usize = 16 * 1024;
pub const MAX_BATCH_BYTES: usize = 64 * 1024;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const CONTRACT: &str = include_str!("../../../../contracts/diagnostics.json");

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Frontend,
    Native,
    Plugin,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OperationContext {
    pub trace_id: String,
    pub span_id: String,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub parent_span_id: Option<String>,
    pub initiator: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EventInput {
    #[serde(deserialize_with = "schema_version")]
    pub schema_version: u8,
    pub event: String,
    pub level: Level,
    pub category: String,
    #[serde(deserialize_with = "safe_integer")]
    pub timestamp_ms: u64,
    #[serde(deserialize_with = "safe_integer")]
    pub sequence: u64,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub context: Option<OperationContext>,
    pub attributes: Map<String, Value>,
}

fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

fn safe_integer<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
    let number = f64::deserialize(deserializer)?;
    if number.is_finite()
        && (0.0..=MAX_SAFE_INTEGER as f64).contains(&number)
        && number.fract() == 0.0
    {
        Ok(number as u64)
    } else {
        Err(D::Error::custom("invalid diagnostic integer"))
    }
}

fn schema_version<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u8, D::Error> {
    let value = safe_integer(deserializer)?;
    if value == 1 {
        Ok(1)
    } else {
        Err(D::Error::custom("invalid diagnostic schema"))
    }
}

pub fn valid_uuid(value: &str) -> bool {
    value.len() == 36 && Uuid::parse_str(value).is_ok_and(|id| id.hyphenated().to_string() == value)
}

pub(super) fn catalog() -> &'static Value {
    static CATALOG: OnceLock<Value> = OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(CONTRACT).unwrap_or(Value::Null))
}

impl EventInput {
    pub fn from_json(bytes: &[u8]) -> Option<Self> {
        if bytes.len() > MAX_EVENT_BYTES {
            return None;
        }
        let event: Self = serde_json::from_slice(bytes).ok()?;
        event.is_valid().then_some(event)
    }

    pub fn is_valid(&self) -> bool {
        if self.schema_version != 1
            || self.timestamp_ms > MAX_SAFE_INTEGER
            || self.sequence > MAX_SAFE_INTEGER
            || self.event.len() > 32
            || self.category.len() > 16
            || self.attributes.len() > 9
        {
            return false;
        }
        let catalog = catalog();
        if !catalog["events"][&self.event]
            .as_array()
            .is_some_and(|categories| {
                categories
                    .iter()
                    .any(|v| v.as_str() == Some(&self.category))
            })
        {
            return false;
        }
        if let Some(context) = &self.context
            && (!valid_uuid(&context.trace_id)
                || !valid_uuid(&context.span_id)
                || context
                    .parent_span_id
                    .as_ref()
                    .is_some_and(|id| !valid_uuid(id))
                || !matches!(context.initiator.as_str(), "user" | "agent" | "background"))
        {
            return false;
        }
        self.attributes.iter().all(|(key, value)| {
            if key.len() > 16 {
                return false;
            }
            let rule = &catalog["attributes"][key];
            if let Some(allowed) = rule.as_array() {
                return value.as_str().is_some_and(|s| {
                    s.len() <= 32 && allowed.iter().any(|v| v.as_str() == Some(s))
                });
            }
            let Some(number) = value.as_f64() else {
                return false;
            };
            number.is_finite()
                && rule["min"].as_f64().is_some_and(|min| number >= min)
                && rule["max"].as_f64().is_some_and(|max| number <= max)
                && (rule["integer"] != true || number.fract() == 0.0)
        })
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct HostIdentity {
    pub device_id: String,
    pub session_id: String,
    pub app_version: String,
    pub platform: String,
    pub platform_version: String,
}

impl HostIdentity {
    pub(crate) fn is_valid(&self) -> bool {
        valid_uuid(&self.device_id)
            && valid_uuid(&self.session_id)
            && [&self.app_version, &self.platform, &self.platform_version]
                .iter()
                .all(|v| {
                    !v.is_empty()
                        && v.len() <= 64
                        && v.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
                })
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct BoundContext {
    pub origin: Origin,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Record {
    #[serde(flatten)]
    pub input: EventInput,
    #[serde(flatten)]
    pub identity: HostIdentity,
    #[serde(flatten)]
    pub bound: BoundContext,
    pub producer_id: String,
    /// Worker delivery order of surviving FIFO records and synthetic loss summaries, not causal order.
    pub collector_sequence: u64,
    pub received_at_ms: u64,
}
