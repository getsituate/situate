use super::*;
use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};
use std::collections::HashSet;

/// Only literal inline Markdown links/images are recognized. Destinations with
/// backslash escapes, queries, absolute paths or schemes are left alone. Path
/// bytes use percent encoding on output and are decoded before later resolution.
/// Existing workspace paths are resolved lexically; no filesystem traversal is
/// performed here. Relative fragments retain their exact spelling.
pub(super) fn retarget_paths(
    source: &str,
    old_path: &str,
    new_path: &str,
    mapping: &HashMap<String, String>,
    known: &HashSet<String>,
) -> Result<String> {
    let mut edits = Vec::new();
    let mut output_bytes = source.len();
    let body_offset = crate::metadata::body_offset(source);
    for (event, range) in
        Parser::new_ext(&source[body_offset..], Options::ENABLE_TASKLISTS).into_offset_iter()
    {
        let range = range.start + body_offset..range.end + body_offset;
        let destination = match event {
            Event::Start(Tag::Link {
                link_type: LinkType::Inline,
                dest_url,
                ..
            })
            | Event::Start(Tag::Image {
                link_type: LinkType::Inline,
                dest_url,
                ..
            }) => dest_url,
            _ => continue,
        };
        let raw = destination.as_ref();
        if raw.is_empty()
            || raw.starts_with(['/', '#'])
            || raw.contains([':', '\\', '?', '<', '>'])
            || raw.chars().any(char::is_whitespace)
        {
            continue;
        }
        let (relative, fragment) = raw
            .find('#')
            .map_or((raw, ""), |index| (&raw[..index], &raw[index..]));
        let Some(decoded) = decode_path(relative) else {
            continue;
        };
        let Some(target) = resolve(old_path, &decoded) else {
            continue;
        };
        if !known.contains(&target) {
            continue;
        }
        let new_target = mapping.get(&target).unwrap_or(&target);
        let new_relative = relative_path(new_path, new_target);
        let replacement = format!("{}{fragment}", encode_path(&new_relative));
        if replacement == raw {
            continue;
        }
        let segment = &source[range.clone()];
        let needle = format!("]({raw}");
        let Some(offset) = segment.rfind(&needle) else {
            continue;
        };
        let start = range.start + offset + 2;
        let end = start + raw.len();
        if source[end..].starts_with(')') || source[end..].starts_with(char::is_whitespace) {
            output_bytes = output_bytes - (end - start) + replacement.len();
            if output_bytes as u64 > super::operations::MAX_OPERATION_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "native.content.references.tooLarge",
                )
                .into());
            }
            edits.push((start..end, replacement));
        }
    }
    let mut output = source.to_owned();
    for (range, replacement) in edits.into_iter().rev() {
        output.replace_range(range, &replacement);
    }
    Ok(output)
}
fn decode_path(path: &str) -> Option<String> {
    let mut decoded = Vec::new();
    let mut bytes = path.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let high = (bytes.next()? as char).to_digit(16)?;
            let low = (bytes.next()? as char).to_digit(16)?;
            decoded.push((high * 16 + low) as u8);
        } else {
            decoded.push(byte);
        }
    }
    String::from_utf8(decoded).ok()
}
fn encode_path(path: &str) -> String {
    let mut encoded = String::new();
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}
fn resolve(source: &str, relative: &str) -> Option<String> {
    let mut parts = source.split('/').collect::<Vec<_>>();
    parts.pop();
    for part in relative.split('/') {
        match part {
            "." => {}
            ".." => {
                parts.pop()?;
            }
            "" => return None,
            other => parts.push(other),
        }
    }
    let target = parts.join("/");
    validate_path(&target).ok()?;
    Some(target)
}
fn relative_path(source: &str, target: &str) -> String {
    let mut source = source.split('/').collect::<Vec<_>>();
    source.pop();
    let target = target.split('/').collect::<Vec<_>>();
    let common = source
        .iter()
        .zip(&target)
        .take_while(|(a, b)| a == b)
        .count();
    let mut parts = vec![".."; source.len() - common];
    parts.extend_from_slice(&target[common..]);
    if parts.is_empty() {
        ".".into()
    } else {
        parts.join("/")
    }
}
