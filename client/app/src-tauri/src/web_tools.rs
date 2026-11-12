use dom_query::Document;
use futures_util::StreamExt;
use rand::seq::SliceRandom;
use reqwest::{Client, RequestBuilder, Url, header};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{net::IpAddr, time::Duration};
use tokio_util::sync::CancellationToken;

const INVALID: &str = "native.web.invalid";
const BLOCKED: &str = "native.web.blocked";
const NETWORK: &str = "native.web.network";
const TIMEOUT: &str = "native.web.timeout";
const TOO_LARGE: &str = "native.web.tooLarge";
const UNREADABLE: &str = "native.web.unreadable";
const UNSUPPORTED: &str = "native.web.unsupported";
const STOPPED: &str = "native.ai.response.stopped";
const MAX_BODY: usize = 2 * 1024 * 1024;
const MAX_CONTENT: usize = 12_000;
const MAX_RESULTS: usize = 5;
const ATTEMPT_TIME: Duration = Duration::from_secs(10);
const TOTAL_TIME: Duration = Duration::from_secs(30);
const USER_AGENT: &str = "Situate/1.0";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Provider {
    Keenable,
    Exa,
    DuckDuckGo,
}
impl Provider {
    fn name(self) -> &'static str {
        match self {
            Self::Keenable => "keenable",
            Self::Exa => "exa",
            Self::DuckDuckGo => "duckduckgo",
        }
    }
    fn url(self) -> Url {
        Url::parse(match self {
            Self::Keenable => "https://api.keenable.ai/v1/search/public",
            Self::Exa => "https://mcp.exa.ai/mcp",
            Self::DuckDuckGo => "https://html.duckduckgo.com/html/",
        })
        .unwrap()
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
struct SearchResult {
    title: String,
    url: String,
    description: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchArgs {
    query: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FetchArgs {
    url: String,
}

pub(crate) async fn execute(
    name: &str,
    arguments: Value,
    run_cancel: CancellationToken,
    call_cancel: CancellationToken,
) -> Result<Value, String> {
    let operation = async {
        match name {
            "web_search" => {
                let args: SearchArgs = serde_json::from_value(arguments).map_err(|_| INVALID)?;
                let query = args.query.trim();
                if query.is_empty() || query.chars().count() > 1024 {
                    return Err(INVALID);
                }
                let mut providers = [Provider::Keenable, Provider::Exa, Provider::DuckDuckGo];
                providers.shuffle(&mut rand::thread_rng());
                search(&providers, |provider| search_provider(provider, query)).await
            }
            "web_fetch" => {
                let args: FetchArgs = serde_json::from_value(arguments).map_err(|_| INVALID)?;
                fetch(&args.url).await
            }
            _ => Err(INVALID),
        }
    };
    within_run(operation, run_cancel, call_cancel).await
}

async fn within_run(
    operation: impl Future<Output = Result<Value, &'static str>>,
    run_cancel: CancellationToken,
    call_cancel: CancellationToken,
) -> Result<Value, String> {
    tokio::select! {
        biased;
        _ = run_cancel.cancelled() => Err(STOPPED.into()),
        _ = call_cancel.cancelled() => Err(STOPPED.into()),
        result = tokio::time::timeout(TOTAL_TIME, operation) => {
            if run_cancel.is_cancelled() || call_cancel.is_cancelled() {
                Err(STOPPED.into())
            } else {
                result.unwrap_or(Err(TIMEOUT)).map_err(str::to_owned)
            }
        }
    }
}

async fn search<F, Fut>(providers: &[Provider], mut attempt: F) -> Result<Value, &'static str>
where
    F: FnMut(Provider) -> Fut,
    Fut: Future<Output = Result<Vec<SearchResult>, &'static str>>,
{
    let mut failed = Vec::new();
    for &provider in providers {
        let result = tokio::time::timeout(ATTEMPT_TIME, attempt(provider))
            .await
            .unwrap_or(Err(TIMEOUT));
        match result {
            Ok(results) => {
                return Ok(
                    json!({"provider":provider.name(),"results":results,"failedProviders":failed}),
                );
            }
            Err(error) => failed.push(json!({"provider":provider.name(),"error":error})),
        }
    }
    Err("native.web.searchFailed")
}

fn search_request(client: &Client, provider: Provider, query: &str) -> RequestBuilder {
    match provider {
        Provider::Keenable => client
            .post(provider.url())
            .header("X-Keenable-Title", "Situate")
            .json(&json!({"query":query,"mode":"pro"})),
        Provider::Exa => client
            .post(provider.url())
            .header(header::ACCEPT, "application/json, text/event-stream")
            .json(
                &json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
                    "name":"web_search_exa","arguments":{"query":query,"numResults":MAX_RESULTS,
                        "type":"auto","livecrawl":"fallback","contextMaxCharacters":3000}
                }}),
            ),
        Provider::DuckDuckGo => {
            let mut url = provider.url();
            url.query_pairs_mut().append_pair("q", query);
            client.get(url).header(
                header::USER_AGENT,
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
            )
        }
    }
}

async fn search_provider(
    provider: Provider,
    query: &str,
) -> Result<Vec<SearchResult>, &'static str> {
    let client = public_client(&provider.url()).await?;
    let response = receive(search_request(&client, provider, query)).await?;
    if response.status != 200 {
        return Err(NETWORK);
    }
    let body = decode(&response.body, &response.content_type);
    match provider {
        Provider::Keenable => parse_keenable(&body),
        Provider::Exa => parse_exa(&body),
        Provider::DuckDuckGo => parse_ddg(&body),
    }
}

fn excerpt(text: &str, limit: usize) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect()
}
fn search_result(title: &str, url: &str, description: &str) -> Option<SearchResult> {
    let url = web_url(url).ok()?;
    if title.trim().is_empty() || !public_literal(&url) {
        return None;
    }
    Some(SearchResult {
        title: excerpt(title, 300),
        url: url.into(),
        description: excerpt(description, 500),
    })
}
fn parse_keenable(body: &str) -> Result<Vec<SearchResult>, &'static str> {
    #[derive(Deserialize)]
    struct Reply {
        results: Vec<Hit>,
    }
    #[derive(Deserialize)]
    struct Hit {
        title: String,
        url: String,
        #[serde(default)]
        snippet: String,
        #[serde(default)]
        description: String,
    }
    let reply: Reply = serde_json::from_str(body).map_err(|_| UNREADABLE)?;
    let mut results = Vec::new();
    for hit in &reply.results {
        let description = if hit.snippet.trim().is_empty() {
            &hit.description
        } else {
            &hit.snippet
        };
        if let Some(result) = search_result(&hit.title, &hit.url, description) {
            results.push(result);
        }
        if results.len() == MAX_RESULTS {
            break;
        }
    }
    if !reply.results.is_empty() && results.is_empty() {
        return Err(UNREADABLE);
    }
    Ok(results)
}

fn parse_exa(body: &str) -> Result<Vec<SearchResult>, &'static str> {
    let payload = if body.trim_start().starts_with('{') {
        body.to_owned()
    } else {
        body.lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim)
            .rfind(|line| !line.is_empty())
            .ok_or(UNREADABLE)?
            .to_owned()
    };
    let reply: Value = serde_json::from_str(&payload).map_err(|_| UNREADABLE)?;
    if !reply["error"].is_null() || reply["result"]["isError"] == true {
        return Err(NETWORK);
    }
    let content = reply["result"]["content"].as_array().ok_or(UNREADABLE)?;
    let mut results = Vec::new();
    for item in content {
        if item["type"] != "text" {
            return Err(UNREADABLE);
        }
        let text = item["text"].as_str().ok_or(UNREADABLE)?;
        let normalized = text.replace("\r\n", "\n");
        for block in normalized.split("\n---\n") {
            let mut title = "";
            let mut url = "";
            let mut description = Vec::new();
            for line in block.lines().map(str::trim) {
                if let Some(value) = line.strip_prefix("Title:") {
                    title = value.trim();
                } else if let Some(value) = line.strip_prefix("URL:") {
                    url = value.trim();
                } else if !line.is_empty()
                    && !["Published date:", "Author:", "Score:", "Highlights:"]
                        .iter()
                        .any(|prefix| line.starts_with(prefix))
                {
                    description.push(line);
                }
            }
            if let Some(result) = search_result(title, url, &description.join(" ")) {
                results.push(result);
            }
            if results.len() == MAX_RESULTS {
                return Ok(results);
            }
        }
        if results.is_empty()
            && !text.trim().is_empty()
            && !text.trim().eq_ignore_ascii_case("No search results found")
            && !text.trim().eq_ignore_ascii_case("No search results found.")
        {
            return Err(UNREADABLE);
        }
    }
    Ok(results)
}

fn parse_ddg(body: &str) -> Result<Vec<SearchResult>, &'static str> {
    let document = Document::from(body);
    if body.contains("anomaly.js")
        || document.select("#challenge-form, .anomaly-modal").length() > 0
    {
        return Err(NETWORK);
    }
    let mut results = Vec::new();
    for hit in document.select(".result").iter() {
        let link = hit.select(".result__a");
        let Some(href) = link.attr("href") else {
            continue;
        };
        let url = Provider::DuckDuckGo
            .url()
            .join(&href)
            .map_err(|_| UNREADABLE)?;
        let target = if url
            .host_str()
            .is_some_and(|host| host == "duckduckgo.com" || host.ends_with(".duckduckgo.com"))
        {
            url.query_pairs()
                .find(|(key, _)| key == "uddg")
                .map(|(_, value)| value.into_owned())
                .unwrap_or_else(|| url.to_string())
        } else {
            url.to_string()
        };
        if let Some(result) = search_result(
            &link.text(),
            &target,
            &hit.select(".result__snippet").text(),
        ) {
            results.push(result);
        }
        if results.len() == MAX_RESULTS {
            break;
        }
    }
    if results.is_empty() && document.select(".no-results").length() == 0 {
        return Err(UNREADABLE);
    }
    Ok(results)
}

fn web_url(value: &str) -> Result<Url, &'static str> {
    if value.len() > 8192 {
        return Err(INVALID);
    }
    let mut url = Url::parse(value).map_err(|_| INVALID)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(INVALID);
    }
    url.set_fragment(None);
    Ok(url)
}
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_documentation()
                && !ip.is_unspecified()
                && !ip.is_broadcast()
                && a != 0
                && a < 224
                && !(a == 100 && (64..128).contains(&b))
                && !(a == 192 && b == 0 && c == 0)
                && !(a == 198 && (b == 18 || b == 19))
        }
        IpAddr::V6(ip) => {
            if let Some(ip) = ip.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(ip));
            }
            let segments = ip.segments();
            (0x2000..0x4000).contains(&segments[0])
                && !(segments[0] == 0x2001 && (segments[1] < 0x0200 || segments[1] == 0xdb8))
                && !(segments[0] == 0x2002)
                && !(segments[0] == 0x3fff && segments[1] < 0x1000)
        }
    }
}
fn public_literal(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Ipv4(ip)) => public_ip(IpAddr::V4(ip)),
        Some(url::Host::Ipv6(ip)) => public_ip(IpAddr::V6(ip)),
        Some(url::Host::Domain(host)) => {
            let host = host.trim_end_matches('.').to_ascii_lowercase();
            host != "localhost" && !host.ends_with(".localhost") && !host.ends_with(".local")
        }
        None => false,
    }
}
async fn public_client(url: &Url) -> Result<Client, &'static str> {
    if !public_literal(url) {
        return Err(BLOCKED);
    }
    let host = url.host_str().ok_or(INVALID)?;
    let port = url.port_or_known_default().ok_or(INVALID)?;
    let addresses: Vec<_> = match url.host() {
        Some(url::Host::Ipv4(ip)) => vec![(IpAddr::V4(ip), port).into()],
        Some(url::Host::Ipv6(ip)) => vec![(IpAddr::V6(ip), port).into()],
        _ => tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| NETWORK)?
            .collect(),
    };
    if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
        return Err(BLOCKED);
    }
    // Pin the checked addresses; redirects get a new check and cannot re-resolve into a private network.
    Client::builder()
        .user_agent(USER_AGENT)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(ATTEMPT_TIME)
        .timeout(TOTAL_TIME)
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|_| NETWORK)
}

struct Response {
    status: u16,
    content_type: String,
    location: Option<String>,
    body: Vec<u8>,
}
async fn receive(request: RequestBuilder) -> Result<Response, &'static str> {
    let response = request
        .send()
        .await
        .map_err(|e| if e.is_timeout() { TIMEOUT } else { NETWORK })?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let location = response
        .headers()
        .get(header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BODY as u64)
    {
        return Err(TOO_LARGE);
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| if e.is_timeout() { TIMEOUT } else { NETWORK })?;
        if body.len() + chunk.len() > MAX_BODY {
            return Err(TOO_LARGE);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(Response {
        status,
        content_type,
        location,
        body,
    })
}
fn decode(body: &[u8], content_type: &str) -> String {
    let encoding = content_type
        .split(';')
        .skip(1)
        .find_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            name.eq_ignore_ascii_case("charset")
                .then(|| {
                    encoding_rs::Encoding::for_label(value.trim_matches(['\'', '"']).as_bytes())
                })
                .flatten()
        })
        .unwrap_or(encoding_rs::UTF_8);
    encoding.decode(body).0.into_owned()
}
async fn fetch(value: &str) -> Result<Value, &'static str> {
    let requested = web_url(value)?;
    let mut url = requested.clone();
    for redirects in 0..=5 {
        let client = public_client(&url).await?;
        let response = receive(
            client
                .get(url.clone())
                .header(header::ACCEPT, "text/html, text/plain, text/markdown"),
        )
        .await?;
        if matches!(response.status, 301 | 302 | 303 | 307 | 308) {
            if redirects == 5 {
                return Err(NETWORK);
            }
            url = web_url(
                url.join(response.location.as_deref().ok_or(NETWORK)?)
                    .map_err(|_| NETWORK)?
                    .as_str(),
            )?;
            continue;
        }
        if !(200..300).contains(&response.status) {
            return Err(NETWORK);
        }
        return extract_page(&requested, &url, &response);
    }
    Err(NETWORK)
}
fn extract_page(requested: &Url, url: &Url, response: &Response) -> Result<Value, &'static str> {
    let mime = response
        .content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let body = decode(&response.body, &response.content_type);
    let (title, content) = match mime.as_str() {
        "text/html" | "application/xhtml+xml" => {
            let config = dom_smoothie::Config {
                max_elements_to_parse: 30_000,
                text_mode: dom_smoothie::TextMode::Markdown,
                ..Default::default()
            };
            let mut reader = dom_smoothie::Readability::new(body, Some(url.as_str()), Some(config))
                .map_err(|_| UNREADABLE)?;
            let article = reader.parse().map_err(|_| UNREADABLE)?;
            (article.title, article.text_content.to_string())
        }
        "text/plain" | "text/markdown" => (String::new(), body),
        _ => return Err(UNSUPPORTED),
    };
    let content = content.trim();
    if content.is_empty() {
        return Err(UNREADABLE);
    }
    let truncated = content.chars().count() > MAX_CONTENT;
    let content: String = content.chars().take(MAX_CONTENT).collect();
    let fetched_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| NETWORK)?
        .as_millis() as u64;
    Ok(
        json!({"requestedUrl":requested.as_str(),"url":url.as_str(),"title":excerpt(&title,300),"content":content,"truncated":truncated,"fetchedAt":fetched_at}),
    )
}

#[cfg(test)]
#[path = "web_tools_tests.rs"]
mod tests;
