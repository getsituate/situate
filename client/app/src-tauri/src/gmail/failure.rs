use reqwest::Response;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::oauth;

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub(crate) enum Kind {
    #[serde(rename = "native.gmail.refreshFailed")]
    Refresh,
    #[serde(rename = "native.gmail.refreshReconnect")]
    RefreshReconnect,
    #[serde(rename = "native.gmail.apiFailed")]
    Api,
    #[serde(rename = "native.gmail.apiReconnect")]
    ApiReconnect,
    #[serde(rename = "native.gmail.apiOutcomeUnknown")]
    ApiOutcomeUnknown,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Failure {
    pub key: Kind,
    params: Params,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Params {
    status: Value,
    reason: String,
}

const ABSENT: &str = "–";

impl Failure {
    pub(crate) fn decode(error: &str) -> Option<Self> {
        if error.len() > 256 {
            return None;
        }
        let value: Self = serde_json::from_str(error).ok()?;
        let valid_status = value.params.status == ABSENT || value.status().is_some();
        let valid_reason =
            value.params.reason == ABSENT || known_reason(&value.params.reason).is_some();
        (valid_status && valid_reason).then_some(value)
    }

    pub(crate) fn status(&self) -> Option<u16> {
        self.params
            .status
            .as_u64()
            .filter(|n| (100..=599).contains(n))
            .map(|n| n as u16)
    }

    pub(crate) fn code(&self) -> &'static str {
        match self.key {
            Kind::Refresh => "native.gmail.refreshFailed",
            Kind::RefreshReconnect => "native.gmail.refreshReconnect",
            Kind::Api => "native.gmail.apiFailed",
            Kind::ApiReconnect => "native.gmail.apiReconnect",
            Kind::ApiOutcomeUnknown => "native.gmail.apiOutcomeUnknown",
        }
    }
}

pub(super) fn failure(kind: Kind, status: Option<u16>, reason: Option<&str>) -> String {
    let failure = Failure {
        key: kind,
        params: Params {
            status: status.map_or(json!(ABSENT), |status| json!(status)),
            reason: reason.and_then(known_reason).unwrap_or(ABSENT).into(),
        },
    };
    situate_core::messages::error(failure.code(), json!(failure.params))
}

pub(super) async fn rejected(response: Response) -> (u16, Option<&'static str>) {
    let status = response.status().as_u16();
    let reason = oauth::json(response, 16 * 1024, "native.gmail.requestFailed")
        .await
        .ok()
        .and_then(|body: Value| reason(&body));
    (status, reason)
}

fn reason(body: &Value) -> Option<&'static str> {
    let error = &body["error"];
    error
        .as_str()
        .and_then(known_reason)
        .or_else(|| {
            error["details"]
                .as_array()
                .into_iter()
                .flatten()
                .chain(error["errors"].as_array().into_iter().flatten())
                .filter_map(|entry| entry["reason"].as_str())
                .find_map(known_reason)
        })
        .or_else(|| error["status"].as_str().and_then(known_reason))
}

fn known_reason(value: &str) -> Option<&'static str> {
    const REASONS: &[&str] = &[
        "invalid_grant",
        "invalid_client",
        "invalid_request",
        "invalid_scope",
        "unauthorized_client",
        "access_denied",
        "insufficientPermissions",
        "authError",
        "badRequest",
        "forbidden",
        "notFound",
        "rateLimitExceeded",
        "userRateLimitExceeded",
        "dailyLimitExceeded",
        "domainPolicy",
        "backendError",
        "invalidArgument",
        "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
        "SERVICE_DISABLED",
        "INVALID_ARGUMENT",
        "NOT_FOUND",
        "PERMISSION_DENIED",
        "UNAUTHENTICATED",
        "RESOURCE_EXHAUSTED",
        "FAILED_PRECONDITION",
        "UNAVAILABLE",
        "INTERNAL",
    ];
    REASONS.iter().copied().find(|reason| *reason == value)
}
