/*
OpenAI OAuth protocol adapted from @earendil-works/pi-ai 1.0.2:
https://github.com/earendil-works/pi/blob/v1.0.2/packages/ai/src/auth/oauth/openai-chatgpt.ts

MIT License
Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

#[path = "auth_callback.rs"]
mod browser;
#[path = "openai_identity.rs"]
mod identity;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_util::sync::CancellationToken;

// Protocol contract: @earendil-works/pi-ai 1.0.2, auth/oauth/openai-chatgpt (MIT).
// This is the OpenAI direct-token flow, not the legacy Codex OAuth client.
const AUTHORIZE: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN: &str = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE: &str = "https://api.openai.com/v1";
#[cfg(test)]
const REDIRECT: &str = "http://127.0.0.1:1455/auth/callback";
const DIRECT_SCOPE: &str = "chatgpt.tokens.use.direct";
pub const CANCELLED: &str = "native.ai.login.cancelled";
pub const ERROR: &str = "native.ai.login.failed";
const INVALID: &str = "native.ai.login.callbackInvalid";

pub(super) type Trace<'a> = Option<&'a crate::diagnostics::Operation>;
pub(super) fn checkpoint(trace: Trace<'_>, stage: &'static str) {
    if let Some(trace) = trace {
        trace.checkpoint(stage, None, None);
    }
}
pub(super) fn diagnostic_error(
    trace: Trace<'_>,
    stage: &'static str,
    reason: &'static str,
) -> String {
    if let Some(trace) = trace {
        trace.checkpoint(stage, Some(reason), None);
    }
    ERROR.into()
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Credential {
    pub access: String,
    pub refresh: String,
    pub expires: u64,
    pub client_id: String,
    pub subject: String,
    pub scopes: Vec<String>,
}
impl Credential {
    pub fn expired(&self) -> bool {
        self.expires <= now()
    }
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn random() -> String {
    let mut bytes = [0; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
pub struct Authorization {
    pub state: String,
    verifier: String,
    nonce: String,
    previous: Option<Credential>,
    redirect_uri: String,
}
impl Authorization {
    pub fn new(previous: Option<Credential>, port: u16) -> Self {
        Self {
            state: random(),
            verifier: random(),
            nonce: random(),
            previous,
            redirect_uri: format!("http://127.0.0.1:{port}/auth/callback"),
        }
    }
    pub fn url(&self, device: uuid::Uuid) -> String {
        let mut url = reqwest::Url::parse(AUTHORIZE).expect("fixed OAuth URL");
        url.query_pairs_mut().extend_pairs([
            (
                "client_id",
                self.previous
                    .as_ref()
                    .map_or("dynamic_agent_client", |old| old.client_id.as_str()),
            ),
            ("ext_agent_host_id", &format!("urn:uuid:{device}")),
            ("response_type", "code"),
            ("redirect_uri", &self.redirect_uri),
            ("resource", RESOURCE),
            (
                "scope",
                "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
            ),
            ("state", &self.state),
            (
                "code_challenge",
                &URL_SAFE_NO_PAD.encode(Sha256::digest(self.verifier.as_bytes())),
            ),
            ("code_challenge_method", "S256"),
            ("nonce", &self.nonce),
        ]);
        if self.previous.is_none() {
            url.query_pairs_mut()
                .append_pair("agent_name_hint", "Situate");
        }
        url.into()
    }
    pub async fn listen(
        &self,
        listener: TcpListener,
        language: situate_core::localization::Language,
    ) -> Result<(Callback, BrowserResponse), String> {
        listen(
            listener,
            &self.state,
            self.previous.as_ref().map(|old| old.client_id.as_str()),
            language,
        )
        .await
    }
    pub async fn exchange(
        &self,
        callback: Callback,
        cancel: &CancellationToken,
        trace: Trace<'_>,
    ) -> Result<Credential, String> {
        self.exchange_at(TOKEN, identity::JWKS, callback, cancel, trace)
            .await
    }
    async fn exchange_at(
        &self,
        endpoint: &str,
        jwks: &str,
        callback: Callback,
        cancel: &CancellationToken,
        trace: Trace<'_>,
    ) -> Result<Credential, String> {
        if self
            .previous
            .as_ref()
            .is_some_and(|old| old.client_id != callback.client_id)
        {
            return Err(diagnostic_error(trace, "token_exchange", "client_mismatch"));
        }
        let token = request_json_diagnosed(
            endpoint,
            Some(&[
                ("grant_type", "authorization_code"),
                ("client_id", &callback.client_id),
                ("code", &callback.code),
                ("code_verifier", &self.verifier),
                ("redirect_uri", &self.redirect_uri),
                ("resource", RESOURCE),
            ]),
            cancel,
            trace,
            "token_exchange",
        )
        .await?;
        checkpoint(trace, "token_received");
        let subject = identity::verify(
            jwks,
            &token_string(&token, "id_token")
                .map_err(|_| diagnostic_error(trace, "identity_verify", "id_token_missing"))?,
            &callback.client_id,
            &self.nonce,
            cancel,
            trace,
        )
        .await?;
        if self
            .previous
            .as_ref()
            .is_some_and(|old| old.subject != subject)
        {
            return Err(diagnostic_error(
                trace,
                "identity_verify",
                "subject_mismatch",
            ));
        }
        checkpoint(trace, "identity_verified");
        let credential = credential_diagnosed(&token, callback.client_id, subject, now(), trace)?;
        checkpoint(trace, "credential_validated");
        Ok(credential)
    }
}
pub struct Callback {
    code: String,
    client_id: String,
}

pub(super) struct BrowserResponse {
    socket: Option<tokio::net::TcpStream>,
    language: situate_core::localization::Language,
}

impl BrowserResponse {
    pub(super) async fn complete(mut self, connected: bool) {
        if let Some(mut socket) = self.socket.take() {
            write_browser_response(&mut socket, self.language, connected).await;
        }
    }
}

impl Drop for BrowserResponse {
    fn drop(&mut self) {
        if let Some(mut socket) = self.socket.take() {
            let language = self.language;
            // Failed, cancelled, or interrupted setup must never leave a success page.
            tokio::spawn(async move {
                write_browser_response(&mut socket, language, false).await;
            });
        }
    }
}

async fn write_browser_response(
    socket: &mut tokio::net::TcpStream,
    language: situate_core::localization::Language,
    connected: bool,
) {
    // Browser delivery is best-effort and cannot change the saved connection result.
    let _ = tokio::time::timeout(
        Duration::from_secs(1),
        socket.write_all(browser::response(language, connected).as_bytes()),
    )
    .await;
}
fn callback(
    input: &str,
    state: &str,
    port: u16,
    registered_client: Option<&str>,
) -> Result<Callback, String> {
    if input.len() > 8192 {
        return Err(INVALID.into());
    }
    let url = reqwest::Url::parse(input).map_err(|_| INVALID)?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port_or_known_default() != Some(port)
        || url.path() != "/auth/callback"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(INVALID.into());
    }
    let mut fields = std::collections::HashMap::new();
    for (key, value) in url.query_pairs() {
        if fields
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err(INVALID.into());
        }
    }
    if fields.get("state").map(String::as_str) != Some(state) {
        return Err(INVALID.into());
    }
    if fields.contains_key("error") {
        return Err("native.ai.login.denied".into());
    }
    let get = |name| {
        fields
            .get(name)
            .filter(|value| !value.trim().is_empty() && !value.chars().any(char::is_control))
            .cloned()
            .ok_or_else(|| INVALID.to_owned())
    };
    Ok(Callback {
        code: get("code")?,
        // Reauthorization may omit client_id; use only this attempt's saved registration.
        client_id: if fields.contains_key("client_id") {
            get("client_id")?
        } else {
            registered_client.ok_or(INVALID)?.to_owned()
        },
    })
}
async fn listen(
    listener: TcpListener,
    state: &str,
    registered_client: Option<&str>,
    language: situate_core::localization::Language,
) -> Result<(Callback, BrowserResponse), String> {
    let address = listener.local_addr().map_err(|_| ERROR)?;
    let authority = format!("127.0.0.1:{}", address.port());
    loop {
        let (mut socket, peer) = listener.accept().await.map_err(|_| ERROR)?;
        if !peer.ip().is_loopback() {
            continue;
        }
        let read = async {
            let mut bytes = Vec::new();
            while bytes.len() < 12_288 {
                let byte = socket.read_u8().await.map_err(|_| INVALID)?;
                bytes.push(byte);
                if bytes.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            if !bytes.ends_with(b"\r\n\r\n") {
                return Err(INVALID.to_owned());
            }
            let request = std::str::from_utf8(&bytes).map_err(|_| INVALID)?;
            let mut lines = request.split("\r\n");
            let mut first = lines.next().ok_or(INVALID)?.split(' ');
            if first.next() != Some("GET") {
                return Err(INVALID.to_owned());
            }
            let path = first.next().ok_or(INVALID)?;
            if !path.starts_with("/auth/callback?")
                || first.next() != Some("HTTP/1.1")
                || first.next().is_some()
            {
                return Err(INVALID.into());
            }
            let mut host = false;
            for line in lines.filter(|line| !line.is_empty()) {
                let (name, value) = line.split_once(':').ok_or(INVALID)?;
                if name.eq_ignore_ascii_case("host") {
                    if host || value.trim() != authority {
                        return Err(INVALID.into());
                    }
                    host = true;
                }
                if name.eq_ignore_ascii_case("origin") && value.trim() != "https://auth.openai.com"
                {
                    return Err(INVALID.into());
                }
                if name.eq_ignore_ascii_case("transfer-encoding")
                    || name.eq_ignore_ascii_case("content-length")
                {
                    return Err(INVALID.into());
                }
            }
            if !host {
                return Err(INVALID.into());
            }
            callback(
                &format!("http://{authority}{path}"),
                state,
                address.port(),
                registered_client,
            )
        };
        let result = tokio::time::timeout(Duration::from_secs(2), read).await;
        match result {
            Ok(Ok(value)) => {
                return Ok((
                    value,
                    BrowserResponse {
                        socket: Some(socket),
                        language,
                    },
                ));
            }
            rejected => {
                write_browser_response(&mut socket, language, false).await;
                if let Ok(Err(error)) = rejected
                    && error != INVALID
                {
                    return Err(error);
                }
            }
        }
    }
}
fn token_string(value: &Value, field: &str) -> Result<String, String> {
    value[field]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 16_384 && !s.chars().any(char::is_control))
        .map(str::to_owned)
        .ok_or_else(|| ERROR.into())
}
fn credential(
    value: &Value,
    client_id: String,
    subject: String,
    timestamp: u64,
) -> Result<Credential, String> {
    credential_diagnosed(value, client_id, subject, timestamp, None)
}
fn credential_diagnosed(
    value: &Value,
    client_id: String,
    subject: String,
    timestamp: u64,
    trace: Trace<'_>,
) -> Result<Credential, String> {
    checkpoint(trace, "credential");
    if client_id.trim().is_empty()
        || subject.trim().is_empty()
        || value
            .get("client_id")
            .is_some_and(|issued| issued.as_str() != Some(&client_id))
    {
        return Err(diagnostic_error(trace, "credential", "client_mismatch"));
    }
    let expires_in = value["expires_in"]
        .as_f64()
        .filter(|v| v.is_finite() && *v > 0. && *v <= 31_536_000.)
        .ok_or_else(|| diagnostic_error(trace, "credential", "token_expiry"))?;
    let scopes: Vec<String> = token_string(value, "scope")
        .map_err(|_| diagnostic_error(trace, "credential", "scope_invalid"))?
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    if !scopes.iter().any(|s| s == DIRECT_SCOPE) {
        return Err(diagnostic_error(
            trace,
            "credential",
            "direct_scope_missing",
        ));
    }
    Ok(Credential {
        access: token_string(value, "access_token")
            .map_err(|_| diagnostic_error(trace, "credential", "access_token_missing"))?,
        refresh: token_string(value, "refresh_token")
            .map_err(|_| diagnostic_error(trace, "credential", "refresh_token_missing"))?,
        expires: timestamp
            .saturating_add((expires_in * 1000.) as u64)
            .saturating_sub(180_000),
        client_id,
        subject,
        scopes,
    })
}
async fn request_token(
    endpoint: &str,
    form: &[(&str, &str)],
    cancel: &CancellationToken,
) -> Result<Value, String> {
    request_json(endpoint, Some(form), cancel).await
}
async fn request_json(
    endpoint: &str,
    form: Option<&[(&str, &str)]>,
    cancel: &CancellationToken,
) -> Result<Value, String> {
    request_json_diagnosed(endpoint, form, cancel, None, "token_exchange").await
}
async fn request_json_diagnosed(
    endpoint: &str,
    form: Option<&[(&str, &str)]>,
    cancel: &CancellationToken,
    trace: Trace<'_>,
    stage: &'static str,
) -> Result<Value, String> {
    checkpoint(trace, stage);
    let operation = async {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| diagnostic_error(trace, stage, "transport"))?;
        let request = match form {
            Some(form) => client.post(endpoint).form(form),
            None => client.get(endpoint),
        };
        let response = request
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|error| {
                diagnostic_error(
                    trace,
                    stage,
                    if error.is_timeout() {
                        "timeout"
                    } else {
                        "transport"
                    },
                )
            })?;
        let status = response.status();
        if let Some(trace) = trace {
            trace.checkpoint(
                stage,
                (!status.is_success()).then_some("http_status"),
                Some(status.as_u16()),
            );
        }
        if !status.is_success() {
            return Err(ERROR.to_owned());
        }
        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| {
                diagnostic_error(
                    trace,
                    stage,
                    if error.is_timeout() {
                        "timeout"
                    } else {
                        "transport"
                    },
                )
            })?;
            if bytes.len() + chunk.len() > 65_536 {
                return Err(diagnostic_error(trace, stage, "response_too_large"));
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| diagnostic_error(trace, stage, "response_invalid"))
    };
    tokio::select! { biased; _ = cancel.cancelled() => Err(CANCELLED.into()), result = operation => result }
}
pub async fn refresh(old: &Credential, cancel: &CancellationToken) -> Result<Credential, String> {
    if old.client_id.trim().is_empty() || old.subject.trim().is_empty() {
        return Err(ERROR.into());
    }
    refresh_at(TOKEN, old, cancel).await
}
async fn refresh_at(
    endpoint: &str,
    old: &Credential,
    cancel: &CancellationToken,
) -> Result<Credential, String> {
    let value = request_token(
        endpoint,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", &old.client_id),
            ("refresh_token", &old.refresh),
            ("resource", RESOURCE),
        ],
        cancel,
    )
    .await?;
    credential(&value, old.client_id.clone(), old.subject.clone(), now())
}

#[cfg(test)]
#[path = "openai_oauth_diagnostics_tests.rs"]
pub(crate) mod diagnostic_tests;
#[cfg(test)]
#[path = "openai_oauth_identity_tests.rs"]
mod identity_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    pub(super) fn fixtures() -> Value {
        // OpenSSL RSA/SHA-256 signatures keep fixtures independent of the JWT verifier.
        serde_json::from_str(include_str!("openai_identity_fixtures.json")).unwrap()
    }
    pub(super) fn tokens() -> Value {
        json!({"access_token":"synthetic-access", "refresh_token":"synthetic-refresh", "scope":"openid chatgpt.tokens.use.direct", "expires_in":3600, "id_token":"synthetic-id"})
    }
    fn return_url() -> String {
        format!("{REDIRECT}?code=synthetic-code&state=expected&client_id=issued-client")
    }
    #[test]
    fn authorization_uses_dynamic_registration_s256_and_independent_random_values() {
        let auth = Authorization::new(None, 1455);
        let other = Authorization::new(None, 1455);
        let url = reqwest::Url::parse(&auth.url(uuid::Uuid::nil())).unwrap();
        assert_eq!(
            url.origin().ascii_serialization(),
            "https://auth.openai.com"
        );
        assert_eq!(url.path(), "/api/accounts/authorize");
        let fields: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(fields["client_id"], "dynamic_agent_client");
        assert_eq!(fields["agent_name_hint"], "Situate");
        assert_eq!(fields["redirect_uri"], REDIRECT);
        assert_eq!(fields["resource"], RESOURCE);
        assert_eq!(fields["code_challenge_method"], "S256");
        assert_eq!(
            fields["code_challenge"],
            URL_SAFE_NO_PAD.encode(Sha256::digest(auth.verifier.as_bytes()))
        );
        assert_eq!(
            fields["ext_agent_host_id"],
            "urn:uuid:00000000-0000-0000-0000-000000000000"
        );
        assert_ne!(auth.state, other.state);
        assert_ne!(auth.state, auth.verifier);
        assert_ne!(auth.state, auth.nonce);
        assert_eq!(URL_SAFE_NO_PAD.decode(&auth.state).unwrap().len(), 32);
    }
    #[test]
    fn callback_rejects_wrong_origin_path_state_duplicates_and_denial_without_echoing_input() {
        assert!(callback(&return_url(), "expected", 1455, None).is_ok());
        assert!(
            callback(
                &return_url().replace("1455", "48231"),
                "expected",
                48231,
                None
            )
            .is_ok()
        );
        for value in [
            return_url().replace("127.0.0.1", "localhost"),
            return_url().replace("127.0.0.1", "attacker.invalid"),
            return_url().replace("1455", "1456"),
            return_url().replace("/auth/callback", "/other"),
            return_url().replace("http:", "https:"),
            return_url().replace("expected", "stale-secret"),
            format!("{}&state=expected", return_url()),
            format!("{}&code=another-secret", return_url()),
            format!("{}#secret", return_url()),
            return_url().replace("http://", "http://secret@"),
            format!("{REDIRECT}?state=expected&error=secret-provider-detail"),
            format!("{REDIRECT}?state=expected&code=secret"),
        ] {
            let error = callback(&value, "expected", 1455, None)
                .err()
                .expect("rejected");
            assert!(!error.contains("secret"));
            assert!(!error.contains("http"));
        }
        let denied = format!("{REDIRECT}?state=wrong&error=access_denied");
        assert_eq!(
            callback(&denied, "expected", 1455, None).err().unwrap(),
            INVALID
        );
    }
    #[test]
    fn token_contract_requires_direct_grant_rotatable_credentials_and_valid_expiry() {
        let valid = credential(
            &tokens(),
            "issued-client".into(),
            "synthetic-subject".into(),
            1_000_000,
        )
        .unwrap();
        assert_eq!(valid.expires, 4_420_000);
        assert_eq!(valid.client_id, "issued-client");
        for (field, value) in [
            ("expires_in", json!(0)),
            ("expires_in", json!(-1)),
            ("expires_in", json!("3600")),
            ("refresh_token", json!("")),
            ("access_token", json!("bad\nheader")),
            ("scope", json!("openid")),
            ("client_id", json!("replacement-client")),
        ] {
            let mut invalid = tokens();
            invalid[field] = value;
            assert!(
                credential(
                    &invalid,
                    "client".into(),
                    "synthetic-subject".into(),
                    1_000_000
                )
                .is_err()
            );
        }
        let mut expired = valid;
        expired.expires = now();
        assert!(expired.expired());
        expired.expires = now() + 60_000;
        assert!(!expired.expired());
    }
    pub(super) async fn server(
        status: u16,
        body: String,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/token", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            loop {
                bytes.push(socket.read_u8().await.unwrap());
                if bytes.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            let header = String::from_utf8(bytes).unwrap();
            let size: usize = header
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| "0".into())
                .parse()
                .unwrap();
            let mut bytes = vec![0; size];
            socket.read_exact(&mut bytes).await.unwrap();
            let reply = format!(
                "HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(reply.as_bytes()).await.unwrap();
            String::from_utf8(bytes).unwrap()
        });
        (url, task)
    }
    #[tokio::test]
    async fn real_http_exchange_and_refresh_match_the_pinned_public_client_contract() {
        let mut auth = Authorization::new(None, 48231);
        let authorize_url = reqwest::Url::parse(&auth.url(uuid::Uuid::nil())).unwrap();
        assert_eq!(
            authorize_url
                .query_pairs()
                .find(|(key, _)| key == "redirect_uri")
                .unwrap()
                .1,
            "http://127.0.0.1:48231/auth/callback"
        );
        auth.nonce = "fixture-attempt".into();
        let fixtures = fixtures();
        let mut response = tokens();
        response["id_token"] = fixtures["tokens"]["valid"].clone();
        let (url, task) = server(200, response.to_string()).await;
        let (jwks, keys_task) = server(200, fixtures["jwks"].to_string()).await;
        let returned = Callback {
            code: "synthetic-code".into(),
            client_id: "issued-client".into(),
        };
        let credential = auth
            .exchange_at(&url, &jwks, returned, &CancellationToken::new(), None)
            .await
            .unwrap();
        keys_task.await.unwrap();
        assert_eq!(credential.subject, "synthetic-subject");
        let body = task.await.unwrap();
        let fields: std::collections::HashMap<_, _> =
            reqwest::Url::parse(&format!("http://local/?{body}"))
                .unwrap()
                .query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();
        assert_eq!(fields["grant_type"], "authorization_code");
        assert_eq!(fields["client_id"], "issued-client");
        assert_eq!(fields["code_verifier"], auth.verifier);
        assert_eq!(
            fields["redirect_uri"],
            "http://127.0.0.1:48231/auth/callback"
        );
        assert_eq!(fields["resource"], RESOURCE);
        let mut rotated = tokens();
        rotated["refresh_token"] = json!("rotated-synthetic-refresh");
        let (url, task) = server(200, rotated.to_string()).await;
        let next = refresh_at(&url, &credential, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(next.refresh, "rotated-synthetic-refresh");
        assert_eq!(next.subject, "synthetic-subject");
        assert_eq!(next.client_id, "issued-client");
        let body = task.await.unwrap();
        assert!(body.contains("grant_type=refresh_token"));
        assert!(body.contains("refresh_token=synthetic-refresh"));
        assert!(body.contains("client_id=issued-client"));
        assert!(!body.contains("client_secret"));
    }
    #[tokio::test]
    async fn http_errors_and_invalid_grants_are_sanitized_and_cancellation_ends_exchange() {
        for (status, body) in [
            (400, "provider-private-body".into()),
            (302, "redirect-private-body".into()),
            (200, "private-invalid-json".into()),
            (200, "{}".into()),
        ] {
            let (url, task) = server(status, body).await;
            let error = refresh_at(
                &url,
                &credential(
                    &tokens(),
                    "client".into(),
                    "synthetic-subject".into(),
                    now(),
                )
                .unwrap(),
                &CancellationToken::new(),
            )
            .await
            .err()
            .unwrap();
            task.await.unwrap();
            assert_eq!(error, ERROR);
        }
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/token", listener.local_addr().unwrap());
        let token = CancellationToken::new();
        let operation = request_token(&url, &[("grant_type", "refresh_token")], &token);
        let cancellation = async {
            let (_socket, _) = listener.accept().await.unwrap();
            token.cancel();
        };
        let (result, ()) = tokio::join!(operation, cancellation);
        assert_eq!(result.unwrap_err(), CANCELLED);
    }
    #[tokio::test]
    async fn loopback_rejects_malicious_requests_then_accepts_one_correlated_callback() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let authority = address.to_string();
        let task = tokio::spawn(listen(
            listener,
            "expected",
            None,
            situate_core::localization::Language::En,
        ));
        for (host, path, origin) in [
            (
                "evil.invalid",
                "/auth/callback?state=expected&code=x&client_id=c",
                "",
            ),
            (
                authority.as_str(),
                "/auth/callback?state=stale&code=x&client_id=c",
                "",
            ),
            (
                authority.as_str(),
                "/elsewhere?state=expected&code=x&client_id=c",
                "",
            ),
            (
                authority.as_str(),
                "/auth/callback?state=expected&code=x&client_id=c",
                "Origin: https://evil.invalid\r\n",
            ),
        ] {
            let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
            socket
                .write_all(
                    format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n{origin}\r\n").as_bytes(),
                )
                .await
                .unwrap();
            let mut reply = String::new();
            socket.read_to_string(&mut reply).await.unwrap();
            assert!(reply.starts_with("HTTP/1.1 400"));
            assert!(reply.contains("Content-Type: text/html; charset=utf-8"));
            assert!(reply.contains("data-status=\"rejected\""));
            assert!(!reply.contains("evil.invalid"));
            assert!(!reply.contains("state=expected"));
            assert!(!task.is_finished());
        }
        let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
        socket.write_all(format!("GET /auth/callback?state=expected&code=synthetic-code&client_id=issued HTTP/1.1\r\nHost: {authority}\r\n\r\n").as_bytes()).await.unwrap();
        let (result, response) = task.await.unwrap().unwrap();
        assert_eq!(result.code, "synthetic-code");
        let mut first_byte = [0];
        assert!(
            tokio::time::timeout(Duration::from_millis(30), socket.read(&mut first_byte))
                .await
                .is_err()
        );
        response.complete(true).await;
        let mut reply = String::new();
        socket.read_to_string(&mut reply).await.unwrap();
        assert!(reply.starts_with("HTTP/1.1 200"));
        assert!(reply.contains("data-status=\"received\""));
        assert!(reply.contains("AI provider connected"));
        assert!(!reply.contains("synthetic-code"));
        assert!(!reply.contains("state=expected"));
        assert!(tokio::net::TcpStream::connect(address).await.is_err());
    }

    #[tokio::test]
    async fn incomplete_setup_returns_only_the_recovery_page() {
        for mode in ["unavailable", "failed", "interrupted"] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let task = tokio::spawn(listen(
                listener,
                "expected",
                None,
                situate_core::localization::Language::En,
            ));
            let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
            socket.write_all(format!("GET /auth/callback?state=expected&code=synthetic-code&client_id=issued HTTP/1.1\r\nHost: {address}\r\n\r\n").as_bytes()).await.unwrap();
            let (_, response) = task.await.unwrap().unwrap();
            match mode {
                "unavailable" => response.complete(false).await,
                "failed" => drop(response),
                _ => {
                    let (entered, ready) = tokio::sync::oneshot::channel();
                    let worker = tokio::spawn(async move {
                        let _response = response;
                        entered.send(()).unwrap();
                        std::future::pending::<()>().await;
                    });
                    ready.await.unwrap();
                    worker.abort();
                    assert!(worker.await.unwrap_err().is_cancelled());
                }
            }
            let mut reply = String::new();
            tokio::time::timeout(Duration::from_secs(3), socket.read_to_string(&mut reply))
                .await
                .unwrap()
                .unwrap();
            assert!(reply.starts_with("HTTP/1.1 400"));
            assert!(reply.contains("data-status=\"rejected\""));
            assert!(reply.contains("Connection not confirmed"));
            assert!(!reply.contains("synthetic-code"));
        }
    }

    #[tokio::test]
    async fn correlated_denial_returns_a_localized_error_page_and_ends_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(listen(
            listener,
            "expected",
            None,
            situate_core::localization::Language::De,
        ));
        let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
        socket.write_all(format!("GET /auth/callback?state=expected&error=synthetic-provider-denial HTTP/1.1\r\nHost: {address}\r\n\r\n").as_bytes()).await.unwrap();
        let mut reply = String::new();
        socket.read_to_string(&mut reply).await.unwrap();
        assert!(reply.starts_with("HTTP/1.1 400"));
        assert!(reply.contains(&situate_core::messages::text(
            situate_core::localization::Language::De,
            "native.ai.login.browser.rejected.status",
        )));
        assert!(!reply.contains("synthetic-provider-denial"));
        assert_eq!(task.await.unwrap().err().unwrap(), "native.ai.login.denied");
        assert!(tokio::net::TcpStream::connect(address).await.is_err());
    }

    #[tokio::test]
    async fn accepted_callback_does_not_depend_on_the_browser_reading_its_page() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(listen(
            listener,
            "expected",
            None,
            situate_core::localization::Language::En,
        ));
        let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
        socket.write_all(format!("GET /auth/callback?state=expected&code=synthetic-code&client_id=issued HTTP/1.1\r\nHost: {address}\r\n\r\n").as_bytes()).await.unwrap();
        drop(socket);
        let (callback, response) = tokio::time::timeout(Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(callback.code, "synthetic-code");
        response.complete(true).await;
        assert!(tokio::net::TcpStream::connect(address).await.is_err());
    }
}
