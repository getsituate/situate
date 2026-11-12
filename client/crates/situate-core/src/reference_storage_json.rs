use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::Value;
use std::fmt;

#[derive(Clone, Copy)]
enum Schema {
    Layout,
    Metadata,
    Draft,
    History,
    HistoryData,
    Input,
    Reference,
    Document,
    LayoutState,
    ClosedTab,
    Tab,
    Pane,
    Navigation,
    Entry,
    Target,
    Presentation,
    List(&'static Schema),
    Opaque,
}
impl Schema {
    fn child(self, key: &str) -> Self {
        use Schema::*;
        match (self, key) {
            (Layout, "data") => Document,
            (Metadata, "legacyDraft") => Draft,
            (Draft | Input | HistoryData, "references") => List(&Reference),
            (History, "data") => HistoryData,
            (HistoryData, "input") => Input,
            (Document, "layout") => LayoutState,
            (LayoutState, "tabs") => List(&Tab),
            (LayoutState, "closedTabs") => List(&ClosedTab),
            (ClosedTab, "tab") => Tab,
            (Tab, "panes") => List(&Pane),
            (Pane, "navigation") => Navigation,
            (Navigation, "entries") => List(&Entry),
            (Entry, "target") => Target,
            (Entry, "presentation") => Presentation,
            (Presentation, "reference") => Reference,
            _ => Opaque,
        }
    }
}

pub(crate) fn decode_layout(bytes: &[u8]) -> Result<Value, serde_json::Error> {
    decode(bytes, Schema::Layout)
}
pub(crate) fn decode_metadata(bytes: &[u8]) -> Result<Value, serde_json::Error> {
    decode(bytes, Schema::Metadata)
}
pub(crate) fn decode_history(bytes: &[u8]) -> Result<Value, serde_json::Error> {
    decode(bytes, Schema::History)
}
fn decode(bytes: &[u8], schema: Schema) -> Result<Value, serde_json::Error> {
    let existing: Value = serde_json::from_slice(bytes)?;
    let mut decoder = serde_json::Deserializer::from_slice(bytes);
    let value = Node {
        schema,
        existing: &existing,
    }
    .deserialize(&mut decoder)?;
    decoder.end()?;
    Ok(value)
}
struct Node<'a> {
    schema: Schema,
    existing: &'a Value,
}
impl<'de> DeserializeSeed<'de> for Node<'_> {
    type Value = Value;
    fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        if matches!(self.schema, Schema::Opaque) {
            return serde::Deserialize::deserialize(deserializer);
        }
        deserializer.deserialize_any(self)
    }
}
impl<'de> Visitor<'de> for Node<'_> {
    type Value = Value;
    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("JSON without duplicate schema fields")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut value = serde_json::Map::new();
        while let Some(key) = map.next_key::<String>()? {
            if value.contains_key(&key) {
                return Err(serde::de::Error::custom("duplicate schema field"));
            }
            let schema = if matches!(self.schema, Schema::History)
                && key == "data"
                && !matches!(self.existing["type"].as_str(), Some("message" | "run"))
                || matches!(self.schema, Schema::Entry)
                    && key == "presentation"
                    && (self
                        .existing
                        .pointer("/target/kind")
                        .and_then(Value::as_str)
                        != Some("view")
                        || self
                            .existing
                            .pointer("/target/viewId")
                            .and_then(Value::as_str)
                            != Some("files"))
            {
                Schema::Opaque
            } else {
                self.schema.child(&key)
            };
            let child = Node {
                schema,
                existing: &self.existing[&key],
            };
            value.insert(key.clone(), map.next_value_seed(child)?);
        }
        Ok(Value::Object(value))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
        let schema = match self.schema {
            Schema::List(child) => *child,
            _ => Schema::Opaque,
        };
        let mut values = Vec::new();
        while let Some(value) = seq.next_element_seed(Node {
            schema,
            existing: &self.existing[values.len()],
        })? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }
    fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Value, E> {
        Ok(value.into())
    }
    fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Value, E> {
        Ok(value.into())
    }
    fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Value, E> {
        Ok(value.into())
    }
    fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Value, E> {
        Ok(value.into())
    }
    fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Value, E> {
        Ok(value.into())
    }
}
