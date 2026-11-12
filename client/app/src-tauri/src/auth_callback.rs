use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};
use situate_core::{localization::Language, messages};
use std::sync::OnceLock;

const TEMPLATE: &str = include_str!("../../src/ai/browser-callback/page.html");
const CSS: &str = include_str!("../../src/ai/browser-callback/page.css");
const SCORE: &str = include_str!("../../src/ai/browser-callback/score.js");
const RUNTIME: &str = include_str!("../../src/ai/browser-callback/runtime.js");
const TOKENS: &str = include_str!("../../../../design/brand/tokens.css");
const PERFORMANCE: &str = include_str!("../../../../design/brand/bend/performance.js");
const BEND: &str = include_str!("../../../../design/brand/bend/svg/rest-welcome.svg");
const WORDMARK: &str = include_str!("../../../../design/brand/assets/wordmark.svg");
const CARD: &str = include_str!("../../../../design/brand/assets/card.svg");

pub(super) fn response(language: Language, accepted: bool) -> &'static str {
    static PAGES: OnceLock<[String; 4]> = OnceLock::new();
    let pages = PAGES.get_or_init(|| {
        [
            build_response(Language::En, false),
            build_response(Language::En, true),
            build_response(Language::De, false),
            build_response(Language::De, true),
        ]
    });
    &pages[usize::from(language == Language::De) * 2 + usize::from(accepted)]
}

fn build_response(language: Language, accepted: bool) -> String {
    let style = format!("{TOKENS}\n{CSS}");
    let script = format!("{PERFORMANCE}\n{SCORE}\n{RUNTIME}");
    let policy = format!(
        "default-src 'none'; script-src 'sha256-{}'; style-src 'sha256-{}'; style-src-attr 'none'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        STANDARD.encode(Sha256::digest(script.as_bytes())),
        STANDARD.encode(Sha256::digest(style.as_bytes())),
    );
    let wordmark = format!("data:image/svg+xml;base64,{}", STANDARD.encode(WORDMARK));
    let card = format!("data:image/svg+xml;base64,{}", STANDARD.encode(CARD));
    let bend = without_inline_styles(BEND);
    let html = fill(TEMPLATE, |name| match name {
        "language" => match language {
            Language::En => "en",
            Language::De => "de",
        }
        .into(),
        "status" => if accepted { "received" } else { "rejected" }.into(),
        "receivedHidden" => if accepted { "" } else { "hidden" }.into(),
        "rejectedHidden" => if accepted { "hidden" } else { "" }.into(),
        "heading" => if accepted {
            "callback-title-received"
        } else {
            "callback-title-rejected"
        }
        .into(),
        "styles" => format!("<style>{style}</style>"),
        "script" => format!("<script>{script}</script>"),
        "wordmark" => wordmark.clone(),
        "card" => card.clone(),
        "bend" => bend.clone(),
        key if key.starts_with("native.ai.login.browser.") => {
            escape_html(&messages::text(language, key))
        }
        _ => panic!("Unknown authentication page field"),
    });
    let status = if accepted {
        "200 OK"
    } else {
        "400 Bad Request"
    };
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Security-Policy: {policy}\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{html}",
        html.len()
    )
}

fn fill(template: &str, mut field: impl FnMut(&str) -> String) -> String {
    let mut remaining = template;
    let mut result = String::new();
    while let Some((before, after)) = remaining.split_once("{{") {
        let (name, tail) = after
            .split_once("}}")
            .expect("Closed authentication page field");
        result.push_str(before);
        result.push_str(&field(name));
        remaining = tail;
    }
    result.push_str(remaining);
    result
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn without_inline_styles(svg: &str) -> String {
    let mut result = svg.to_owned();
    while let Some(start) = result.find(" style=\"") {
        let end = start + 8 + result[start + 8..].find('"').expect("Closed SVG style") + 1;
        result.replace_range(start..end, "");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses_are_localized_and_self_contained() {
        for language in [Language::En, Language::De] {
            for accepted in [false, true] {
                let response = response(language, accepted);
                let (headers, html) = response.split_once("\r\n\r\n").unwrap();
                assert!(headers.starts_with(if accepted {
                    "HTTP/1.1 200 OK"
                } else {
                    "HTTP/1.1 400 Bad Request"
                }));
                for header in [
                    "Content-Type: text/html; charset=utf-8",
                    "Cache-Control: no-store",
                    "Referrer-Policy: no-referrer",
                    "X-Content-Type-Options: nosniff",
                    "X-Frame-Options: DENY",
                ] {
                    assert!(headers.contains(header));
                }
                assert!(headers.contains(&format!("Content-Length: {}", html.len())));
                assert!(html.contains(if language == Language::De {
                    "<html lang=\"de\">"
                } else {
                    "<html lang=\"en\">"
                }));
                assert!(html.contains(&escape_html(&messages::text(
                    language,
                    "native.ai.login.browser.accepted.body"
                ))));
                assert!(!html.contains("{{"));
                assert!(!html.contains("src=\"http"));
                assert!(!html.contains("href=\"http"));
                assert!(!html.contains(" style=\""));
                assert!(html.len() < 100_000);
                let script = html
                    .split_once("<script>")
                    .unwrap()
                    .1
                    .split_once("</script>")
                    .unwrap()
                    .0;
                let style = html
                    .split_once("<style>")
                    .unwrap()
                    .1
                    .split_once("</style>")
                    .unwrap()
                    .0;
                assert!(headers.contains(&format!(
                    "script-src 'sha256-{}'",
                    STANDARD.encode(Sha256::digest(script))
                )));
                assert!(headers.contains(&format!(
                    "style-src 'sha256-{}'",
                    STANDARD.encode(Sha256::digest(style))
                )));
                let policy = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Security-Policy: "))
                    .unwrap();
                let directives: Vec<_> = policy.split("; ").collect();
                assert_eq!(directives.len(), 8);
                for directive in [
                    "default-src 'none'",
                    "style-src-attr 'none'",
                    "img-src data:",
                    "base-uri 'none'",
                    "form-action 'none'",
                    "frame-ancestors 'none'",
                ] {
                    assert!(directives.contains(&directive));
                }
                assert!(!policy.contains("unsafe-"));
            }
        }
    }

    #[test]
    fn translation_values_are_escaped_and_never_reparsed_as_template_fields() {
        assert_eq!(
            escape_html("<script>\"&'</script>"),
            "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;"
        );
        let rendered = fill("{{copy}}", |_| escape_html("<b>{{script}}</b>"));
        assert_eq!(rendered, "&lt;b&gt;{{script}}&lt;/b&gt;");
    }
}
