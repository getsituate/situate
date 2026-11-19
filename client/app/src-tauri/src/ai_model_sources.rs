use super::*;

#[path = "ai_openai_metadata.rs"]
pub(super) mod openai_metadata;

#[derive(Clone, Copy)]
pub(super) enum Protocol {
    OpenAi,
    Direct,
    Anthropic,
    Router,
    Custom,
}
pub(super) struct Request {
    pub(super) endpoint: reqwest::Url,
    pub(super) protocol: Protocol,
    pub(super) secret: String,
}
pub(super) enum ModelRefresh {
    Live(fn(&Connection) -> Result<Request, String>),
    Bundled,
}

pub(super) fn strategy(config: &Config) -> Result<ModelRefresh, String> {
    admit_method(config)?;
    use ModelRefresh::{Bundled, Live};
    Ok(match (config.provider.as_str(), config.auth) {
        ("openai", Some(AuthKind::Oauth)) => Live(direct_request),
        ("openai", _) => Live(openai_request),
        ("anthropic", _) => Live(anthropic_request),
        ("openrouter", _) => Live(router_request),
        ("custom", _) => Live(custom_request),
        ("openai-codex", _) => Bundled,
        _ => return Err(ERROR.into()),
    })
}

pub(super) fn request(connection: &Connection) -> Result<Option<Request>, String> {
    match strategy(&connection.config)? {
        ModelRefresh::Live(plan) => plan(connection).map(Some),
        ModelRefresh::Bundled => Ok(None),
    }
}

impl Request {
    fn new(endpoint: &str, protocol: Protocol, secret: &str) -> Result<Self, String> {
        Ok(Self {
            endpoint: validate_endpoint(endpoint)?,
            protocol,
            secret: secret.to_owned(),
        })
    }
}

fn direct_request(connection: &Connection) -> Result<Request, String> {
    Request::new(
        "https://api.openai.com/v1/models",
        Protocol::Direct,
        &connection.oauth.as_ref().ok_or(ERROR)?.access,
    )
}

fn openai_request(connection: &Connection) -> Result<Request, String> {
    Request::new(
        "https://api.openai.com/v1/models",
        Protocol::OpenAi,
        &connection.key,
    )
}

fn anthropic_request(connection: &Connection) -> Result<Request, String> {
    Request::new(
        "https://api.anthropic.com/v1/models",
        Protocol::Anthropic,
        &connection.key,
    )
}

fn router_request(connection: &Connection) -> Result<Request, String> {
    Request::new(
        "https://openrouter.ai/api/v1/models/user",
        Protocol::Router,
        &connection.key,
    )
}

fn custom_request(connection: &Connection) -> Result<Request, String> {
    let base = connection.config.endpoint.as_deref().ok_or(ERROR)?;
    validate_http_consent(&connection.config, base, false)?;
    Request::new(
        &format!("{}/models", base.trim_end_matches('/')),
        Protocol::Custom,
        &connection.key,
    )
}
fn model_id(value: &Value) -> Result<String, String> {
    value
        .as_str()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 256
                && !id.chars().any(char::is_whitespace)
                && !id.chars().any(char::is_control)
        })
        .map(str::to_owned)
        .ok_or_else(|| ERROR.into())
}
impl Protocol {
    fn selectable(self, id: &str, item: &Value) -> Option<DiscoveredModel> {
        fn contains(value: &Value, needle: &str) -> bool {
            value
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item == needle))
        }
        let (context, output) = match self {
            Self::Anthropic if item["type"] == "model" && item["lifecycle"] == "active" => {
                (&item["max_input_tokens"], &item["max_tokens"])
            }
            Self::Router
                if contains(&item["architecture"]["input_modalities"], "text")
                    && contains(&item["architecture"]["output_modalities"], "text")
                    && contains(&item["supported_parameters"], "tools")
                    && contains(&item["endpoints"], "/api/v1/chat/completions") =>
            {
                (
                    &item["context_length"],
                    &item["top_provider"]["max_completion_tokens"],
                )
            }
            _ => return None,
        };
        let context_window = u32::try_from(context.as_u64()?).ok()?;
        let max_tokens = u32::try_from(output.as_u64()?).ok()?;
        if context_window == 0 || max_tokens == 0 || max_tokens > context_window {
            return None;
        }
        Some(DiscoveredModel {
            id: id.to_owned(),
            context_window,
            max_tokens,
            image_input: false,
        })
    }
}

pub(super) async fn collect(request: Request) -> Result<Catalog, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| ERROR)?;
    let mut models = Vec::new();
    let mut selectable = Vec::new();
    let bundled = match request.protocol {
        Protocol::Anthropic => bundled_ids("anthropic"),
        Protocol::Router => bundled_ids("openrouter"),
        _ => HashSet::new(),
    };
    let mut seen = HashSet::new();
    let mut cursors = HashSet::new();
    let mut cursor: Option<String> = None;
    let mut offset = 0usize;
    let mut total_bytes = 0usize;
    let mut router_total = None;
    for _ in 0..MAX_PAGES {
        let mut url = request.endpoint.clone();
        match request.protocol {
            Protocol::Anthropic => {
                url.query_pairs_mut().append_pair("limit", "100");
                if let Some(cursor) = &cursor {
                    url.query_pairs_mut().append_pair("after_id", cursor);
                }
            }
            Protocol::Router => {
                url.query_pairs_mut()
                    .append_pair("offset", &offset.to_string())
                    .append_pair("limit", "100")
                    .append_pair("output_modalities", "text");
            }
            _ => (),
        }
        let mut query = client.get(url);
        if matches!(request.protocol, Protocol::Anthropic) {
            query = query
                .header("x-api-key", &request.secret)
                .header("anthropic-version", "2023-06-01");
        } else if !request.secret.is_empty() {
            query = query.bearer_auth(&request.secret);
        }
        let mut response = query.send().await.map_err(|_| ERROR)?;
        if response.status() != reqwest::StatusCode::OK
            || response
                .content_length()
                .is_some_and(|size| size > PAGE_BYTES as u64)
        {
            return Err(ERROR.into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| ERROR)? {
            total_bytes += chunk.len();
            if bytes.len() + chunk.len() > PAGE_BYTES || total_bytes > TOTAL_BYTES {
                return Err(ERROR.into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let body: Value = serde_json::from_slice(&bytes).map_err(|_| ERROR)?;
        let items = body[if matches!(request.protocol, Protocol::Direct) {
            "models"
        } else {
            "data"
        }]
        .as_array()
        .ok_or(ERROR)?;
        if items.len() > MAX_MODELS
            || (matches!(request.protocol, Protocol::Anthropic | Protocol::Router)
                && items.len() > 100)
        {
            return Err(ERROR.into());
        }
        for item in items {
            if matches!(request.protocol, Protocol::Direct)
                && item["visibility"].as_str().ok_or(ERROR)? != "list"
            {
                continue;
            }
            let id = model_id(
                &item[if matches!(request.protocol, Protocol::Direct) {
                    "slug"
                } else {
                    "id"
                }],
            )?;
            if !seen.insert(id.clone()) || models.len() >= MAX_MODELS {
                return Err(ERROR.into());
            }
            if id != "recommended"
                && !bundled.contains(&id)
                && let Some(model) = request.protocol.selectable(&id, item)
            {
                selectable.push(model);
            }
            models.push(id);
        }
        let more = match request.protocol {
            Protocol::Anthropic => {
                let more = body["has_more"].as_bool().ok_or(ERROR)?;
                if more {
                    let next = model_id(&body["last_id"])?;
                    if items.is_empty()
                        || items.last().and_then(|m| m["id"].as_str()) != Some(next.as_str())
                        || !cursors.insert(next.clone())
                    {
                        return Err(ERROR.into());
                    }
                    cursor = Some(next);
                }
                more
            }
            Protocol::Router => {
                let total = body["total_count"]
                    .as_u64()
                    .filter(|n| *n <= MAX_MODELS as u64)
                    .ok_or(ERROR)? as usize;
                if router_total.is_some_and(|prior| prior != total) {
                    return Err(ERROR.into());
                }
                router_total = Some(total);
                offset += items.len();
                if offset > total || (items.is_empty() && offset < total) {
                    return Err(ERROR.into());
                }
                offset < total
            }
            _ => false,
        };
        if !more {
            let mut catalog = Catalog {
                source: if matches!(request.protocol, Protocol::Direct | Protocol::Router) {
                    Source::Account
                } else {
                    Source::Provider
                },
                models,
                checked_at: None,
                selectable: vec![],
            };
            if serde_json::to_vec(&catalog).map_err(|_| ERROR)?.len() > 24 * 1024 {
                return Err(ERROR.into());
            }
            catalog.selectable = selectable;
            if serde_json::to_vec(&catalog).map_err(|_| ERROR)?.len() > 48 * 1024 {
                return Err(ERROR.into());
            }
            return Ok(catalog);
        }
    }
    Err(ERROR.into())
}
pub(super) async fn observe(request: Request, budget: Duration) -> Catalog {
    tokio::time::timeout(budget, collect(request))
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default()
}
pub(in crate::ai) async fn fetch(connection: &Connection) -> Catalog {
    match request(connection) {
        Ok(Some(request)) if matches!(request.protocol, Protocol::OpenAi | Protocol::Direct) => {
            let mut catalog = observe(request, Duration::from_secs(25)).await;
            openai_metadata::enrich(&mut catalog).await;
            catalog
        }
        Ok(Some(request)) => observe(request, Duration::from_secs(30)).await,
        Ok(None) => Catalog::static_models(&connection.config),
        Err(_) => Catalog::default(),
    }
}
