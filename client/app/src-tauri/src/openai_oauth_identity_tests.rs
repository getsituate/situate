use super::tests::{fixtures, server, tokens};
use super::*;
use serde_json::json;

#[test]
fn independently_signed_tokens_require_signature_and_exact_identity_claims() {
    let fixtures = fixtures();
    let keys = &fixtures["jwks"];
    for (name, token) in fixtures["tokens"].as_object().unwrap() {
        let result = identity::verify_with_keys(
            token.as_str().unwrap(),
            "issued-client",
            "fixture-attempt",
            keys,
            None,
        );
        match name.as_str() {
            "valid" | "audience_array" => assert_eq!(result.unwrap(), "synthetic-subject"),
            "wrong_subject" => assert_eq!(result.unwrap(), "another-subject"),
            _ => assert_eq!(result.unwrap_err(), ERROR, "{name}"),
        }
    }
    let token = fixtures["tokens"]["valid"].as_str().unwrap();
    assert_eq!(
        identity::verify_with_keys(token, "issued-client", "different-attempt", keys, None)
            .unwrap_err(),
        ERROR
    );
    assert_eq!(
        identity::verify_with_keys(token, "another-client", "fixture-attempt", keys, None)
            .unwrap_err(),
        ERROR
    );
}

#[test]
fn signed_audience_arrays_require_client_membership_and_all_identity_checks() {
    let fixtures: Value =
        serde_json::from_str(include_str!("openai_audience_fixtures.json")).unwrap();
    for (name, token) in fixtures["tokens"].as_object().unwrap() {
        let result = identity::verify_with_keys(
            token.as_str().unwrap(),
            "issued-client",
            "fixture-attempt",
            &fixtures["jwks"],
            None,
        );
        if matches!(name.as_str(), "singleton" | "matching_last") {
            assert_eq!(result.unwrap(), "synthetic-subject", "{name}");
        } else {
            assert_eq!(result.unwrap_err(), ERROR, "{name}");
        }
    }
    let token = fixtures["tokens"]["singleton"].as_str().unwrap();
    for client in [
        "other-client",
        "issued",
        "issued-client-extra",
        "ISSUED-CLIENT",
    ] {
        assert_eq!(
            identity::verify_with_keys(token, client, "fixture-attempt", &fixtures["jwks"], None)
                .unwrap_err(),
            ERROR,
            "{client}"
        );
    }
}

#[test]
fn key_selection_rejects_ambiguous_incompatible_and_excessive_keys() {
    let fixtures = fixtures();
    let token = fixtures["tokens"]["valid"].as_str().unwrap();
    let key = &fixtures["jwks"]["keys"][0];
    let mut invalid = vec![
        json!({"keys": []}),
        json!({"keys": [key, key]}),
        json!({"keys": vec![key; 33]}),
    ];
    for (field, value) in [
        ("alg", "HS256"),
        ("kty", "oct"),
        ("use", "enc"),
        ("n", "AQAB"),
        ("e", "!"),
    ] {
        let mut key = key.clone();
        key[field] = json!(value);
        invalid.push(json!({"keys": [key]}));
    }
    let mut no_verification = key.clone();
    no_verification["key_ops"] = json!(["sign"]);
    invalid.push(json!({"keys": [no_verification]}));
    for keys in invalid {
        assert_eq!(
            identity::verify_with_keys(token, "issued-client", "fixture-attempt", &keys, None)
                .unwrap_err(),
            ERROR
        );
    }
}

#[tokio::test]
async fn returning_login_reuses_client_and_rejects_client_replacement_before_exchange() {
    let previous = credential(
        &tokens(),
        "issued-client".into(),
        "synthetic-subject".into(),
        now(),
    )
    .unwrap();
    let auth = Authorization::new(Some(previous), 1455);
    let url = reqwest::Url::parse(&auth.url(uuid::Uuid::nil())).unwrap();
    assert_eq!(
        url.query_pairs()
            .find(|(key, _)| key == "client_id")
            .unwrap()
            .1,
        "issued-client"
    );
    assert!(!url.query_pairs().any(|(key, _)| key == "agent_name_hint"));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/unused", listener.local_addr().unwrap());
    let result = auth
        .exchange_at(
            &endpoint,
            &endpoint,
            Callback {
                code: "code".into(),
                client_id: "replacement".into(),
            },
            &CancellationToken::new(),
            None,
        )
        .await;
    assert_eq!(result.err().unwrap(), ERROR);
    assert!(futures_util::poll!(Box::pin(listener.accept())).is_pending());
}

#[test]
fn returning_callback_uses_only_the_pending_registrations_client_when_omitted() {
    let url = format!("{REDIRECT}?state=expected&code=synthetic-code");
    let returned = callback(&url, "expected", 1455, Some("issued-client")).unwrap();
    assert_eq!(returned.client_id, "issued-client");
    assert_eq!(returned.code, "synthetic-code");
    assert!(callback(&url, "expected", 1455, None).is_err());
    for invalid in [
        url.replace("expected", "stale"),
        url.replace("1455", "1456"),
        url.replace("/auth/callback", "/callback"),
        format!("{url}&client_id="),
        format!("{url}&client_id=%20"),
        format!("{url}&client_id=bad%0Avalue"),
        format!("{url}&client_id=issued-client&client_id=issued-client"),
    ] {
        assert!(callback(&invalid, "expected", 1455, Some("issued-client")).is_err());
    }
    assert_eq!(
        callback(
            &format!("{REDIRECT}?state=expected&error=access_denied"),
            "expected",
            1455,
            Some("issued-client"),
        )
        .err()
        .unwrap(),
        "native.ai.login.denied"
    );
}

#[tokio::test]
async fn returning_login_accepts_a_loopback_callback_without_client_id_on_a_new_port() {
    let original_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let original_port = original_listener.local_addr().unwrap().port();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    assert_ne!(address.port(), original_port);
    let previous = credential(
        &tokens(),
        "issued-client".into(),
        "synthetic-subject".into(),
        now(),
    )
    .unwrap();
    let mut auth = Authorization::new(Some(previous.clone()), address.port());
    auth.nonce = "fixture-attempt".into();
    let url = reqwest::Url::parse(&auth.url(uuid::Uuid::nil())).unwrap();
    let fields: std::collections::HashMap<_, _> = url.query_pairs().collect();
    let redirect = format!("http://{address}/auth/callback");
    assert_eq!(fields["client_id"], previous.client_id);
    assert_eq!(fields["redirect_uri"], redirect);
    assert!(!fields.contains_key("agent_name_hint"));

    let state = auth.state.clone();
    let browser = tokio::spawn(async move {
        let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
        socket
            .write_all(
                format!(
                    "GET /auth/callback?state={}&code=synthetic-code&scope=openid HTTP/1.1\r\nHost: {address}\r\n\r\n",
                    state
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let mut reply = String::new();
        socket.read_to_string(&mut reply).await.unwrap();
        assert!(reply.starts_with("HTTP/1.1 200"));
    });
    let (returned, browser_response) = tokio::time::timeout(
        Duration::from_secs(3),
        auth.listen(listener, situate_core::localization::Language::En),
    )
    .await
    .expect("loopback callback must settle")
    .unwrap();
    let fixtures = fixtures();
    let mut response = tokens();
    response["id_token"] = fixtures["tokens"]["valid"].clone();
    response["access_token"] = json!("reconnected-synthetic-access");
    let (endpoint, task) = server(200, response.to_string()).await;
    let (jwks, keys_task) = server(200, fixtures["jwks"].to_string()).await;
    let next = auth
        .exchange_at(&endpoint, &jwks, returned, &CancellationToken::new(), None)
        .await
        .unwrap();
    keys_task.await.unwrap();
    let body = task.await.unwrap();
    let exchange_url = reqwest::Url::parse(&format!("http://local/?{body}")).unwrap();
    let fields: std::collections::HashMap<_, _> = exchange_url.query_pairs().collect();
    assert_eq!(fields["client_id"], previous.client_id);
    assert_eq!(fields["redirect_uri"], redirect);
    assert_eq!(fields["code_verifier"], auth.verifier);
    assert_eq!(next.client_id, previous.client_id);
    assert_eq!(next.subject, previous.subject);
    assert_eq!(next.access, "reconnected-synthetic-access");
    assert_eq!(auth.previous.as_ref().unwrap().access, previous.access);
    browser_response.complete(true).await;
    tokio::time::timeout(Duration::from_secs(3), browser)
        .await
        .unwrap()
        .unwrap();
    assert!(tokio::net::TcpStream::connect(address).await.is_err());
}

#[tokio::test]
async fn returning_login_requires_the_previously_verified_subject() {
    for (name, succeeds) in [
        ("valid", true),
        ("audience_array", true),
        ("wrong_subject", false),
        ("wrong_nonce", false),
        ("invalid_signature", false),
        ("unknown_key", false),
    ] {
        let previous = credential(
            &tokens(),
            "issued-client".into(),
            "synthetic-subject".into(),
            now(),
        )
        .unwrap();
        let mut auth = Authorization::new(Some(previous.clone()), 1455);
        auth.nonce = "fixture-attempt".into();
        let fixtures = fixtures();
        let mut response = tokens();
        response["id_token"] = fixtures["tokens"][name].clone();
        let (endpoint, task) = server(200, response.to_string()).await;
        let (jwks, keys_task) = server(200, fixtures["jwks"].to_string()).await;
        let result = auth
            .exchange_at(
                &endpoint,
                &jwks,
                Callback {
                    code: "code".into(),
                    client_id: "issued-client".into(),
                },
                &CancellationToken::new(),
                None,
            )
            .await;
        task.await.unwrap();
        keys_task.await.unwrap();
        if succeeds {
            let next = result.unwrap();
            assert_eq!(next.client_id, previous.client_id);
            assert_eq!(next.subject, previous.subject);
        } else {
            assert_eq!(result.err().unwrap(), ERROR, "{name}");
        }
        assert_eq!(auth.previous.as_ref().unwrap().access, previous.access);
        assert_eq!(auth.previous.as_ref().unwrap().subject, previous.subject);
    }
}

#[tokio::test]
async fn cancellation_during_key_fetch_never_returns_an_identity() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/jwks", listener.local_addr().unwrap());
    let cancel = CancellationToken::new();
    let fixtures = fixtures();
    let operation = identity::verify(
        &endpoint,
        fixtures["tokens"]["valid"].as_str().unwrap(),
        "issued-client",
        "fixture-attempt",
        &cancel,
        None,
    );
    let cancellation = async {
        let (_socket, _) = listener.accept().await.unwrap();
        cancel.cancel();
    };
    let (result, ()) = tokio::join!(operation, cancellation);
    assert_eq!(result.unwrap_err(), CANCELLED);
}

#[tokio::test]
async fn jwks_failures_are_bounded_and_sanitized() {
    for (status, body) in [
        (302, "private-redirect".into()),
        (500, "private-error".into()),
        (200, "x".repeat(65_537)),
        (200, "private-invalid-json".into()),
    ] {
        let (endpoint, task) = server(status, body).await;
        let fixtures = fixtures();
        let result = identity::verify(
            &endpoint,
            fixtures["tokens"]["valid"].as_str().unwrap(),
            "issued-client",
            "fixture-attempt",
            &CancellationToken::new(),
            None,
        )
        .await;
        task.await.unwrap();
        assert_eq!(result.unwrap_err(), ERROR);
    }
}

#[test]
fn records_without_verified_subject_require_reconnection() {
    let old = json!({"access":"synthetic-access", "refresh":"synthetic-refresh", "expires":1, "clientId":"issued-client", "scopes":["chatgpt.tokens.use.direct"]});
    assert!(serde_json::from_value::<Credential>(old).is_err());
}
