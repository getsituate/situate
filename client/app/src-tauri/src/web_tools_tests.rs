use super::*;
use std::{cell::RefCell, future::pending};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[test]
fn provider_requests_use_only_public_keyless_endpoints_and_encoded_queries() {
    let client = Client::builder().no_proxy().build().unwrap();
    let query = "notes & tasks? ü";
    for provider in [Provider::Keenable, Provider::Exa, Provider::DuckDuckGo] {
        let request = search_request(&client, provider, query).build().unwrap();
        assert!(request.headers().get(header::AUTHORIZATION).is_none());
        assert!(request.headers().get("x-api-key").is_none());
        match provider {
            Provider::Keenable => {
                assert_eq!(
                    request.url().as_str(),
                    "https://api.keenable.ai/v1/search/public"
                );
                let body: Value =
                    serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
                assert_eq!(body, json!({"query":query,"mode":"pro"}));
                assert_eq!(request.headers()["X-Keenable-Title"], "Situate");
            }
            Provider::Exa => {
                assert_eq!(request.url().as_str(), "https://mcp.exa.ai/mcp");
                let body: Value =
                    serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
                assert_eq!(body["method"], "tools/call");
                assert_eq!(body["params"]["name"], "web_search_exa");
                assert_eq!(body["params"]["arguments"]["query"], query);
                assert_eq!(body["params"]["arguments"]["numResults"], 5);
            }
            Provider::DuckDuckGo => {
                assert_eq!(request.method(), reqwest::Method::GET);
                assert_eq!(request.url().host_str(), Some("html.duckduckgo.com"));
                assert_eq!(
                    request.url().query_pairs().collect::<Vec<_>>(),
                    vec![("q".into(), query.into())]
                );
            }
        }
    }
}

#[test]
fn keenable_uses_bounded_page_snippets_with_description_fallback() {
    let mut hits = vec![
        json!({"title":"Page one","url":"https://example.com/one","snippet":"  Actual\npage content  ","description":"Not the page"}),
        json!({"title":"Page two","url":"https://example.com/two","snippet":"  ","description":"Fallback description"}),
        json!({"title":"Private","url":"http://127.0.0.1/private","snippet":"Internal"}),
    ];
    hits.extend((0..8).map(|n| json!({"title":format!("Page {n}"),"url":format!("https://example.com/{n}"),"snippet":"ä".repeat(501)})));
    let results = parse_keenable(&json!({"results":hits}).to_string()).unwrap();
    assert_eq!(results.len(), 5);
    assert_eq!(results[0].description, "Actual page content");
    assert_eq!(results[1].description, "Fallback description");
    assert_eq!(results[2].description, "ä".repeat(500));
    assert_eq!(parse_keenable(r#"{"results":[]}"#), Ok(vec![]));
    assert_eq!(
        parse_keenable(r#"{"error":"unavailable"}"#),
        Err(UNREADABLE)
    );
}

fn exa_reply(text: &str) -> String {
    json!({"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":text}],"isError":false}}).to_string()
}
#[test]
fn exa_decodes_json_and_sse_and_preserves_individual_sources() {
    let text = "Title: First page\nURL: https://example.com/one\nPublished date: 2026-01-01\nHighlights:\nA first description.\n---\nTitle: Second page\nURL: https://example.com/two\nAuthor: Example\nAnother description.";
    let expected = vec![
        SearchResult {
            title: "First page".into(),
            url: "https://example.com/one".into(),
            description: "A first description.".into(),
        },
        SearchResult {
            title: "Second page".into(),
            url: "https://example.com/two".into(),
            description: "Another description.".into(),
        },
    ];
    assert_eq!(parse_exa(&exa_reply(text)).unwrap(), expected);
    assert_eq!(
        parse_exa(&format!(
            ": keepalive\r\nevent: message\r\ndata: {}\r\n\r\n",
            exa_reply(text)
        ))
        .unwrap(),
        expected
    );
    assert_eq!(
        parse_exa(&exa_reply("No search results found.")),
        Ok(vec![])
    );
}
#[test]
fn exa_http_success_with_an_rpc_or_tool_error_is_not_an_empty_search() {
    assert_eq!(
        parse_exa(r#"{"error":{"code":-32000,"message":"Rate limited"}}"#),
        Err(NETWORK)
    );
    assert_eq!(
        parse_exa(
            r#"{"result":{"isError":true,"content":[{"type":"text","text":"Rate limited"}]}}"#
        ),
        Err(NETWORK)
    );
    assert_eq!(
        parse_exa(&exa_reply("The output format has changed")),
        Err(UNREADABLE)
    );
    assert_eq!(parse_exa("event: message\n\n"), Err(UNREADABLE));
}

#[test]
fn duckduckgo_unwraps_source_urls_and_decodes_html_entities() {
    let html = r#"<div class="result"><h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide%3Fa%3D1%26b%3D2">Notes &amp; tasks</a></h2><div class="result__snippet">A <b>useful</b> guide.</div></div>"#;
    assert_eq!(
        parse_ddg(html).unwrap(),
        vec![SearchResult {
            title: "Notes & tasks".into(),
            url: "https://example.com/guide?a=1&b=2".into(),
            description: "A useful guide.".into(),
        }]
    );
    assert_eq!(
        parse_ddg("<div class='no-results'>No results</div>"),
        Ok(vec![])
    );
    assert_eq!(
        parse_ddg("<form id='challenge-form'>Complete the challenge</form>"),
        Err(NETWORK)
    );
    assert_eq!(
        parse_ddg("<html><body>Something changed</body></html>"),
        Err(UNREADABLE)
    );
}

#[tokio::test]
async fn rotation_moves_past_errors_and_stops_after_the_first_success() {
    let called = RefCell::new(vec![]);
    let result = search(&[Provider::Exa,Provider::Keenable,Provider::DuckDuckGo], |provider| {
        called.borrow_mut().push(provider);
        std::future::ready(if provider == Provider::Exa {
            parse_exa(r#"{"result":{"isError":true,"content":[]}}"#)
        } else {
            parse_keenable(r#"{"results":[{"title":"Guide","url":"https://example.com/guide","description":"A source"}]}"#)
        })
    }).await.unwrap();
    assert_eq!(*called.borrow(), vec![Provider::Exa, Provider::Keenable]);
    assert_eq!(result["provider"], "keenable");
    assert_eq!(
        result["failedProviders"],
        json!([{"provider":"exa","error":NETWORK}])
    );
    assert_eq!(result["results"][0]["url"], "https://example.com/guide");
}
#[tokio::test]
async fn empty_results_stop_rotation_but_failed_providers_never_become_empty_success() {
    let called = RefCell::new(vec![]);
    let result = search(&[Provider::Exa, Provider::Keenable], |provider| {
        called.borrow_mut().push(provider);
        std::future::ready(Ok(vec![]))
    })
    .await
    .unwrap();
    assert_eq!(*called.borrow(), vec![Provider::Exa]);
    assert_eq!(result["results"], json!([]));
    let result = search(&[Provider::Exa, Provider::Keenable], |_| {
        std::future::ready(Err(NETWORK))
    })
    .await;
    assert_eq!(result, Err("native.web.searchFailed"));
}
#[tokio::test(start_paused = true)]
async fn a_stalled_provider_reaches_its_deadline_before_rotation_continues() {
    let result = search(
        &[Provider::Exa, Provider::Keenable],
        |provider| async move {
            if provider == Provider::Exa {
                pending().await
            } else {
                Ok(vec![])
            }
        },
    )
    .await
    .unwrap();
    assert_eq!(result["provider"], "keenable");
    assert_eq!(result["failedProviders"][0]["error"], TIMEOUT);
}

#[test]
fn public_urls_reject_credentials_non_web_schemes_and_private_address_forms() {
    for url in [
        "file:///notes",
        "ftp://example.com",
        "https://user:password@example.com",
        "data:text/plain,hello",
        "not a URL",
    ] {
        assert_eq!(web_url(url), Err(INVALID), "{url}");
    }
    for url in [
        "http://127.0.0.1",
        "http://2130706433",
        "http://0x7f000001",
        "http://10.0.0.1",
        "http://172.16.1.1",
        "http://192.168.1.1",
        "http://169.254.169.254",
        "http://100.64.0.1",
        "http://198.18.0.1",
        "http://224.0.0.1",
        "http://[::1]",
        "http://[::ffff:127.0.0.1]",
        "http://[fc00::1]",
        "http://localhost.",
        "http://device.local",
        "http://[2002:7f00:1::]",
    ] {
        assert!(!public_literal(&web_url(url).unwrap()), "{url}");
    }
    for ip in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
        assert!(public_ip(ip.parse().unwrap()), "{ip}");
    }
    assert_eq!(
        web_url("https://example.com/guide#section")
            .unwrap()
            .as_str(),
        "https://example.com/guide"
    );
}

#[tokio::test]
async fn invalid_arguments_and_private_fetch_targets_do_not_start_network_access() {
    for (name, args, error) in [
        ("web_search", json!({"query":"   "}), INVALID),
        (
            "web_search",
            json!({"query":"x","apiKey":"unwanted"}),
            INVALID,
        ),
        ("web_search", json!({"query":"x".repeat(1025)}), INVALID),
        ("web_fetch", json!({"url":"http://127.0.0.1"}), BLOCKED),
        ("web_fetch", json!({"url":"http://[::1]"}), BLOCKED),
        ("web_fetch", json!({"url":"file:///notes"}), INVALID),
        (
            "web_fetch",
            json!({"url":"https://example.com","headers":{}}),
            INVALID,
        ),
    ] {
        assert_eq!(
            execute(
                name,
                args,
                CancellationToken::new(),
                CancellationToken::new()
            )
            .await,
            Err(error.into())
        );
    }
}
#[tokio::test]
async fn run_or_call_cancellation_takes_precedence_over_tool_work() {
    for cancel_run in [true, false] {
        let run = CancellationToken::new();
        let call = CancellationToken::new();
        if cancel_run {
            run.cancel();
        } else {
            call.cancel();
        }
        assert_eq!(
            execute("web_search", json!({"query":""}), run, call).await,
            Err(STOPPED.into())
        );
    }
}

#[tokio::test]
async fn cancellation_drops_an_in_flight_operation_without_waiting_for_its_deadline() {
    for cancel_run in [true, false] {
        let run = CancellationToken::new();
        let call = CancellationToken::new();
        let cancel = if cancel_run {
            run.clone()
        } else {
            call.clone()
        };
        let operation = async move {
            cancel.cancel();
            pending().await
        };
        assert_eq!(within_run(operation, run, call).await, Err(STOPPED.into()));
    }
}

#[tokio::test(start_paused = true)]
async fn the_whole_tool_has_one_bounded_deadline() {
    assert_eq!(
        within_run(
            pending(),
            CancellationToken::new(),
            CancellationToken::new()
        )
        .await,
        Err(TIMEOUT.into())
    );
}

fn response(content_type: &str, body: impl Into<Vec<u8>>) -> Response {
    Response {
        status: 200,
        content_type: content_type.into(),
        location: None,
        body: body.into(),
    }
}
#[test]
fn article_extraction_preserves_sources_and_removes_navigation() {
    let prose = "An evening beside the river offers a quiet place to read. The footpath follows the water past the bridge, with benches under the trees. Bring a book and choose a seat away from the cycle lane. ";
    let html = format!(
        "<html><head><title>Reading by the river</title></head><body><nav>UNRELATED NAVIGATION</nav><article><h1>Reading by the river</h1><p>{}</p><p>See the <a href='/reading-list'>reading list</a> for more books.</p></article><footer>UNRELATED FOOTER</footer></body></html>",
        prose.repeat(8)
    );
    let requested = web_url("https://example.com/start").unwrap();
    let final_url = web_url("https://example.com/articles/river").unwrap();
    let result = extract_page(
        &requested,
        &final_url,
        &response("text/html; charset=utf-8", html),
    )
    .unwrap();
    assert_eq!(result["title"], "Reading by the river");
    assert_eq!(result["requestedUrl"], "https://example.com/start");
    assert_eq!(result["url"], "https://example.com/articles/river");
    let text = result["content"].as_str().unwrap();
    assert!(text.contains("An evening beside the river"));
    assert!(text.contains("[reading list](https://example.com/reading-list)"));
    assert!(!text.contains("UNRELATED"));
    assert_eq!(result["truncated"], false);
}
#[test]
fn documentation_extraction_preserves_code_and_table_values() {
    let html = format!("<html><head><title>Notebook API</title></head><body><main><h1>Notebook API</h1><p>{}</p><h2>Usage</h2><pre><code>let count = 3;\nopen_notebook(count);</code></pre><table><thead><tr><th>Field</th><th>Meaning</th></tr></thead><tbody><tr><td>title</td><td>Notebook name</td></tr><tr><td>count</td><td>Number of pages</td></tr></tbody></table></main></body></html>","The notebook stores pages in the selected folder. Read the current page before updating its title or content. ".repeat(10));
    let url = web_url("https://example.com/docs/api").unwrap();
    let result = extract_page(&url, &url, &response("text/html", html)).unwrap();
    let text = result["content"].as_str().unwrap();
    assert_eq!(result["title"], "Notebook API");
    for expected in [
        "let count = 3;",
        "open_notebook(count);",
        "Notebook name",
        "Number of pages",
    ] {
        assert!(text.contains(expected), "missing {expected}: {text}");
    }
}
#[test]
fn fetch_bounds_unicode_output_and_distinguishes_unsupported_and_empty_sources() {
    let url = web_url("https://example.com/source").unwrap();
    let result = extract_page(
        &url,
        &url,
        &response("text/plain", "ä".repeat(MAX_CONTENT + 1)),
    )
    .unwrap();
    assert_eq!(result["content"], "ä".repeat(MAX_CONTENT));
    assert_eq!(result["truncated"], true);
    assert_eq!(
        extract_page(&url, &url, &response("application/pdf", "%PDF")),
        Err(UNSUPPORTED)
    );
    assert_eq!(
        extract_page(&url, &url, &response("text/plain", " \n")),
        Err(UNREADABLE)
    );
    let result = extract_page(
        &url,
        &url,
        &response(
            "text/plain; charset=windows-1252",
            vec![b'G', b'r', 0xfc, 0xdf, b'e'],
        ),
    )
    .unwrap();
    assert_eq!(result["content"], "Grüße");
}

async fn serve(bytes: Vec<u8>) -> (RequestBuilder, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = [0; 4096];
        let mut request = Vec::new();
        loop {
            let size = socket.read(&mut buffer).await.unwrap();
            assert!(size > 0);
            request.extend_from_slice(&buffer[..size]);
            if request.windows(4).any(|part| part == b"\r\n\r\n") {
                break;
            }
            assert!(request.len() < 16_384);
        }
        let _ = socket.write_all(&bytes).await;
    });
    (
        Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap()
            .get(format!("http://{address}/")),
        task,
    )
}
#[tokio::test]
async fn bounded_transport_preserves_status_and_redirects_without_following_them() {
    let (request,server) = serve(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/private\r\nContent-Type: text/plain\r\nContent-Length: 4\r\nConnection: close\r\n\r\nMove".to_vec()).await;
    let result = receive(request).await.unwrap();
    server.await.unwrap();
    assert_eq!(result.status, 302);
    assert_eq!(result.location.as_deref(), Some("http://127.0.0.1/private"));
    assert_eq!(result.body, b"Move");
    assert_eq!(
        fetch(result.location.as_deref().unwrap()).await,
        Err(BLOCKED)
    );
}
#[tokio::test]
async fn downloads_are_limited_with_and_without_content_length() {
    let (request, server) = serve(
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            MAX_BODY + 1
        )
        .into_bytes(),
    )
    .await;
    assert!(matches!(receive(request).await, Err(TOO_LARGE)));
    server.await.unwrap();
    let mut body = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
    body.extend(vec![b'x'; MAX_BODY + 1]);
    let (request, server) = serve(body).await;
    assert!(matches!(receive(request).await, Err(TOO_LARGE)));
    server.await.unwrap();
}

#[tokio::test]
#[ignore = "Uses live public search services and a public website"]
async fn live_public_web_tools() {
    for provider in [Provider::Keenable, Provider::Exa, Provider::DuckDuckGo] {
        let results = tokio::time::timeout(
            ATTEMPT_TIME,
            search_provider(provider, "Rust programming language official website"),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(
            !results.is_empty(),
            "{} returned no results",
            provider.name()
        );
        assert!(results.len() <= MAX_RESULTS);
        println!("{}: {} results", provider.name(), results.len());
    }
    let page = execute(
        "web_fetch",
        json!({"url":"https://www.rust-lang.org/learn"}),
        CancellationToken::new(),
        CancellationToken::new(),
    )
    .await
    .unwrap();
    assert!(!page["content"].as_str().unwrap().is_empty());
    assert!(page["url"].as_str().unwrap().starts_with("https://"));
}
