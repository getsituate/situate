use super::failure::{Failure, Kind, failure, rejected};
use super::{Account, CANCELLED, Owner, Permission, UNAVAILABLE, Workspace, now, oauth};
use reqwest::{Method, Url};
use serde::Deserialize;
use serde_json::{Value, json};
#[cfg(desktop)]
use tauri::Manager;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[cfg(test)]
mod tests;

const INVALID: &str = "native.gmail.invalidOperation";
const DENIED: &str = "native.gmail.permissionDenied";
const FAILED: &str = "native.gmail.requestFailed";
const UNKNOWN: &str = "native.gmail.outcomeUnknown";
const RECONNECT: &str = "native.gmail.reconnectRequired";
const SELECT: &str = "native.gmail.accountSelectionRequired";
const SUMMARY: &str = "id,threadId,labelIds";
const METADATA: &str = "id,threadId,labelIds,internalDate,payload(headers)";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Call {
    account_id: Uuid,
    #[serde(default = "empty")]
    input: Value,
}
fn empty() -> Value {
    json!({})
}

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Operation {
    ListLabels {},
    CreateLabel {
        name: String,
    },
    RenameLabel {
        id: String,
        name: String,
    },
    DeleteLabel {
        id: String,
    },
    ListMetadata {
        page_token: Option<String>,
    },
    GetMetadata {
        id: String,
    },
    ListThreadMetadata {
        page_token: Option<String>,
    },
    GetThreadMetadata {
        id: String,
    },
    ListMessages {
        page_token: Option<String>,
        query: Option<String>,
        max_results: Option<u16>,
    },
    GetMessage {
        id: String,
        #[serde(default)]
        format: MessageFormat,
    },
    ListThreads {
        page_token: Option<String>,
        query: Option<String>,
    },
    GetThread {
        id: String,
    },
    GetAttachment {
        message_id: String,
        id: String,
    },
    SendMessage {
        raw: String,
    },
    ListDrafts {
        page_token: Option<String>,
    },
    GetDraft {
        id: String,
    },
    CreateDraft {
        raw: String,
    },
    UpdateDraft {
        id: String,
        raw: String,
    },
    DeleteDraft {
        id: String,
    },
    InsertMessage {
        raw: String,
    },
    ModifyMessage {
        id: String,
        add_label_ids: Vec<String>,
        remove_label_ids: Vec<String>,
    },
    TrashMessage {
        id: String,
    },
    RestoreMessage {
        id: String,
    },
    ListFilters {},
    GetFilter {
        id: String,
    },
    CreateFilter {
        criteria: FilterCriteria,
        action: FilterAction,
    },
    DeleteFilter {
        id: String,
    },
    DeleteMessage {
        id: String,
    },
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum MessageFormat {
    #[default]
    Full,
    Metadata,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilterCriteria {
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    has_attachment: Option<bool>,
}
#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilterAction {
    add_label_ids: Vec<String>,
    remove_label_ids: Vec<String>,
}

pub(super) struct Request {
    permission: Permission,
    method: Method,
    url: Url,
    body: Option<Value>,
}
impl Request {
    fn new(permission: Permission, method: Method, path: &[&str]) -> Self {
        let mut url =
            Url::parse("https://gmail.googleapis.com/gmail/v1/users/me/").expect("fixed Gmail URL");
        url.path_segments_mut()
            .expect("Gmail URL is hierarchical")
            .pop_if_empty()
            .extend(path);
        Self {
            permission,
            method,
            url,
            body: None,
        }
    }
    fn query(mut self, key: &str, value: &str) -> Self {
        self.url.query_pairs_mut().append_pair(key, value);
        self
    }
    fn page(self, token: Option<String>, query: Option<String>) -> Result<Self, String> {
        self.page_with_limit(token, query, 50)
    }
    fn page_with_limit(
        mut self,
        token: Option<String>,
        query: Option<String>,
        limit: u16,
    ) -> Result<Self, String> {
        if !(1..=50).contains(&limit) {
            return Err(INVALID.into());
        }
        self = self.query("maxResults", &limit.to_string());
        if let Some(token) = token {
            self = self.query("pageToken", text(&token, 2048)?);
        }
        if let Some(query) = query {
            self = self.query("q", text(&query, 4096)?);
        }
        Ok(self)
    }
    fn body(mut self, value: Value) -> Self {
        self.body = Some(value);
        self
    }
}
fn text(value: &str, limit: usize) -> Result<&str, String> {
    if value.is_empty() || value.len() > limit || value.chars().any(char::is_control) {
        return Err(INVALID.into());
    }
    Ok(value)
}
fn id(value: &str) -> Result<&str, String> {
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'='))
    {
        return Err(INVALID.into());
    }
    text(value, 16_384)
}
fn raw(value: &str) -> Result<&str, String> {
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'='))
    {
        return Err(INVALID.into());
    }
    text(value, 16 * 1024 * 1024)
}
fn labels(ids: &[String]) -> Result<(), String> {
    if ids.len() > 100 {
        return Err(INVALID.into());
    }
    for value in ids {
        id(value)?;
    }
    Ok(())
}

impl Operation {
    fn request(self) -> Result<Request, String> {
        use Method as M;
        use Permission as P;
        use Request as R;
        Ok(match self {
            Self::ListLabels {} => R::new(P::Labels, M::GET, &["labels"]),
            Self::CreateLabel { name } => {
                R::new(P::Labels, M::POST, &["labels"]).body(json!({"name":text(&name, 225)?}))
            }
            Self::RenameLabel { id: item, name } => {
                R::new(P::Labels, M::PUT, &["labels", id(&item)?])
                    .body(json!({"name":text(&name, 225)?}))
            }
            Self::DeleteLabel { id: item } => R::new(P::Labels, M::DELETE, &["labels", id(&item)?]),
            Self::ListMetadata { page_token } => {
                R::new(P::Metadata, M::GET, &["messages"]).page(page_token, None)?
            }
            Self::GetMetadata { id: item } => {
                R::new(P::Metadata, M::GET, &["messages", id(&item)?])
                    .query("format", "metadata")
                    .query("fields", METADATA)
            }
            Self::ListThreadMetadata { page_token } => R::new(P::Metadata, M::GET, &["threads"])
                .query(
                    "fields",
                    "nextPageToken,resultSizeEstimate,threads(id,historyId)",
                )
                .page(page_token, None)?,
            Self::GetThreadMetadata { id: item } => {
                R::new(P::Metadata, M::GET, &["threads", id(&item)?])
                    .query("format", "metadata")
                    .query("fields", &format!("id,historyId,messages({METADATA})"))
            }
            Self::ListMessages {
                page_token,
                query,
                max_results,
            } => R::new(P::Read, M::GET, &["messages"]).page_with_limit(
                page_token,
                query,
                max_results.unwrap_or(50),
            )?,
            Self::GetMessage { id: item, format } => {
                let request = R::new(P::Read, M::GET, &["messages", id(&item)?]);
                match format {
                    MessageFormat::Full => request.query("format", "full"),
                    MessageFormat::Metadata => request
                        .query("format", "metadata")
                        .query("fields", METADATA),
                }
            }
            Self::ListThreads { page_token, query } => {
                R::new(P::Read, M::GET, &["threads"]).page(page_token, query)?
            }
            Self::GetThread { id: item } => {
                R::new(P::Read, M::GET, &["threads", id(&item)?]).query("format", "full")
            }
            Self::GetAttachment {
                message_id,
                id: item,
            } => R::new(
                P::Read,
                M::GET,
                &["messages", id(&message_id)?, "attachments", id(&item)?],
            ),
            Self::SendMessage { raw: mime } => R::new(P::Send, M::POST, &["messages", "send"])
                .query("fields", SUMMARY)
                .body(json!({"raw":raw(&mime)?})),
            Self::ListDrafts { page_token } => {
                R::new(P::Draft, M::GET, &["drafts"]).page(page_token, None)?
            }
            Self::GetDraft { id: item } => {
                R::new(P::Draft, M::GET, &["drafts", id(&item)?]).query("format", "full")
            }
            Self::CreateDraft { raw: mime } => {
                R::new(P::Draft, M::POST, &["drafts"]).body(json!({"message":{"raw":raw(&mime)?}}))
            }
            Self::UpdateDraft {
                id: item,
                raw: mime,
            } => R::new(P::Draft, M::PUT, &["drafts", id(&item)?])
                .body(json!({"message":{"raw":raw(&mime)?}})),
            Self::DeleteDraft { id: item } => R::new(P::Draft, M::DELETE, &["drafts", id(&item)?]),
            Self::InsertMessage { raw: mime } => R::new(P::Insert, M::POST, &["messages"])
                .query("fields", SUMMARY)
                .body(json!({"raw":raw(&mime)?})),
            Self::ModifyMessage {
                id: item,
                add_label_ids,
                remove_label_ids,
            } => {
                labels(&add_label_ids)?;
                labels(&remove_label_ids)?;
                R::new(P::Modify, M::POST, &["messages", id(&item)?, "modify"])
                    .query("fields", SUMMARY)
                    .body(json!({"addLabelIds":add_label_ids,"removeLabelIds":remove_label_ids}))
            }
            Self::TrashMessage { id: item } => {
                R::new(P::Modify, M::POST, &["messages", id(&item)?, "trash"])
                    .query("fields", SUMMARY)
            }
            Self::RestoreMessage { id: item } => {
                R::new(P::Modify, M::POST, &["messages", id(&item)?, "untrash"])
                    .query("fields", SUMMARY)
            }
            Self::ListFilters {} => R::new(P::FiltersRead, M::GET, &["settings", "filters"]),
            Self::GetFilter { id: item } => {
                R::new(P::FiltersRead, M::GET, &["settings", "filters", id(&item)?])
            }
            Self::CreateFilter { criteria, action } => {
                for value in [
                    &criteria.from,
                    &criteria.to,
                    &criteria.subject,
                    &criteria.query,
                ]
                .into_iter()
                .flatten()
                {
                    text(value, 4096)?;
                }
                labels(&action.add_label_ids)?;
                labels(&action.remove_label_ids)?;
                R::new(P::FiltersWrite, M::POST, &["settings", "filters"])
                    .body(json!({"criteria":criteria,"action":action}))
            }
            Self::DeleteFilter { id: item } => R::new(
                P::FiltersWrite,
                M::DELETE,
                &["settings", "filters", id(&item)?],
            ),
            Self::DeleteMessage { id: item } => {
                R::new(P::Delete, M::DELETE, &["messages", id(&item)?])
            }
        })
    }
}

pub(super) fn parse(name: &str, args: Value) -> Result<(Uuid, Request), String> {
    let Call {
        account_id,
        mut input,
    } = serde_json::from_value(args).map_err(|_| INVALID)?;
    if input
        .as_object_mut()
        .ok_or(INVALID)?
        .insert("operation".into(), json!(name))
        .is_some()
    {
        return Err(INVALID.into());
    }
    let operation: Operation = serde_json::from_value(input).map_err(|_| INVALID)?;
    Ok((account_id, operation.request()?))
}

pub(super) async fn invoke(
    owner: Owner,
    consumer: String,
    id: Uuid,
    request: Request,
    cancel: CancellationToken,
) -> Result<Value, String> {
    owner.enabled()?;
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let gate = owner.clone();
    let account_owner = consumer.clone();
    let permission = request.permission;
    let config = oauth::Config::load()?;
    let client_id = config.id.clone();
    let (version, refresh, email) = owner
        .store(move |device, scope| {
            let account = authorize(
                gate.enabled(),
                device.workspaces.get(scope),
                &consumer,
                id,
                permission,
                &client_id,
                now(),
            )?;
            Ok((
                (
                    account.version,
                    account.token.as_ref().ok_or(RECONNECT)?.clone(),
                    account.email.clone(),
                ),
                false,
            ))
        })
        .await?;
    if permission == Permission::Delete {
        let confirmed = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(CANCELLED.into()),
            accepted = confirm_delete(&owner, &email, request.url.path_segments().and_then(Iterator::last).ok_or(INVALID)?) => accepted?,
        };
        if !confirmed {
            return Err(CANCELLED.into());
        }
    }
    owner.authorized(|_| owner.enabled())?;
    let refreshed = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(CANCELLED.into()),
        result = oauth::refresh(&config, &refresh) => result,
    };
    if matches!(&refreshed, Err(error) if Failure::decode(error).is_some_and(|failure| failure.key == Kind::RefreshReconnect))
    {
        owner
            .store(move |device, scope| {
                let Some(account) = device
                    .workspaces
                    .get_mut(scope)
                    .and_then(|w| w.accounts.get_mut(&id))
                    .filter(|a| a.version == version)
                else {
                    return Ok(((), false));
                };
                account.block();
                Ok(((), true))
            })
            .await?;
    }
    let (access, rotated, scopes) = refreshed?;
    let admission = owner.clone();
    owner
        .store(move |device, scope| {
            let workspace = device.workspaces.get_mut(scope).ok_or(UNAVAILABLE)?;
            if workspace.selections.get(&account_owner) != Some(&id) {
                return Err(SELECT.into());
            }
            let account = workspace
                .accounts
                .get_mut(&id)
                .filter(|a| a.version == version && a.expires > now())
                .ok_or(UNAVAILABLE)?;
            let mut changed = false;
            if let Some(scope) = scopes.filter(|scope| *scope != account.scopes) {
                account.scopes = scope;
                changed = true;
            }
            if let Some(token) = rotated {
                account.token = Some(token);
                account.version = Uuid::new_v4();
                changed = true;
            }
            Ok((
                account.requested.contains(&permission) && permission.granted(&account.scopes),
                changed,
            ))
        })
        .await?
        .then_some(())
        .ok_or(DENIED)?;
    admission.authorized(|_| admission.enabled())?;
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let client = oauth::client().map_err(|_| failure(Kind::Api, None, None))?;
    send(client, request, &access, cancel).await
}

fn authorize<'a>(
    enabled: Result<(), String>,
    workspace: Option<&'a Workspace>,
    consumer: &str,
    id: Uuid,
    permission: Permission,
    client: &str,
    time: u64,
) -> Result<&'a Account, String> {
    enabled?;
    let account = workspace
        .and_then(|w| w.selected(consumer))
        .filter(|a| a.id == id)
        .ok_or(SELECT)?;
    if !account.requested.contains(&permission) || !permission.granted(&account.scopes) {
        return Err(DENIED.into());
    }
    if account.token.is_none() || account.expires <= time || account.client != client {
        return Err(RECONNECT.into());
    }
    Ok(account)
}

async fn send(
    client: reqwest::Client,
    request: Request,
    access: &str,
    cancel: CancellationToken,
) -> Result<Value, String> {
    let read = request.method == Method::GET;
    let uncertain = if read {
        Kind::Api
    } else {
        Kind::ApiOutcomeUnknown
    };
    let empty_post = request.method == Method::POST && request.body.is_none();
    let mut builder = client
        .request(request.method, request.url)
        .bearer_auth(access);
    if let Some(body) = request.body {
        builder = builder.json(&body);
    } else if empty_post {
        // Gmail requires a length even on POST operations with no body.
        builder = builder.header(reqwest::header::CONTENT_LENGTH, "0");
    }
    let send = async {
        let response = builder
            .send()
            .await
            .map_err(|_| failure(uncertain, None, None))?;
        let status = response.status();
        if status == reqwest::StatusCode::NO_CONTENT
            || (status.is_success() && response.content_length() == Some(0))
        {
            return Ok(Value::Null);
        }
        if !status.is_success() {
            let kind = if status == reqwest::StatusCode::UNAUTHORIZED {
                Kind::ApiReconnect
            } else if status.is_server_error() {
                uncertain
            } else {
                Kind::Api
            };
            let (status, reason) = rejected(response).await;
            return Err(failure(kind, Some(status), reason));
        }
        oauth::json(response, 40 * 1024 * 1024, FAILED)
            .await
            .map_err(|_| failure(uncertain, Some(status.as_u16()), None))
    };
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(if read { CANCELLED } else { UNKNOWN }.into()),
        result = send => result,
    }
}

#[cfg(desktop)]
async fn confirm_delete(owner: &Owner, email: &str, message: &str) -> Result<bool, String> {
    use situate_core::messages;
    let language =
        owner.authorized(|location| Ok(crate::localization::language(&owner.app, location)))?;
    let window = owner
        .app
        .get_webview_window(&owner.window)
        .ok_or(UNAVAILABLE)?;
    let question = messages::text(language, "native.gmail.deleteConfirm")
        .replace("{email}", email)
        .replace("{id}", message);
    let result = rfd::AsyncMessageDialog::new()
        .set_title(messages::text(language, "native.gmail.deleteTitle"))
        .set_description(question)
        .set_level(rfd::MessageLevel::Warning)
        .set_buttons(rfd::MessageButtons::OkCancelCustom(
            messages::text(language, "native.gmail.cancelAction"),
            messages::text(language, "native.gmail.deleteAction"),
        ))
        .set_parent(&window)
        .show()
        .await;
    Ok(
        matches!(result, rfd::MessageDialogResult::Custom(label) if label == messages::text(language, "native.gmail.deleteAction")),
    )
}
#[cfg(not(desktop))]
async fn confirm_delete(_: &Owner, _: &str, _: &str) -> Result<bool, String> {
    Err(super::PAUSED.into())
}
