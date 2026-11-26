use super::{Permission, requested_scopes};
use crate::auth_callback::{self, BrowserResponse, Loopback};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::{RngCore, rngs::OsRng};
use reqwest::{Client, Response, Url};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use situate_core::localization::Language;
use std::{
    collections::{BTreeMap, BTreeSet},
    time::Duration,
};
use tokio::net::TcpListener;

const AUTHORIZE: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN: &str = "https://oauth2.googleapis.com/token";
const REVOKE: &str = "https://oauth2.googleapis.com/revoke";
const USER_INFO: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const CONFIG: &str = "native.gmail.notConfigured";
const LOGIN: &str = "native.gmail.loginFailed";
const INVALID: &str = "native.gmail.invalidCallback";
const DENIED: &str = "native.gmail.denied";

pub(super) struct Config {
    pub id: String,
    secret: String,
}
impl Config {
    pub fn load() -> Result<Self, String> {
        let pair: Option<(&str, &str)> =
            include!(concat!(env!("OUT_DIR"), "/gmail-oauth-config.rs"));
        let (id, secret) = pair.ok_or(CONFIG)?;
        Ok(Self {
            id: id.into(),
            secret: secret.into(),
        })
    }
}

pub(super) struct Grant {
    pub subject: String,
    pub email: String,
    pub token: String,
    pub scopes: BTreeSet<String>,
    pub expires: Option<u64>,
}

pub(super) fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| LOGIN.into())
}

pub(super) async fn json<T: serde::de::DeserializeOwned>(
    mut response: Response,
    limit: usize,
    error: &'static str,
) -> Result<T, String> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| error)? {
        if chunk.len() > limit - body.len() {
            return Err(error.into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| error.into())
}

fn random() -> String {
    let mut bytes = [0; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
fn valid(value: &str, limit: usize) -> bool {
    !value.is_empty()
        && value.len() <= limit
        && !value.chars().any(|c| c.is_control() || c.is_whitespace())
}

fn callback(raw: &str, port: u16, state: &str) -> Result<String, String> {
    let url = Url::parse(raw).map_err(|_| INVALID)?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(port)
        || url.path() != "/auth/callback"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(INVALID.into());
    }
    let mut fields = BTreeMap::new();
    for (name, value) in url.query_pairs() {
        if fields.insert(name, value).is_some() {
            return Err(INVALID.into());
        }
    }
    if fields.get("state").is_none_or(|value| value != state)
        || fields
            .get("iss")
            .is_some_and(|value| value != "https://accounts.google.com")
    {
        return Err(INVALID.into());
    }
    if fields.contains_key("error") {
        return Err(DENIED.into());
    }
    fields
        .remove("code")
        .filter(|code| valid(code, 4096))
        .map(|code| code.into_owned())
        .ok_or_else(|| INVALID.into())
}

#[derive(Deserialize)]
struct Token {
    access_token: String,
    refresh_token: Option<String>,
    refresh_token_expires_in: Option<u64>,
    scope: Option<String>,
    token_type: String,
}
impl Token {
    fn validate(&self) -> Result<(), String> {
        if !valid(&self.access_token, 8192) || !self.token_type.eq_ignore_ascii_case("Bearer") {
            return Err(LOGIN.into());
        }
        Ok(())
    }
}

#[derive(Deserialize)]
struct Identity {
    sub: String,
    email: String,
    email_verified: bool,
}

pub(super) async fn authorize(
    app: &tauri::AppHandle,
    language: Language,
    config: &Config,
    permissions: &BTreeSet<Permission>,
    email: Option<&str>,
    response: &mut Option<BrowserResponse>,
) -> Result<Grant, String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|_| LOGIN)?;
    let port = listener.local_addr().map_err(|_| LOGIN)?.port();
    let redirect = format!("http://127.0.0.1:{port}/auth/callback");
    let state = random();
    let verifier = random();
    let scopes = format!("openid email {}", requested_scopes(permissions).join(" "));
    let mut authorization = Url::parse(AUTHORIZE).expect("fixed authorization URL");
    authorization.query_pairs_mut().extend_pairs([
        ("client_id", config.id.as_str()),
        ("response_type", "code"),
        ("redirect_uri", &redirect),
        ("scope", &scopes),
        ("state", &state),
        ("access_type", "offline"),
        ("prompt", "consent select_account"),
        ("code_challenge_method", "S256"),
        (
            "code_challenge",
            &URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
        ),
    ]);
    if let Some(email) = email {
        authorization
            .query_pairs_mut()
            .append_pair("login_hint", email);
    }
    crate::provider_platform::open_browser(app, authorization.as_str())
        .await
        .map_err(|_| LOGIN)?;
    let (code, browser) = auth_callback::listen(
        listener,
        language,
        Loopback {
            origin: "https://accounts.google.com",
            page: auth_callback::gmail_response,
            invalid: INVALID,
            failure: LOGIN,
        },
        |raw, port| callback(raw, port, &state),
    )
    .await?;
    *response = Some(browser);
    let client = client()?;
    let reply = client
        .post(TOKEN)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", config.id.as_str()),
            ("client_secret", &config.secret),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("code_verifier", &verifier),
        ])
        .send()
        .await
        .map_err(|_| LOGIN)?;
    if !reply.status().is_success() {
        return Err(LOGIN.into());
    }
    let token: Token = json(reply, 65_536, LOGIN).await?;
    token.validate()?;
    let refresh = token
        .refresh_token
        .filter(|token| valid(token, 8192))
        .ok_or(LOGIN)?;
    let scopes = token
        .scope
        .ok_or(LOGIN)?
        .split_ascii_whitespace()
        .map(String::from)
        .collect();
    let reply = client
        .get(USER_INFO)
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|_| LOGIN)?;
    if !reply.status().is_success() {
        return Err(LOGIN.into());
    }
    let identity: Identity = json(reply, 16_384, LOGIN).await?;
    if !identity.email_verified || !valid(&identity.sub, 255) || !valid(&identity.email, 320) {
        return Err(LOGIN.into());
    }
    Ok(Grant {
        subject: identity.sub,
        email: identity.email,
        token: refresh,
        scopes,
        expires: token.refresh_token_expires_in,
    })
}

pub(super) async fn refresh(
    config: &Config,
    token: &str,
) -> Result<(String, Option<String>, Option<BTreeSet<String>>), String> {
    use super::failure::{Kind, failure};
    let refresh_error = || failure(Kind::Refresh, None, None);
    let reply = client()
        .map_err(|_| refresh_error())?
        .post(TOKEN)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", token),
            ("client_id", config.id.as_str()),
            ("client_secret", &config.secret),
        ])
        .send()
        .await
        .map_err(|_| refresh_error())?;
    refresh_response(reply).await
}

async fn refresh_response(
    reply: Response,
) -> Result<(String, Option<String>, Option<BTreeSet<String>>), String> {
    use super::failure::{Kind, failure, rejected};
    let refresh_error = |status| failure(Kind::Refresh, status, None);
    if !reply.status().is_success() {
        let (status, reason) = rejected(reply).await;
        let kind = if reason == Some("invalid_grant") {
            Kind::RefreshReconnect
        } else {
            Kind::Refresh
        };
        return Err(failure(kind, Some(status), reason));
    }
    let status = Some(reply.status().as_u16());
    let token: Token = json(reply, 65_536, "native.gmail.requestFailed")
        .await
        .map_err(|_| refresh_error(status))?;
    token.validate().map_err(|_| refresh_error(status))?;
    if token
        .refresh_token
        .as_ref()
        .is_some_and(|token| !valid(token, 8192))
    {
        return Err(refresh_error(status));
    }
    Ok((
        token.access_token,
        token.refresh_token,
        token
            .scope
            .map(|scope| scope.split_ascii_whitespace().map(String::from).collect()),
    ))
}

pub(super) async fn revoke(token: &str) -> Result<(), String> {
    const ERROR: &str = "native.gmail.revokeFailed";
    let response = client()
        .map_err(|_| ERROR)?
        .post(REVOKE)
        .form(&[("token", token)])
        .send()
        .await
        .map_err(|_| ERROR)?;
    if !response.status().is_success() {
        return Err(ERROR.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn refresh_errors_keep_only_the_status_and_a_known_reason() {
        for (status, body, key, reason) in [
            (
                400,
                r#"{"error":"invalid_grant","error_description":"synthetic-private-token"}"#,
                "native.gmail.refreshReconnect",
                "invalid_grant",
            ),
            (
                401,
                r#"{"error":"synthetic-private-token"}"#,
                "native.gmail.refreshFailed",
                "–",
            ),
            (
                200,
                r#"{"access_token":"synthetic-private-token"}"#,
                "native.gmail.refreshFailed",
                "–",
            ),
        ] {
            let reply = tauri::http::Response::builder()
                .status(status)
                .body(body)
                .unwrap()
                .into();
            let error = refresh_response(reply).await.unwrap_err();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&error).unwrap(),
                serde_json::json!({"key":key,"params":{"status":status,"reason":reason}})
            );
        }
    }

    #[test]
    fn callback_requires_the_bound_origin_path_and_state() {
        let base = "http://127.0.0.1:19423/auth/callback";
        assert_eq!(
            callback(
                &format!("{base}?code=synthetic&state=expected"),
                19423,
                "expected"
            )
            .unwrap(),
            "synthetic"
        );
        for suffix in [
            "?code=x&state=stale",
            "?code=x&state=expected&state=expected",
            "?code=x&state=expected#fragment",
            "?code=x&state=expected&iss=https://other.example",
        ] {
            assert_eq!(
                callback(&format!("{base}{suffix}"), 19423, "expected").unwrap_err(),
                INVALID
            );
        }
        assert_eq!(
            callback(
                &format!("{base}?error=access_denied&state=expected"),
                19423,
                "expected"
            )
            .unwrap_err(),
            DENIED
        );
    }
}
