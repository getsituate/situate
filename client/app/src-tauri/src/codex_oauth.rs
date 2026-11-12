/*
Codex device protocol adapted from @earendil-works/pi-ai 1.0.2:
https://github.com/earendil-works/pi/blob/v1.0.2/packages/ai/src/auth/oauth/openai-codex.ts

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
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio_util::sync::CancellationToken;

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const START: &str = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const POLL: &str = "https://auth.openai.com/api/accounts/deviceauth/token";
const TOKEN: &str = "https://auth.openai.com/oauth/token";
const VERIFY: &str = "https://auth.openai.com/codex/device";
const REDIRECT: &str = "https://auth.openai.com/deviceauth/callback";
const MAX_BODY: usize = 64 * 1024;
const LIFETIME_MS: u64 = 15 * 60 * 1000;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Credential {
    pub access: String,
    pub refresh: String,
    pub expires: u64,
    pub account_id: String,
}
impl Credential {
    pub fn expired(&self) -> bool {
        self.expires <= now()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Challenge {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_at: u64,
    #[serde(skip)]
    device_auth_id: String,
    #[serde(skip)]
    interval: Duration,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    Cancelled,
    Denied,
    Expired,
    Failed,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn client() -> Result<reqwest::Client, Error> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| Error::Failed)
}
async fn response(
    request: reqwest::RequestBuilder,
    cancel: &CancellationToken,
) -> Result<(u16, Value), Error> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(Error::Cancelled),
        result = async {
            let mut response = request.send().await.map_err(|_| Error::Failed)?;
            let status = response.status().as_u16();
            if response.content_length().is_some_and(|size| size > MAX_BODY as u64) {
                return Err(Error::Failed);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| Error::Failed)? {
                if bytes.len() + chunk.len() > MAX_BODY { return Err(Error::Failed); }
                bytes.extend_from_slice(&chunk);
            }
            let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            Ok((status, body))
        } => result,
    }
}
fn field<'a>(body: &'a Value, name: &str, max: usize) -> Result<&'a str, Error> {
    body.get(name)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control))
        .ok_or(Error::Failed)
}
pub async fn start(cancel: &CancellationToken) -> Result<Challenge, Error> {
    start_at(START, cancel).await
}
async fn start_at(endpoint: &str, cancel: &CancellationToken) -> Result<Challenge, Error> {
    let (status, body) = response(
        client()?
            .post(endpoint)
            .json(&json!({"client_id": CLIENT_ID})),
        cancel,
    )
    .await?;
    if status != 200 {
        return Err(Error::Failed);
    }
    let interval = body
        .get("interval")
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str()?.trim().parse().ok())
        })
        .filter(|n| *n <= 900)
        .ok_or(Error::Failed)?;
    Ok(Challenge {
        device_auth_id: field(&body, "device_auth_id", 4096)?.into(),
        user_code: field(&body, "user_code", 128)?.into(),
        verification_uri: VERIFY.into(),
        expires_at: now() + LIFETIME_MS,
        interval: Duration::from_secs(interval.max(1)),
    })
}
enum Progress {
    Pending,
    SlowDown,
    Complete,
}
fn progress(status: u16, body: &Value) -> Result<Progress, Error> {
    let error = body
        .get("error")
        .and_then(|error| error.as_str().or_else(|| error.get("code")?.as_str()));
    match error {
        Some("access_denied" | "authorization_declined" | "deviceauth_access_denied") => {
            Err(Error::Denied)
        }
        Some("expired_token" | "deviceauth_expired") => Err(Error::Expired),
        Some("authorization_pending" | "deviceauth_authorization_pending") => Ok(Progress::Pending),
        Some("slow_down") => Ok(Progress::SlowDown),
        Some(_) => Err(Error::Failed),
        None if status == 200 => Ok(Progress::Complete),
        None if status == 403 || status == 404 => Ok(Progress::Pending),
        None => Err(Error::Failed),
    }
}
pub async fn poll(challenge: &Challenge, cancel: &CancellationToken) -> Result<Credential, Error> {
    poll_at(challenge, POLL, TOKEN, cancel).await
}
async fn poll_at(
    challenge: &Challenge,
    endpoint: &str,
    token: &str,
    cancel: &CancellationToken,
) -> Result<Credential, Error> {
    let remaining = challenge.expires_at.saturating_sub(now());
    if remaining == 0 {
        return Err(Error::Expired);
    }
    let operation =
        async {
            let client = client()?;
            let mut interval = challenge.interval;
            loop {
                if now() >= challenge.expires_at {
                    return Err(Error::Expired);
                }
                tokio::time::sleep(interval).await;
                if now() >= challenge.expires_at {
                    return Err(Error::Expired);
                }
                let (status, body) = response(client.post(endpoint).json(&json!({
                "device_auth_id": challenge.device_auth_id, "user_code": challenge.user_code,
            })), cancel).await?;
                match progress(status, &body)? {
                    Progress::Pending => {}
                    Progress::SlowDown => {
                        interval = (interval + Duration::from_secs(5)).min(Duration::from_secs(900))
                    }
                    Progress::Complete => {
                        let code = field(&body, "authorization_code", 8192)?;
                        let verifier = field(&body, "code_verifier", 4096)?;
                        return exchange(
                            token,
                            &[
                                ("grant_type", "authorization_code"),
                                ("client_id", CLIENT_ID),
                                ("code", code),
                                ("code_verifier", verifier),
                                ("redirect_uri", REDIRECT),
                            ],
                            cancel,
                        )
                        .await;
                    }
                }
            }
        };
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(Error::Cancelled),
        result = tokio::time::timeout(Duration::from_millis(remaining), operation) => result.unwrap_or(Err(Error::Expired)),
    }
}

// Account claims are read only from tokens returned by the fixed TLS token endpoint;
// this is routing metadata, not a signed identity assertion for direct ChatGPT login.
fn credential(body: &Value) -> Result<Credential, Error> {
    let access = field(body, "access_token", 32 * 1024)?;
    let refresh = field(body, "refresh_token", 16 * 1024)?;
    let seconds = body
        .get("expires_in")
        .and_then(Value::as_u64)
        .filter(|n| *n > 0 && *n <= 365 * 24 * 60 * 60)
        .ok_or(Error::Failed)?;
    let parts: Vec<_> = access.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|part| part.is_empty()) {
        return Err(Error::Failed);
    }
    let payload: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|_| Error::Failed)?,
    )
    .map_err(|_| Error::Failed)?;
    let account_id = field(
        &payload["https://api.openai.com/auth"],
        "chatgpt_account_id",
        256,
    )?;
    if !account_id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(Error::Failed);
    }
    if body
        .get("account_id")
        .is_some_and(|id| id.as_str() != Some(account_id))
    {
        return Err(Error::Failed);
    }
    Ok(Credential {
        access: access.into(),
        refresh: refresh.into(),
        expires: now() + seconds * 1000,
        account_id: account_id.into(),
    })
}
async fn exchange(
    endpoint: &str,
    form: &[(&str, &str)],
    cancel: &CancellationToken,
) -> Result<Credential, Error> {
    let (status, body) = response(client()?.post(endpoint).form(form), cancel).await?;
    if status != 200 {
        return Err(Error::Failed);
    }
    credential(&body)
}
/// Cancellation is checked before dispatch only: a dispatched refresh may rotate
/// the provider's token. The credential owner must await this future without
/// aborting/dropping it and durably save the returned replacement before honoring
/// chat cancellation. Serialize renewal by credential identity.
pub async fn refresh(old: &Credential, cancel: &CancellationToken) -> Result<Credential, Error> {
    refresh_at(TOKEN, old, cancel).await
}
async fn refresh_at(
    endpoint: &str,
    old: &Credential,
    cancel: &CancellationToken,
) -> Result<Credential, Error> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let renewal = CancellationToken::new();
    let renewed = exchange(
        endpoint,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", &old.refresh),
            ("client_id", CLIENT_ID),
        ],
        &renewal,
    )
    .await?;
    if renewed.account_id != old.account_id {
        return Err(Error::Failed);
    }
    Ok(renewed)
}

#[cfg(test)]
#[path = "codex_oauth_tests.rs"]
mod tests;
