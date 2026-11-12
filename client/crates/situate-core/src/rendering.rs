use pulldown_cmark::{Event, Options, Parser, Tag, html};

/// Image resolution belongs to the workspace host. It must constrain local reads
/// and return only an image URL, never document HTML. Comments remain hidden;
/// other raw HTML is displayed as text.
pub fn render_markdown(source: &str, mut image_url: impl FnMut(&str) -> Option<String>) -> String {
    let options =
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    let body = markdown_body(source);
    let body_offset = source.len() - body.len();
    let mut previous_byte = 0;
    let mut source_offset = 0;
    let events =
        Parser::new_ext(body, options)
            .into_offset_iter()
            .map(|(event, range)| match event {
                Event::Start(
                    tag @ (Tag::Paragraph
                    | Tag::Heading { .. }
                    | Tag::CodeBlock(_)
                    | Tag::Item
                    | Tag::BlockQuote(_)),
                ) => {
                    let byte = body_offset + range.start;
                    source_offset += source[previous_byte..byte].encode_utf16().count();
                    previous_byte = byte;
                    let mut opening = String::new();
                    html::push_html(&mut opening, std::iter::once(Event::Start(tag)));
                    if let Some(end) = opening.find('>') {
                        opening
                            .insert_str(end, &format!(" data-source-offset=\"{source_offset}\""));
                    }
                    Event::Html(opening.into())
                }
                Event::Html(text) | Event::InlineHtml(text) => {
                    let trimmed = text.trim();
                    if trimmed.starts_with("<!--") && trimmed.find("-->") == Some(trimmed.len() - 3)
                    {
                        Event::Text("".into())
                    } else {
                        Event::Text(text)
                    }
                }
                Event::Start(Tag::Link {
                    link_type,
                    dest_url,
                    title,
                    id,
                }) => {
                    let destination = if allowed_link(&dest_url) {
                        dest_url
                    } else {
                        "#".into()
                    };
                    Event::Start(Tag::Link {
                        link_type,
                        dest_url: destination,
                        title,
                        id,
                    })
                }
                Event::Start(Tag::Image {
                    link_type,
                    dest_url,
                    title,
                    id,
                }) => {
                    let destination = image_url(&dest_url)
                        .filter(|url| {
                            let lower = url.to_ascii_lowercase();
                            !url.chars().any(char::is_control)
                                && (lower.starts_with("https://")
                                    || lower.starts_with("http://")
                                    || lower.starts_with("data:image/"))
                        })
                        .unwrap_or_default();
                    Event::Start(Tag::Image {
                        link_type,
                        dest_url: destination.into(),
                        title,
                        id,
                    })
                }
                other => other,
            });
    let mut output = String::new();
    html::push_html(&mut output, events);
    output
}

pub fn allowed_link(url: &str) -> bool {
    if url.chars().any(char::is_control) || url.contains('\\') || url.starts_with("//") {
        return false;
    }
    match url
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .split_once(':')
    {
        None => true,
        Some((scheme, _)) => matches!(
            scheme.to_ascii_lowercase().as_str(),
            "https" | "http" | "mailto" | "situate"
        ),
    }
}

fn markdown_body(source: &str) -> &str {
    let mut lines = source.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return source;
    };
    if first
        .trim_start_matches('\u{feff}')
        .trim_end_matches(['\r', '\n'])
        != "---"
    {
        return source;
    }
    let mut offset = first.len();
    for line in lines {
        offset += line.len();
        if matches!(
            line.trim_end_matches(['\r', '\n', ' ', '\t']),
            "---" | "..."
        ) {
            return &source[offset..];
        }
    }
    source
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_baseline_markdown_without_editable_checkboxes() {
        let source = "# Title\n\n**bold** *italic* ~~removed~~\n\n- [ ] Pending\n- [x] Done\n\n> Quote\n\n```js\na < b\n```\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n";
        let result = render_markdown(source, |_| None);
        for expected in [
            "<h1 data-source-offset=\"0\">Title</h1>",
            "<strong>bold</strong>",
            "<em>italic</em>",
            "<del>removed</del>",
            "disabled=",
            "checked=",
            "<blockquote data-source-offset=",
            "<pre data-source-offset=",
            "a &lt; b",
            "<table>",
        ] {
            assert!(result.contains(expected), "{expected}: {result}");
        }
    }

    #[test]
    fn raw_html_and_active_urls_cannot_execute() {
        let source = "<script>alert(1)</script>\n\n<form action='https://example.invalid'><input></form>\n\n[x](javascript:alert%281%29) [y](data:text/html,bad) [z](file:///private)\n\n<img src=x onerror=alert(1)>\n";
        let result = render_markdown(source, |_| None);
        assert!(!result.contains("<script>"));
        assert!(!result.contains("<form"));
        assert!(!result.contains("<img src=x"));
        assert!(!result.contains("href=\"javascript:"));
        assert!(!result.contains("href=\"data:"));
        assert!(!result.contains("href=\"file:"));
        assert!(result.contains("&lt;script&gt;"));
    }

    #[test]
    fn image_loading_uses_the_host_resolver_and_escapes_attributes() {
        let mut requested = Vec::new();
        let result = render_markdown(
            "![Remote](https://example.invalid/image.png) ![Local](images/a.png) ![Blocked](javascript:bad)",
            |url| {
                requested.push(url.to_owned());
                match url {
                    "images/a.png" => Some("data:image/png;base64,AA==".into()),
                    value => Some(value.to_owned()),
                }
            },
        );
        assert_eq!(
            requested,
            [
                "https://example.invalid/image.png",
                "images/a.png",
                "javascript:bad"
            ]
        );
        assert!(result.contains("src=\"https://example.invalid/image.png\""));
        assert!(result.contains("src=\"data:image/png;base64,AA==\""));
        assert!(!result.contains("src=\"javascript:"));
    }

    #[test]
    fn frontmatter_is_hidden_without_changing_source_and_broken_frontmatter_stays_visible() {
        let source = "\u{feff}---\r\nsituate-id: kept\r\ncustom: preserved\r\n---\r\n# Body\r\n";
        assert_eq!(
            render_markdown(source, |_| None),
            "<h1 data-source-offset=\"48\">Body</h1>\n"
        );
        assert!(source.contains("custom: preserved"));
        assert!(
            render_markdown("---\nsituate-id: broken", |_| None).contains("situate-id: broken")
        );
    }

    #[test]
    fn task_metadata_and_comments_stay_hidden_but_code_examples_remain_visible() {
        let result = render_markdown(
            "- [ ] Task <!-- situate-task-id: 12345678-1234-4123-8123-123456789abc -->\n\n<!-- private comment -->\n\n`<!-- example -->`\n",
            |_| None,
        );
        assert!(result.contains("Task"));
        assert!(!result.contains("situate-task-id"));
        assert!(!result.contains("private comment"));
        assert!(result.contains("<code>&lt;!-- example --&gt;</code>"));
    }

    #[test]
    fn block_offsets_include_frontmatter_and_count_utf16_not_utf8() {
        let source =
            "\u{feff}---\r\nlabel: 🦀\r\n---\r\n# Café\r\n\r\nRepeat 🦀\r\n\r\nRepeat 🦀\r\n";
        let result = render_markdown(source, |_| None);
        assert_eq!(
            result,
            concat!(
                "<h1 data-source-offset=\"22\">Café</h1>\n",
                "<p data-source-offset=\"32\">Repeat 🦀</p>\n",
                "<p data-source-offset=\"45\">Repeat 🦀</p>\n",
            )
        );
    }

    #[test]
    fn nested_blocks_and_fenced_code_keep_distinct_parser_positions() {
        let source = "> Same\n>\n> Same\n\n- Same\n  - Same\n\n```rust\nSame\n```\n";
        let result = render_markdown(source, |_| None);
        for expected in [
            "<blockquote data-source-offset=\"0\">",
            "<p data-source-offset=\"2\">Same</p>",
            "<p data-source-offset=\"11\">Same</p>",
            "<li data-source-offset=\"17\">Same",
            "<li data-source-offset=\"26\">Same",
            "<pre data-source-offset=\"34\"><code class=\"language-rust\">Same\n",
        ] {
            assert!(result.contains(expected), "{expected}: {result}");
        }
    }

    #[test]
    fn document_html_cannot_supply_source_annotations() {
        let result = render_markdown(
            "<p data-source-offset=\"0\" onclick=\"evil()\">Fake</p>\n\nReal\n",
            |_| None,
        );
        assert!(result.contains("&lt;p data-source-offset="));
        assert!(!result.contains("<p data-source-offset=\"0\""));
        assert!(result.contains("<p data-source-offset=\"53\">Real</p>"));
    }

    #[test]
    fn link_policy_rejects_executable_and_ambiguous_schemes() {
        for url in [
            "notes/a.md",
            "../a.md#part",
            "#heading",
            "https://example.invalid",
            "mailto:someone@example.invalid",
            "situate://file/id",
        ] {
            assert!(allowed_link(url));
        }
        for url in [
            "javascript:alert(1)",
            "JaVaScRiPt:bad",
            "data:text/html,hello",
            "file:///private",
            "\\\\host\\share",
            "//host/path",
            "java\nscript:bad",
        ] {
            assert!(!allowed_link(url));
        }
    }
}
