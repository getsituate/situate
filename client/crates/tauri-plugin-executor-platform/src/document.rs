pub(crate) const MAX_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const CSP: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";

use crate::DocumentKind;

pub(crate) fn policy(kind: DocumentKind) -> String {
    match kind {
        DocumentKind::Supervisor => CSP.into(),
        DocumentKind::Preview => {
            format!("{CSP}; style-src 'unsafe-inline'; img-src data:; font-src data:")
        }
    }
}

pub(crate) fn document(source: &str, bridge: &str, kind: DocumentKind) -> Result<String, String> {
    let csp = policy(kind);
    let viewport = if kind == DocumentKind::Preview {
        r#"<meta name="viewport" content="width=device-width,initial-scale=1">"#
    } else {
        ""
    };
    if source.is_empty() || source.len() > MAX_BYTES {
        return Err("executor.invalidSource".into());
    }
    // JSON stays inside a script element, whose HTML parser does not understand JS escaping.
    let source = serde_json::to_string(source)
        .map_err(|_| "executor.invalidSource")?
        .replace('<', "\\u003c")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    Ok(format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="{csp}">{viewport}</head><body><script>
(() => {{
  const emit = {bridge};
  const pending = [];
  let ready = false;
  globalThis.__SITUATE_EXECUTOR__ = {{send: payload => emit({{kind:'message', payload}}), receive: () => {{}}}};
  globalThis.__situateReceive = payload => {{
    if (ready) globalThis.__SITUATE_EXECUTOR__.receive(payload);
    else pending.push(payload);
  }};
  setInterval(() => emit({{kind:'heartbeat'}}), 1000);
  const url = URL.createObjectURL(new Blob([{source}], {{type:'text/javascript'}}));
  import(url).then(() => {{
    URL.revokeObjectURL(url);
    ready = true;
    emit({{kind:'ready'}});
    for (const payload of pending) globalThis.__SITUATE_EXECUTOR__.receive(payload);
    pending.length = 0;
  }}).catch(() => emit({{kind:'lost', reason:'bootstrapFailed'}}));
}})();
</script></body></html>"#
    ))
}

pub(crate) fn delivery(payload: &serde_json::Value) -> Result<String, String> {
    let json = serde_json::to_string(payload).map_err(|_| "executor.invalidMessage")?;
    if json.len() > MAX_BYTES {
        return Err("executor.messageTooLarge".into());
    }
    Ok(format!("globalThis.__situateReceive({json})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_cannot_end_the_script_or_relax_the_document_policy() {
        let html = document(
            "</script><script src='https://example.invalid'>",
            "x=>x",
            DocumentKind::Supervisor,
        )
        .unwrap();
        assert_eq!(html.matches("</script>").count(), 1);
        assert!(html.contains("\\u003c/script>"));
        assert!(html.contains("connect-src 'none'"));
        assert!(html.contains("worker-src blob:"));
        assert!(!html.contains("script-src 'self'"));
    }

    #[test]
    fn preview_allows_only_bundled_styles_and_data_assets() {
        let supervisor = document("export {}", "x=>x", DocumentKind::Supervisor).unwrap();
        let preview = document("export {}", "x=>x", DocumentKind::Preview).unwrap();
        assert_eq!(policy(DocumentKind::Supervisor), CSP);
        assert!(!supervisor.contains("style-src"));
        for directive in [
            "style-src 'unsafe-inline'",
            "img-src data:",
            "font-src data:",
            "connect-src 'none'",
        ] {
            assert!(preview.contains(directive));
        }
        assert!(!preview.contains("https:"));
    }

    #[test]
    fn json_delivery_preserves_values_without_executing_string_contents() {
        assert_eq!(
            delivery(&serde_json::json!({"text":"');throw 1;//", "value":null})).unwrap(),
            "globalThis.__situateReceive({\"text\":\"');throw 1;//\",\"value\":null})"
        );
        assert!(document("", "x=>x", DocumentKind::Supervisor).is_err());
        assert!(delivery(&serde_json::Value::String("a".repeat(MAX_BYTES))).is_err());
    }
}
