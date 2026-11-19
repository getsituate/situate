use super::*;

const URL: &str = "https://models.dev/api.json";
const MAX_BYTES: usize = 12 * 1024 * 1024;

// The public catalog does not identify which OpenAI endpoint supports tools.
// https://developers.openai.com/api/docs/changelog#november-2026
const RESPONSES_WITH_TOOLS: &[&str] = &["gpt-6.2-astra", "gpt-6.2-sol"];

pub(super) async fn enrich(catalog: &mut Catalog) {
    if !catalog
        .models
        .iter()
        .any(|id| RESPONSES_WITH_TOOLS.contains(&id.as_str()))
    {
        return;
    }
    enrich_from(
        catalog,
        reqwest::Url::parse(URL).expect("fixed metadata URL"),
    )
    .await;
}

pub(in crate::ai::discovery) async fn enrich_from(catalog: &mut Catalog, url: reqwest::Url) {
    let metadata = download(url).await;
    for id in &catalog.models {
        if !RESPONSES_WITH_TOOLS.contains(&id.as_str()) {
            continue;
        }
        let fallback = DiscoveredModel {
            id: id.clone(),
            context_window: 1_050_000,
            max_tokens: 128_000,
            image_input: true,
        };
        let mut model = fallback;
        if let Some(entry) = metadata.as_ref().and_then(|data| data.get(id))
            && entry["id"] == id.as_str()
            && entry["tool_call"] == true
            && has(&entry["modalities"]["input"], "text")
            && has(&entry["modalities"]["output"], "text")
            && let Some(context) = entry["limit"]["context"].as_u64()
            && let Some(output) = entry["limit"]["output"].as_u64()
            && output > 0
            && context >= output
        {
            model.context_window = context.min(u64::from(model.context_window)) as u32;
            model.max_tokens = output.min(u64::from(model.max_tokens)) as u32;
            model.image_input = has(&entry["modalities"]["input"], "image");
        }
        catalog.selectable.push(model);
    }
}

fn has(value: &Value, name: &str) -> bool {
    value
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item == name))
}

async fn download(url: reqwest::Url) -> Option<serde_json::Map<String, Value>> {
    let mut response = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(3))
        .build()
        .ok()?
        .get(url)
        .send()
        .await
        .ok()?;
    if response.status() != reqwest::StatusCode::OK
        || response
            .content_length()
            .is_some_and(|bytes| bytes > MAX_BYTES as u64)
    {
        return None;
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if chunk.len() > MAX_BYTES - bytes.len() {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    let mut data: Value = serde_json::from_slice(&bytes).ok()?;
    match data["openai"]["models"].take() {
        Value::Object(models) => Some(models),
        _ => None,
    }
}
