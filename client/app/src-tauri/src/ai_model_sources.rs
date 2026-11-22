use super::*;

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
type RequestBuilder = fn(&Connection) -> Result<Request, String>;

pub(super) fn strategy(config: &Config) -> Result<RequestBuilder, String> {
    admit_method(config)?;
    Ok(match (config.provider.as_str(), config.auth) {
        ("openai", Some(AuthKind::Oauth)) => direct_request,
        ("openai", _) => openai_request,
        ("anthropic", _) => anthropic_request,
        ("openrouter", _) => router_request,
        ("custom", _) => custom_request,
        _ => return Err(ERROR.into()),
    })
}

pub(super) fn request(connection: &Connection) -> Result<Request, String> {
    strategy(&connection.config)?(connection)
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
        if matches!(self, Self::Router) {
            return Some(DiscoveredModel {
                id: id.into(),
                context_window,
                max_tokens,
                name: None,
                thinking_levels: vec![],
                reasoning_none: false,
                image_input: false,
            });
        }
        Some(DiscoveredModel {
            id: id.to_owned(),
            thinking_levels: ["low", "medium", "high", "xhigh"]
                .into_iter()
                .filter(|level| match self {
                    Self::Anthropic => {
                        item["capabilities"]["thinking"]["types"]["adaptive"]["supported"] == true
                            && item["capabilities"]["thinking"]["types"]["disabled"]["supported"]
                                == true
                            && item["capabilities"]["effort"][*level]["supported"] == true
                    }
                    _ => false,
                })
                .map(str::to_owned)
                .collect(),
            name: item["display_name"]
                .as_str()
                .filter(|name| {
                    !name.trim().is_empty()
                        && name.len() <= 256
                        && !name.chars().any(char::is_control)
                })
                .map(str::to_owned),
            context_window,
            max_tokens,
            reasoning_none: false,
            image_input: item["capabilities"]["image_input"]["supported"] == true,
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
        if matches!(request.protocol, Protocol::Custom)
            && matches!(response.status().as_u16(), 404 | 405 | 501)
        {
            return Ok(Catalog {
                source: Source::Manual,
                ..Catalog::default()
            });
        }
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
        let slugs = matches!(request.protocol, Protocol::Direct);
        let items = body[if slugs { "models" } else { "data" }]
            .as_array()
            .ok_or(ERROR)?;
        if items.len() > MAX_MODELS
            || (matches!(request.protocol, Protocol::Anthropic | Protocol::Router)
                && items.len() > 100)
        {
            return Err(ERROR.into());
        }
        for item in items {
            if slugs && item["visibility"].as_str().ok_or(ERROR)? != "list" {
                continue;
            }
            let id = model_id(&item[if slugs { "slug" } else { "id" }])?;
            if !seen.insert(id.clone()) || models.len() >= MAX_MODELS {
                return Err(ERROR.into());
            }
            if id != "recommended"
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
        Ok(request) => observe(request, Duration::from_secs(30)).await,
        Err(_) => Catalog::default(),
    }
}
