use super::{Trace, checkpoint, diagnostic_error, request_json_diagnosed};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

const ISSUER: &str = "https://auth.openai.com";
pub(super) const JWKS: &str = "https://auth.openai.com/.well-known/jwks.json";

#[derive(Deserialize)]
struct Claims {
    iss: String,
    aud: Audience,
    exp: u64,
    sub: String,
    nonce: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Audience {
    Single(String),
    Multiple(Vec<String>),
}
impl Audience {
    fn contains(&self, client: &str) -> bool {
        match self {
            Self::Single(value) => value == client,
            Self::Multiple(values) => values.iter().any(|value| value == client),
        }
    }
}

pub(super) async fn verify(
    endpoint: &str,
    token: &str,
    client: &str,
    nonce: &str,
    cancel: &CancellationToken,
    trace: Trace<'_>,
) -> Result<String, String> {
    let keys = request_json_diagnosed(endpoint, None, cancel, trace, "identity_keys").await?;
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(super::CANCELLED.into()),
        result = async { verify_with_keys(token, client, nonce, &keys, trace) } => result,
    }
}

pub(super) fn verify_with_keys(
    token: &str,
    client: &str,
    nonce: &str,
    jwks: &Value,
    trace: Trace<'_>,
) -> Result<String, String> {
    checkpoint(trace, "identity_verify");
    let failed = |reason| diagnostic_error(trace, "identity_verify", reason);
    if token.len() > 16_384 || client.is_empty() || nonce.is_empty() {
        return Err(failed("jwt_format"));
    }
    let header = decode_header(token).map_err(|_| failed("jwt_format"))?;
    if header.alg != Algorithm::RS256 {
        return Err(failed("jwt_algorithm"));
    }
    let raw_header = URL_SAFE_NO_PAD
        .decode(
            token
                .split('.')
                .next()
                .ok_or_else(|| failed("jwt_format"))?,
        )
        .map_err(|_| failed("jwt_format"))?;
    let raw_header: Value =
        serde_json::from_slice(&raw_header).map_err(|_| failed("jwt_format"))?;
    if raw_header.get("crit").is_some() {
        return Err(failed("jwt_algorithm"));
    }
    let kid = header
        .kid
        .filter(|kid| !kid.is_empty() && kid.len() <= 256)
        .ok_or_else(|| failed("jwt_key"))?;
    let keys = jwks["keys"]
        .as_array()
        .filter(|keys| keys.len() <= 32)
        .ok_or_else(|| failed("jwt_key"))?;
    let mut matching = keys.iter().filter(|key| key["kid"].as_str() == Some(&kid));
    let key = matching.next().ok_or_else(|| failed("jwt_key"))?;
    if matching.next().is_some()
        || key["kty"] != "RSA"
        || key.get("alg").is_some_and(|alg| alg != "RS256")
        || key.get("use").is_some_and(|usage| usage != "sig")
        || key.get("key_ops").is_some_and(|ops| {
            !ops.as_array()
                .is_some_and(|ops| ops.iter().any(|op| op == "verify"))
        })
    {
        return Err(failed("jwt_key"));
    }
    let n = key["n"]
        .as_str()
        .filter(|n| n.len() <= 684)
        .ok_or_else(|| failed("jwt_key"))?;
    let e = key["e"]
        .as_str()
        .filter(|e| e.len() <= 12)
        .ok_or_else(|| failed("jwt_key"))?;
    let modulus = URL_SAFE_NO_PAD.decode(n).map_err(|_| failed("jwt_key"))?;
    if !(256..=512).contains(&modulus.len()) {
        return Err(failed("jwt_key"));
    }
    let key = DecodingKey::from_rsa_components(n, e).map_err(|_| failed("jwt_key"))?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.leeway = 0;
    validation.validate_nbf = true;
    validation.set_issuer(&[ISSUER]);
    validation.set_audience(&[client]);
    validation.set_required_spec_claims(&["iss", "aud", "exp", "sub"]);
    let claims = decode::<Claims>(token, &key, &validation)
        .map_err(|error| {
            use jsonwebtoken::errors::ErrorKind;
            failed(match error.kind() {
                ErrorKind::InvalidSignature => "jwt_signature",
                ErrorKind::ExpiredSignature => "jwt_expired",
                ErrorKind::InvalidIssuer => "jwt_issuer",
                ErrorKind::InvalidAudience => "jwt_audience",
                ErrorKind::ImmatureSignature => "jwt_not_yet_valid",
                ErrorKind::MissingRequiredClaim(field) => claim_error(field, true),
                ErrorKind::InvalidClaimFormat(field) => claim_error(field, false),
                ErrorKind::Json(_) => claim_decode_error(token),
                ErrorKind::InvalidToken | ErrorKind::Base64(_) | ErrorKind::Utf8(_) => "jwt_format",
                ErrorKind::InvalidRsaKey(_) | ErrorKind::InvalidKeyFormat => "jwt_key",
                ErrorKind::InvalidAlgorithm
                | ErrorKind::UnsupportedAlgorithm
                | ErrorKind::MissingAlgorithm => "jwt_algorithm",
                ErrorKind::Provider(_) => "jwt_crypto",
                _ => "jwt_claims",
            })
        })?
        .claims;
    if claims.iss != ISSUER {
        return Err(failed("jwt_issuer"));
    }
    if !claims.aud.contains(client) {
        return Err(failed("jwt_audience"));
    }
    if claims.exp <= super::now() / 1000 {
        return Err(failed("jwt_expired"));
    }
    if claims.nonce != nonce {
        return Err(failed("jwt_nonce"));
    }
    if claims.sub.trim().is_empty()
        || claims.sub.len() > 512
        || claims.sub.chars().any(char::is_control)
    {
        return Err(failed("jwt_subject"));
    }
    Ok(claims.sub)
}

const CLAIM_ERRORS: [(&str, &str, &str); 5] = [
    ("iss", "jwt_issuer_missing", "jwt_issuer_type"),
    ("aud", "jwt_audience_missing", "jwt_audience_type"),
    ("exp", "jwt_expiry_missing", "jwt_expiry_type"),
    ("sub", "jwt_subject_missing", "jwt_subject_type"),
    ("nonce", "jwt_nonce_missing", "jwt_nonce_type"),
];

fn claim_error(field: &str, missing: bool) -> &'static str {
    if field == "nbf" {
        return "jwt_not_before_format";
    }
    CLAIM_ERRORS
        .iter()
        .find(|entry| entry.0 == field)
        .map(|(_, absent, invalid)| if missing { *absent } else { *invalid })
        .unwrap_or("jwt_claims")
}

fn claim_decode_error(token: &str) -> &'static str {
    // This diagnostic-only parse classifies an already rejected token; it cannot authorize it.
    let payload = token
        .split('.')
        .nth(1)
        .and_then(|value| URL_SAFE_NO_PAD.decode(value).ok())
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let Some(Value::Object(claims)) = payload else {
        return "jwt_claims_decode";
    };
    for (field, absent, invalid) in CLAIM_ERRORS {
        let Some(value) = claims.get(field) else {
            return absent;
        };
        let valid = match field {
            "exp" => value.as_u64().is_some(),
            "aud" => {
                value.is_string()
                    || value
                        .as_array()
                        .is_some_and(|values| values.iter().all(Value::is_string))
            }
            _ => value.is_string(),
        };
        if !valid {
            return invalid;
        }
    }
    "jwt_claims_decode"
}
