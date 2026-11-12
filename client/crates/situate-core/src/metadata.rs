use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use yaml_rust2::{
    Yaml, YamlLoader,
    scanner::{Scanner, TokenType},
};

const TASK_ID: &str = "situate-task-id";
const MAX_METADATA_BYTES: usize = 1024 * 1024;
const MAX_YAML_DEPTH: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataIssue {
    pub line: usize,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskIdentity {
    pub line: usize,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub tasks: Vec<TaskIdentity>,
    pub issues: Vec<MetadataIssue>,
}

struct Inspection {
    metadata: Metadata,
    protected: Vec<(String, String)>,
    scalars: Vec<(String, std::ops::Range<usize>)>,
}

/// Inspection never rewrites source. Unsupported metadata remains editable, but
/// cannot be used as the basis for identity-dependent operations such as copying.
pub fn inspect(source: &str) -> Metadata {
    analyze(source).metadata
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub text: String,
    pub completed: bool,
    pub checkbox_offset: usize,
}

pub fn inspect_tasks(source: &str) -> Result<Vec<Task>, String> {
    let metadata = inspect(source);
    if let Some(issue) = metadata.issues.iter().find(|issue| {
        matches!(
            issue.message.as_str(),
            "native.metadata.taskDuplicateIdentity" | "native.metadata.taskMultipleIdentities"
        )
    }) {
        return Err(issue.message.clone());
    }
    #[derive(Default)]
    struct Item {
        marker: Option<(usize, bool)>,
        text: String,
        ids: Vec<String>,
    }
    let offset = body_offset(source);
    let mut items: Vec<Item> = Vec::new();
    let mut tasks = Vec::new();
    for (event, range) in
        Parser::new_ext(&source[offset..], Options::ENABLE_TASKLISTS).into_offset_iter()
    {
        match event {
            Event::Start(Tag::Item) => items.push(Item::default()),
            Event::End(TagEnd::Item) => {
                if let Some(item) = items.pop()
                    && let Some((checkbox_offset, completed)) = item.marker
                    && item.ids.len() == 1
                {
                    tasks.push(Task {
                        id: item.ids[0].clone(),
                        text: item.text.trim().to_owned(),
                        completed,
                        checkbox_offset,
                    });
                }
            }
            Event::TaskListMarker(completed) => {
                if let Some(item) = items.last_mut() {
                    item.marker = Some((
                        source[..offset + range.start + 1].encode_utf16().count(),
                        completed,
                    ));
                }
            }
            Event::Text(text) | Event::Code(text) => {
                if let Some(item) = items.last_mut() {
                    item.text.push_str(&text);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some(item) = items.last_mut() {
                    item.text.push(' ');
                }
            }
            Event::Html(_) | Event::InlineHtml(_) => {
                if let Some(item) = items.last_mut() {
                    let line = line_at(source, offset + range.start);
                    for identity in metadata.tasks.iter().filter(|task| task.line == line) {
                        if !item.ids.contains(&identity.id) {
                            item.ids.push(identity.id.clone());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    tasks.sort_by_key(|task| task.checkbox_offset);
    Ok(tasks)
}

/// Compare identities rather than formatting. Unparseable identity-bearing
/// metadata is protected as raw text so deleting a broken ID cannot bypass consent.
pub fn requires_identity_confirmation(before: &str, after: &str) -> bool {
    analyze(before).protected != analyze(after).protected
}

pub fn new_document() -> String {
    String::new()
}

pub fn new_task_comment() -> String {
    format!("<!-- {TASK_ID}: {} -->", Uuid::new_v4())
}

fn issue(result: &mut Inspection, line: usize, message: &str) {
    result.metadata.issues.push(MetadataIssue {
        line,
        message: message.into(),
    });
}

fn line_at(source: &str, offset: usize) -> usize {
    source[..offset].bytes().filter(|b| *b == b'\n').count() + 1
}

fn mapping(text: &str) -> Result<Yaml, &'static str> {
    if text.len() > MAX_METADATA_BYTES {
        return Err("native.metadata.tooLarge");
    }
    let mut depth: usize = 0;
    for token in Scanner::new(text.chars()) {
        match token.1 {
            TokenType::Alias(_) => {
                return Err("native.metadata.aliasesUnsupported");
            }
            TokenType::BlockSequenceStart
            | TokenType::BlockMappingStart
            | TokenType::FlowSequenceStart
            | TokenType::FlowMappingStart => {
                depth += 1;
                if depth > MAX_YAML_DEPTH {
                    return Err("native.metadata.tooDeep");
                }
            }
            TokenType::BlockEnd | TokenType::FlowSequenceEnd | TokenType::FlowMappingEnd => {
                depth = depth.saturating_sub(1);
            }
            _ => {}
        }
    }
    let mut documents =
        YamlLoader::load_from_str(text).map_err(|_| "native.metadata.invalidYaml")?;
    if documents.len() != 1 || !matches!(documents[0], Yaml::Hash(_)) {
        return Err("native.metadata.mappingRequired");
    }
    Ok(documents.remove(0))
}

fn mentions_key(text: &str, key: &str) -> bool {
    text.contains(key)
        || (text.len() <= MAX_METADATA_BYTES
            && Scanner::new(text.chars())
                .any(|token| matches!(token.1, TokenType::Scalar(_, value) if value == key)))
}

fn identity(
    text: &str,
    key: &str,
    line: usize,
    offset: usize,
    result: &mut Inspection,
    prepare_copy: bool,
) -> Option<String> {
    let data = match mapping(text) {
        Ok(data) => data,
        Err(message) => {
            issue(result, line, message);
            if mentions_key(text, key) {
                result.protected.push((key.into(), text.into()));
            }
            return None;
        }
    };
    let value = data
        .as_hash()
        .and_then(|map| map.get(&Yaml::String(key.into())))?;
    if prepare_copy
        && matches!(value, Yaml::Null)
        && let Some(range) = scalar_range(text, key)
        && text[range.clone()].eq_ignore_ascii_case("null")
    {
        result.protected.push((key.into(), String::new()));
        result
            .scalars
            .push((String::new(), offset + range.start..offset + range.end));
        return Some(String::new());
    }
    let valid = value
        .as_str()
        .filter(|value| value.len() == 36)
        .and_then(|value| Uuid::parse_str(value).ok())
        .filter(|id| !id.is_nil());
    match valid {
        Some(id) => {
            let id = id.to_string();
            result.protected.push((key.into(), id.clone()));
            if let Some(range) = scalar_range(text, key) {
                result
                    .scalars
                    .push((id.clone(), offset + range.start..offset + range.end));
            }
            Some(id)
        }
        None => {
            result.protected.push((key.into(), text.into()));
            issue(result, line, "native.metadata.identityInvalid");
            None
        }
    }
}

fn analyze(source: &str) -> Inspection {
    analyze_identities(source, false)
}

fn analyze_identities(source: &str, prepare_copy: bool) -> Inspection {
    let mut result = Inspection {
        metadata: Metadata {
            tasks: Vec::new(),
            issues: Vec::new(),
        },
        protected: Vec::new(),
        scalars: Vec::new(),
    };
    let body_offset = body_offset(source);
    let first = source.split_inclusive('\n').next().unwrap_or("");
    if first
        .trim_start_matches('\u{feff}')
        .trim_end_matches(['\r', '\n'])
        == "---"
    {
        let mut offset = first.len();
        let mut closed = false;
        for line in source[first.len()..].split_inclusive('\n') {
            if matches!(
                line.trim_end_matches(['\r', '\n', ' ', '\t']),
                "---" | "..."
            ) {
                if let Err(message) = mapping(&source[first.len()..offset]) {
                    issue(&mut result, 2, message);
                }
                closed = true;
                break;
            }
            offset += line.len();
        }
        if !closed {
            issue(&mut result, 1, "native.metadata.frontmatterUnclosed");
        }
    }
    let body = &source[body_offset..];
    let mut items: Vec<(bool, usize, usize)> = Vec::new();
    for (event, range) in Parser::new_ext(body, Options::ENABLE_TASKLISTS).into_offset_iter() {
        match event {
            Event::Start(Tag::Item) => items.push((false, 0, range.end)),
            Event::End(TagEnd::Item) => {
                items.pop();
            }
            Event::TaskListMarker(_) => {
                if let Some(item) = items.last_mut() {
                    item.0 = true;
                }
            }
            Event::Text(_) if items.last().is_some_and(|item| item.0) => {
                let remaining = &body[range.start..items.last().unwrap().2];
                if remaining.starts_with("<!--")
                    && mentions_key(remaining, TASK_ID)
                    && !remaining.contains("-->")
                {
                    issue(
                        &mut result,
                        line_at(source, body_offset + range.start),
                        "native.metadata.taskCommentUnclosed",
                    );
                    result.protected.push((TASK_ID.into(), remaining.into()));
                }
            }
            Event::InlineHtml(html) | Event::Html(html)
                if items.last().is_some_and(|item| item.0) =>
            {
                let Some(comment) = html.trim_end_matches(['\r', '\n']).strip_prefix("<!--") else {
                    continue;
                };
                if !mentions_key(comment, TASK_ID) {
                    continue;
                }
                let line = line_at(source, body_offset + range.start);
                let Some(comment) = comment.strip_suffix("-->") else {
                    issue(&mut result, line, "native.metadata.taskCommentUnclosed");
                    result.protected.push((TASK_ID.into(), comment.into()));
                    continue;
                };
                let id = identity(
                    comment,
                    TASK_ID,
                    line,
                    body_offset + range.start + 4,
                    &mut result,
                    prepare_copy,
                );
                if let Some(id) = id {
                    let count = &mut items.last_mut().unwrap().1;
                    *count += 1;
                    if *count > 1 {
                        issue(&mut result, line, "native.metadata.taskMultipleIdentities");
                    }
                    if !id.is_empty() {
                        result.metadata.tasks.push(TaskIdentity { line, id });
                    }
                }
            }
            _ => {}
        }
    }
    let mut seen = std::collections::HashSet::new();
    for task in &result.metadata.tasks {
        if !seen.insert(&task.id) {
            result.metadata.issues.push(MetadataIssue {
                line: task.line,
                message: "native.metadata.taskDuplicateIdentity".into(),
            });
        }
    }
    result.protected.sort();
    result
}

pub(crate) fn body_offset(source: &str) -> usize {
    let mut lines = source.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return 0;
    };
    if first
        .trim_start_matches('\u{feff}')
        .trim_end_matches(['\r', '\n'])
        != "---"
    {
        return 0;
    }
    let mut offset = first.len();
    for line in lines {
        offset += line.len();
        if matches!(
            line.trim_end_matches(['\r', '\n', ' ', '\t']),
            "---" | "..."
        ) {
            return offset;
        }
    }
    source.len()
}

pub(crate) struct IdentityCopy {
    pub source: String,
    pub identities: Vec<(String, String)>,
}

// Only the scalar token is replaced. Re-emitting a parsed YAML mapping would
// discard comments, quoting choices and unknown source formatting.
fn scalar_range(text: &str, key: &str) -> Option<std::ops::Range<usize>> {
    let mut depth = 0usize;
    let mut wanted = false;
    for token in Scanner::new(text.chars()) {
        match token.1 {
            TokenType::BlockMappingStart
            | TokenType::FlowMappingStart
            | TokenType::BlockSequenceStart
            | TokenType::FlowSequenceStart => depth += 1,
            TokenType::BlockEnd | TokenType::FlowMappingEnd | TokenType::FlowSequenceEnd => {
                depth = depth.saturating_sub(1)
            }
            TokenType::Scalar(_, ref value) if depth == 1 && value == key => wanted = true,
            TokenType::Scalar(_, _) if wanted && depth == 1 => {
                let start = text.char_indices().nth(token.0.index()).map(|(i, _)| i)?;
                let tail = &text[start..];
                let end = match tail.as_bytes().first()? {
                    b'\'' => {
                        let mut chars = tail.char_indices().skip(1).peekable();
                        let mut end = None;
                        while let Some((i, c)) = chars.next() {
                            if c == '\'' {
                                if chars.peek().is_some_and(|(_, c)| *c == '\'') {
                                    chars.next();
                                } else {
                                    end = Some(i + 1);
                                    break;
                                }
                            }
                        }
                        end?
                    }
                    b'"' => {
                        let mut escaped = false;
                        let mut end = None;
                        for (i, c) in tail.char_indices().skip(1) {
                            if escaped {
                                escaped = false;
                            } else if c == '\\' {
                                escaped = true;
                            } else if c == '"' {
                                end = Some(i + 1);
                                break;
                            }
                        }
                        end?
                    }
                    _ => tail
                        .find(|c: char| c.is_whitespace() || matches!(c, ',' | '}' | ']'))
                        .unwrap_or(tail.len()),
                };
                return Some(start..start + end);
            }
            _ => {}
        }
    }
    None
}

pub(crate) fn copy_identities(source: &str) -> Result<IdentityCopy, String> {
    let analysis = analyze_identities(source, true);
    // Malformed unrelated metadata is retained. Only protected identities whose
    // scalar cannot be located safely prevent copying.
    if analysis.protected.len() != analysis.scalars.len()
        || analysis
            .metadata
            .issues
            .iter()
            .any(|issue| issue.message == "native.metadata.taskMultipleIdentities")
    {
        return Err("native.metadata.identityRegenerationUnsafe".into());
    }
    let mut output = source.to_owned();
    let mut identities = Vec::new();
    let expected_tasks = analysis.scalars.len();
    let mut scalars = analysis.scalars;
    scalars.sort_by_key(|(_, span)| span.start);
    for (old, span) in scalars.into_iter().rev() {
        if !old.is_empty() && identities.iter().any(|(id, _)| id == &old) {
            return Err("native.metadata.copiedIdentitiesAmbiguous".into());
        }
        let new = Uuid::new_v4().to_string();
        let original = &source[span.clone()];
        let replacement = match original.as_bytes().first() {
            Some(b'\'') => format!("'{new}'"),
            Some(b'"') => format!("\"{new}\""),
            _ if old.is_empty() => format!("\"{new}\""),
            _ => new.clone(),
        };
        output.replace_range(span, &replacement);
        if !old.is_empty() {
            identities.push((old, new));
        }
    }
    // YAML tags can change the meaning of a scalar even after its token is replaced.
    if inspect(&output).tasks.len() != expected_tasks {
        return Err("native.metadata.identityRegenerationUnsafe".into());
    }
    Ok(IdentityCopy {
        source: output,
        identities,
    })
}

/// Creates fresh task identities and retargets recognized task links in a copy.
/// Ordinary edits must preserve their existing task identities instead.
pub fn regenerate_copy(source: &str) -> Result<String, String> {
    let copy = copy_identities(source)?;
    let mapping = copy.identities.into_iter().collect();
    Ok(retarget_identity_links(&copy.source, &mapping))
}

/// Recognizes only inline Markdown links with a literal `situate:<UUID>`
/// destination. Code, reference links, escaped destinations, HTML and unknown
/// schemes are preserved; this is not a universal reference resolver.
pub(crate) fn retarget_identity_links(
    source: &str,
    identities: &std::collections::HashMap<String, String>,
) -> String {
    let mut edits = Vec::new();
    let body_offset = body_offset(source);
    for (event, range) in
        Parser::new_ext(&source[body_offset..], Options::ENABLE_TASKLISTS).into_offset_iter()
    {
        let range = range.start + body_offset..range.end + body_offset;
        if let Event::Start(Tag::Link {
            link_type: pulldown_cmark::LinkType::Inline,
            dest_url,
            ..
        }) = event
            && let Some(raw) = dest_url.strip_prefix("situate:")
            && raw.len() == 36
            && let Ok(id) = Uuid::parse_str(raw)
            && let Some(new) = identities.get(&id.to_string())
        {
            let segment = &source[range.clone()];
            let needle = format!("]({dest_url})");
            if let Some(offset) = segment.rfind(&needle) {
                let start = range.start + offset + 2 + "situate:".len();
                edits.push((start..start + raw.len(), new.clone()));
            }
        }
    }
    let mut output = source.to_owned();
    for (range, text) in edits.into_iter().rev() {
        output.replace_range(range, &text);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    const FILE: &str = "cd906f2c-d76e-4927-bb88-8ad0fa2b6101";
    const TASK: &str = "83901d28-121a-4f08-a0c5-406aad7c7c17";
    const OTHER: &str = "4c966a4e-3d23-4d5e-b96b-7b9a90911948";

    #[test]
    fn task_inspection_preserves_source_and_exposes_utf16_checkbox_positions() {
        let source = format!(
            "\u{feff}---\r\ncustom: [one, two]\r\nsituate-id: {FILE}\r\n---\r\n# 🌱 Garden\r\n- [ ] **Plant** `seeds` <!-- {{\"situate\\u002dtask-id\": '{TASK}', unknown: kept}} -->\r\n  - [X] Water <!--\r\n    situate-task-id: {OTHER}\r\n    -->\r\n- [ ] Ordinary\r\n\r\n```md\r\n- [ ] Example <!-- situate-task-id: {TASK} -->\r\n```\r\n\r\n- [ ] Inline `<!-- situate-task-id: {TASK} -->`\r\n"
        );
        let tasks = inspect_tasks(&source).unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].id, TASK);
        assert_eq!(tasks[0].text, "Plant seeds");
        assert!(!tasks[0].completed);
        assert_eq!(tasks[1].id, OTHER);
        assert!(tasks[1].completed);
        let mut utf16: Vec<u16> = source.encode_utf16().collect();
        assert_eq!(utf16[tasks[0].checkbox_offset], u16::from(b' '));
        assert_eq!(utf16[tasks[1].checkbox_offset], u16::from(b'X'));
        utf16[tasks[0].checkbox_offset] = u16::from(b'x');
        assert_eq!(
            String::from_utf16(&utf16).unwrap(),
            source.replacen("- [ ] **Plant**", "- [x] **Plant**", 1)
        );
    }

    #[test]
    fn task_inspection_rejects_ambiguous_ids_and_ignores_invalid_markers() {
        for source in [
            format!(
                "- [ ] One <!-- situate-task-id: {TASK} -->\n- [ ] Two <!-- situate-task-id: {TASK} -->\n"
            ),
            format!(
                "- [ ] One <!-- situate-task-id: {TASK} --> <!-- situate-task-id: {OTHER} -->\n"
            ),
        ] {
            assert!(inspect_tasks(&source).is_err());
        }
        assert!(
            inspect_tasks("- [ ] Broken <!-- situate-task-id: [bad -->\n")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn task_examples_in_code_and_non_tasks_are_not_identities() {
        let source = format!(
            "```md\n- [ ] Example <!-- situate-task-id: {TASK} -->\n```\n\n    - [ ] Indented <!-- situate-task-id: {TASK} -->\n\n<!-- situate-task-id: {TASK} -->\n\n- Ordinary <!-- situate-task-id: {TASK} -->\n- [ ] Text `<!-- situate-task-id: {TASK} -->`\n"
        );
        assert!(inspect(&source).tasks.is_empty());
    }

    #[test]
    fn escaped_yaml_keys_cannot_hide_task_identity_changes() {
        let source = format!(r#"- [ ] Task <!-- {{"situate\u002dtask-id": {TASK}}} -->"#);
        assert_eq!(inspect(&source).tasks[0].id, TASK);
        assert!(requires_identity_confirmation(
            &source,
            &source.replace(TASK, OTHER)
        ));
        assert!(requires_identity_confirmation(&source, "- [ ] Task\n"));
    }

    #[test]
    fn nested_tasks_keep_separate_identities() {
        let source = format!(
            "- [ ] Outer <!-- situate-task-id: {TASK} -->\n  - [ ] Inner <!-- situate-task-id: {OTHER} -->\n"
        );
        let metadata = inspect(&source);
        assert_eq!(
            metadata
                .tasks
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            [TASK, OTHER]
        );
        assert!(metadata.issues.is_empty());
    }

    #[test]
    fn duplicate_tasks_and_multiple_comments_are_reported() {
        for body in [
            format!(
                "- [ ] One <!-- situate-task-id: {TASK} -->\n- [ ] Two <!-- situate-task-id: {TASK} -->\n"
            ),
            format!(
                "- [ ] One <!-- situate-task-id: {TASK} --> <!-- situate-task-id: {OTHER} -->\n"
            ),
        ] {
            assert!(!inspect(&body).issues.is_empty());
        }
    }

    #[test]
    fn malformed_task_comments_cannot_bypass_confirmation() {
        let source = "- [ ] Task <!-- situate-task-id: [broken -->\n";
        assert!(!inspect(source).issues.is_empty());
        assert!(!requires_identity_confirmation(
            source,
            &source.replace("Task", "Updated task")
        ));
        assert!(requires_identity_confirmation(source, "- [ ] Task\n"));
    }

    #[test]
    fn multiline_and_unclosed_task_comments_are_inspected() {
        let multiline =
            format!("- [ ] Task <!--\n  situate-task-id: {TASK}\n  custom: kept\n  -->\n");
        let metadata = inspect(&multiline);
        assert_eq!(metadata.tasks.len(), 1);
        assert!(metadata.issues.is_empty(), "{:?}", metadata.issues);
        let unclosed = format!("- [ ] Task <!-- situate-task-id: {TASK}");
        assert!(!inspect(&unclosed).issues.is_empty());
        assert!(requires_identity_confirmation(&unclosed, "- [ ] Task"));
    }

    #[test]
    fn frontmatter_is_unprotected_user_metadata() {
        for yaml in ["situate-id: invalid", "situate-id: null", "custom: kept"] {
            let source = format!("---\n{yaml}\n---\n# Kept\n");
            assert!(inspect(&source).issues.is_empty());
            assert!(!requires_identity_confirmation(&source, "# Changed\n"));
            assert_eq!(regenerate_copy(&source).unwrap(), source);
        }
        assert_eq!(new_document(), "");
        assert!(inspect("# No frontmatter\n").issues.is_empty());
    }

    #[test]
    fn malformed_frontmatter_warns_without_identity_protection_or_copy_cleanup() {
        for source in [
            "---\ncustom: [broken\n---\n# Body\n".to_owned(),
            "---\ncustom: kept\n# Unclosed\n".to_owned(),
            "---\nsituate-id: a\nsituate-id: b\n---\n# Body\n".to_owned(),
            "---\n[one, two]\n---\n# Body\n".to_owned(),
            "---\ncustom: &a [one, two]\nother: *a\n---\n# Body\n".to_owned(),
            format!("---\ncustom: {}0{}\n---\n", "[".repeat(70), "]".repeat(70)),
            format!("---\ncustom: {}\n---\n", "a".repeat(MAX_METADATA_BYTES)),
        ] {
            assert!(!inspect(&source).issues.is_empty());
            assert!(!requires_identity_confirmation(&source, "# Changed\n"));
            assert_eq!(regenerate_copy(&source).unwrap(), source);
        }
        let source =
            format!("---\ncustom: [broken\n---\n- [ ] Work <!-- situate-task-id: {TASK} -->\n");
        let copied = regenerate_copy(&source).unwrap();
        assert!(!inspect(&copied).issues.is_empty());
        assert_ne!(inspect_tasks(&copied).unwrap()[0].id, TASK);
        assert!(copied.starts_with("---\ncustom: [broken\n---\n"));
    }

    #[test]
    fn copy_preserves_file_metadata_and_changes_only_task_identity_and_links() {
        let source = format!(
            "---\nsituate-id: {FILE}\ncustom: kept\n---\n- [ ] Work <!-- {{situate-task-id: '{TASK}', due: tomorrow}} -->\n[Task](situate:{TASK}) [Metadata](situate:{FILE})\n"
        );
        let copy = regenerate_copy(&source).unwrap();
        let tasks = inspect_tasks(&copy).unwrap();
        assert_eq!(tasks.len(), 1);
        let fresh = &tasks[0].id;
        assert_ne!(fresh, TASK);
        assert_eq!(copy, source.replace(TASK, fresh));
        assert!(!requires_identity_confirmation(
            &source,
            &source.replace(FILE, OTHER)
        ));
        assert!(requires_identity_confirmation(
            &source,
            &source.replace(TASK, OTHER)
        ));
    }

    #[test]
    fn copied_cancelled_entries_retain_their_source_representation() {
        let cancelled =
            format!("- [-] Cancelled <!-- {{situate-task-id: '{TASK}', status: cancelled}} -->\n");
        let source = format!("# Garden\n{cancelled}");
        let copy = regenerate_copy(&source).unwrap();
        assert_eq!(copy, source);
        assert!(inspect_tasks(&copy).unwrap().is_empty());
        assert!(inspect(&copy).tasks.is_empty());
    }

    #[test]
    fn copy_assigns_native_ids_to_explicit_null_task_intent_only() {
        let source = "- [ ] One <!-- {situate-task-id: null, due: tomorrow} -->\n- [x] Two <!-- situate-task-id: null -->\n- [ ] Packing checklist\n";
        assert!(inspect_tasks(source).unwrap().is_empty());
        let copy = regenerate_copy(source).unwrap();
        let tasks = inspect_tasks(&copy).unwrap();
        assert_eq!(tasks.len(), 2);
        assert_ne!(tasks[0].id, tasks[1].id);
        assert!(!tasks[0].completed);
        assert!(tasks[1].completed);
        assert!(copy.contains("due: tomorrow"));
        assert!(copy.ends_with("- [ ] Packing checklist\n"));
        assert!(regenerate_copy("- [ ] Broken <!-- situate-task-id: invalid -->").is_err());
        assert!(
            regenerate_copy(
                "- [ ] Ambiguous <!-- situate-task-id: null --> <!-- situate-task-id: null -->"
            )
            .is_err()
        );
    }

    #[test]
    fn generated_task_intent_remains_valid_json_in_json_metadata_comments() {
        let source = "- [ ] Work <!-- {\"situate-task-id\":null,\"due\":\"tomorrow\"} -->\n";
        let copy = regenerate_copy(source).unwrap();
        let task = inspect_tasks(&copy).unwrap().remove(0);
        let comment = copy
            .split_once("<!--")
            .unwrap()
            .1
            .split_once("-->")
            .unwrap()
            .0;
        let metadata: serde_json::Value = serde_json::from_str(comment).unwrap();
        assert_eq!(metadata["situate-task-id"], task.id);
        assert_eq!(metadata["due"], "tomorrow");
    }

    #[test]
    fn tagged_null_intent_is_rechecked_as_a_recognized_task_after_preparation() {
        let copy = regenerate_copy("- [ ] Work <!-- situate-task-id: !!null null -->").unwrap();
        assert_eq!(inspect_tasks(&copy).unwrap().len(), 1);
        assert!(inspect(&copy).issues.is_empty());
    }

    #[test]
    fn task_copy_rejects_unsafe_metadata_and_implicit_null_without_rewriting_it() {
        for comment in [
            "situate-task-id: &id [one, two]\nother: *id".to_owned(),
            format!("situate-task-id: {}0{}", "[".repeat(70), "]".repeat(70)),
            format!("situate-task-id: {}", "a".repeat(MAX_METADATA_BYTES)),
            "situate-task-id:\ndue: tomorrow".to_owned(),
        ] {
            let source = format!("- [ ] Work <!--\n{comment}\n-->\n");
            assert!(!inspect(&source).issues.is_empty());
            assert!(regenerate_copy(&source).is_err());
            assert!(requires_identity_confirmation(&source, "- [ ] Work\n"));
        }
    }

    #[test]
    fn generated_task_comment_has_native_v4_identity() {
        let tasks = inspect_tasks(&format!("- [ ] New {}\n", new_task_comment())).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(Uuid::parse_str(&tasks[0].id).unwrap().get_version_num(), 4);
    }
}
