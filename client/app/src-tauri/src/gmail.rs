use serde::{Deserialize, Serialize};
use situate_core::ai_storage::{KeyStore, Storage};
use std::{
    collections::{BTreeMap, BTreeSet},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub(crate) mod failure;
pub(crate) mod installation;
mod oauth;
pub(crate) use installation::bundled as is_bundled;
pub(crate) const ID: &str = "situate-gmail";
mod operations;
#[cfg(test)]
mod tests;

const STORAGE: &str = "native.gmail.storage";
const PAUSED: &str = "native.gmail.paused";
const UNAVAILABLE: &str = "native.gmail.accountUnavailable";
const CANCELLED: &str = "native.gmail.cancelled";
const FULL: &str = "https://mail.google.com/";
const TEST_LIFETIME: u64 = 7 * 24 * 60 * 60;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Permission {
    Labels,
    Metadata,
    Read,
    Send,
    Draft,
    Insert,
    Modify,
    FiltersRead,
    FiltersWrite,
    Delete,
}

const SCOPES: [&str; 9] = [
    "https://www.googleapis.com/auth/gmail.labels",
    "https://www.googleapis.com/auth/gmail.metadata",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.insert",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.settings.basic",
    FULL,
];

impl Permission {
    fn scopes(self) -> usize {
        let broad = (1 << 6) | (1 << 8);
        match self {
            Self::Labels => 1 | broad,
            Self::Metadata => (1 << 1) | (1 << 2) | broad,
            Self::Read => (1 << 2) | broad,
            Self::Send => (1 << 3) | (1 << 4) | broad,
            Self::Draft => (1 << 4) | broad,
            Self::Insert => (1 << 5) | broad,
            Self::Modify => broad,
            Self::FiltersRead => (1 << 2) | (1 << 7) | broad,
            Self::FiltersWrite => 1 << 7,
            Self::Delete => 1 << 8,
        }
    }
    fn granted(self, scopes: &BTreeSet<String>) -> bool {
        SCOPES
            .iter()
            .enumerate()
            .any(|(i, scope)| self.scopes() & (1 << i) != 0 && scopes.contains(*scope))
    }
}

fn requested_scopes(permissions: &BTreeSet<Permission>) -> Vec<&'static str> {
    // Request a broad family only if explicitly needed by one of the selected actions.
    let preferred = permissions.iter().fold(0, |mask, p| {
        let index = match p {
            Permission::FiltersRead | Permission::FiltersWrite => 7,
            _ => p.scopes().trailing_zeros(),
        };
        mask | (1 << index)
    });
    let selected = (1usize..=preferred)
        .filter(|mask| {
            mask & preferred == *mask && permissions.iter().all(|p| p.scopes() & mask != 0)
        })
        .min_by_key(|mask| (mask.count_ones(), *mask))
        .unwrap_or(0);
    SCOPES
        .iter()
        .enumerate()
        .filter_map(|(i, s)| (selected & (1 << i) != 0).then_some(*s))
        .collect()
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Serialize, Deserialize)]
struct Account {
    id: Uuid,
    version: Uuid,
    subject: String,
    email: String,
    client: String,
    requested: BTreeSet<Permission>,
    scopes: BTreeSet<String>,
    token: Option<String>,
    expires: u64,
}
impl Account {
    fn snapshot(&self) -> AccountSnapshot {
        let permissions: BTreeSet<_> = self
            .requested
            .iter()
            .copied()
            .filter(|p| p.granted(&self.scopes))
            .collect();
        AccountSnapshot {
            id: self.id,
            email: self.email.clone(),
            missing: self.requested.difference(&permissions).copied().collect(),
            partial: permissions != self.requested,
            permissions,
            reconnect: self.token.is_none() || self.expires <= now(),
        }
    }
    fn block(&mut self) {
        self.version = Uuid::new_v4();
        self.token = None;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountSnapshot {
    id: Uuid,
    email: String,
    permissions: BTreeSet<Permission>,
    missing: BTreeSet<Permission>,
    partial: bool,
    reconnect: bool,
}

#[derive(Deserialize, Serialize)]
struct Device {
    version: u8,
    workspaces: BTreeMap<String, Workspace>,
}
impl Device {
    fn owns(&self, scope: &str, incarnation: &str) -> bool {
        self.workspaces
            .get(scope)
            .and_then(|workspace| workspace.incarnation.as_deref())
            == Some(incarnation)
    }
}

impl Default for Device {
    fn default() -> Self {
        Self {
            version: 1,
            workspaces: BTreeMap::new(),
        }
    }
}

#[derive(Default, Deserialize, Serialize)]
struct Workspace {
    incarnation: Option<String>,
    accounts: BTreeMap<Uuid, Account>,
    #[serde(default)]
    selections: BTreeMap<String, Uuid>,
}
impl Workspace {
    fn selected(&self, consumer: &str) -> Option<&Account> {
        self.selections
            .get(consumer)
            .and_then(|id| self.accounts.get(id))
    }
}

pub(crate) fn fixture(
    context: &crate::ai_executor::Context,
    test_id: &str,
    check_owner: &str,
    name: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let responses = crate::plugin_changes::responses(
        &context.app,
        &context.window,
        &context.scope,
        test_id,
        check_owner,
    )?;
    fixture_response(&responses, name, args)
}

fn fixture_response(
    responses: &std::collections::HashMap<String, crate::plugin_checks::HttpFixture>,
    name: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Call::parse(name, args)?;
    let key = format!("POST https://gmail.situate.invalid/{name}");
    let response = responses.get(&key).ok_or("native.gmail.testUnavailable")?;
    if !(200..300).contains(&response.status) {
        return Err("native.gmail.requestFailed".into());
    }
    serde_json::from_str(&response.body).map_err(|_| "native.gmail.invalidOperation".into())
}

fn consumer_key(id: &str, incarnation: &str) -> String {
    format!("{id}:{incarnation}")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Authorize {
    id: Uuid,
    account_id: Option<Uuid>,
    permissions: BTreeSet<Permission>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountId {
    account_id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Selection {
    account_id: Option<Uuid>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AttemptId {
    id: Uuid,
}

const INVALID: &str = "native.gmail.invalidOperation";

enum Call {
    ListAccounts,
    SelectedAccount,
    Authorize(Authorize),
    CancelSignIn(AttemptId),
    Disconnect(AccountId),
    SelectAccount(Selection),
    Mail(Uuid, operations::Request),
}

impl Call {
    fn parse(name: &str, args: serde_json::Value) -> Result<Self, String> {
        fn input<T: serde::de::DeserializeOwned>(args: serde_json::Value) -> Result<T, String> {
            serde_json::from_value(args).map_err(|_| INVALID.into())
        }
        Ok(match name {
            "listAccounts" | "selectedAccount" => {
                if !args.is_null() && args != serde_json::json!({}) {
                    return Err(INVALID.into());
                }
                if name == "listAccounts" {
                    Self::ListAccounts
                } else {
                    Self::SelectedAccount
                }
            }
            "authorize" => Self::Authorize(input(args)?),
            "cancelSignIn" => Self::CancelSignIn(input(args)?),
            "disconnect" => Self::Disconnect(input(args)?),
            "selectAccount" => Self::SelectAccount(input(args)?),
            _ => {
                let (account, request) = operations::parse(name, args)?;
                Self::Mail(account, request)
            }
        })
    }
}

pub(crate) async fn invoke(
    context: &crate::ai_executor::Context,
    incarnation: &str,
    caller: Option<(&str, &str)>,
    name: &str,
    args: serde_json::Value,
    interactive: bool,
    cancel: CancellationToken,
) -> Result<serde_json::Value, String> {
    let owner = Owner {
        app: context.app.clone(),
        scope: context.scope.clone(),
        window: context.window.clone(),
        session: context.authorization.clone(),
        incarnation: Some(incarnation.to_owned()),
    };
    // A dependency declaration does not replace local authorization of the connection.
    owner.store(|_, _| Ok(((), false))).await?;
    let consumer = || {
        caller
            .map(|(id, incarnation)| consumer_key(id, incarnation))
            .ok_or(INVALID)
    };
    match Call::parse(name, args)? {
        Call::ListAccounts if caller.is_some() || interactive => {
            serde_json::to_value(accounts(owner, caller.is_some(), cancel).await?)
                .map_err(|_| STORAGE.into())
        }
        Call::SelectedAccount => selected_account(owner, consumer()?, cancel).await,
        Call::Authorize(input) if interactive && caller.is_none() => {
            serde_json::to_value(authorize(owner, input, cancel).await?).map_err(|_| STORAGE.into())
        }
        Call::CancelSignIn(input) if interactive && caller.is_none() => {
            cancel_sign_in(&owner, input.id)?;
            Ok(serde_json::Value::Null)
        }
        Call::Disconnect(input) if interactive && caller.is_none() => {
            disconnect(owner, input.account_id).await?;
            Ok(serde_json::Value::Null)
        }
        Call::SelectAccount(input) if interactive => {
            select(owner, consumer()?, input.account_id).await
        }
        Call::Mail(id, request) => {
            caller.ok_or(INVALID)?;
            operations::invoke(owner, id, request, cancel).await
        }
        _ => Err("native.gmail.permissionDenied".into()),
    }
}

async fn selected_account(
    owner: Owner,
    consumer: String,
    cancel: CancellationToken,
) -> Result<serde_json::Value, String> {
    owner.enabled()?;
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let gate = owner.clone();
    owner
        .store(move |device, scope| {
            gate.enabled()?;
            let account = device
                .workspaces
                .get(scope)
                .and_then(|w| w.selected(&consumer));
            let snapshot =
                serde_json::to_value(account.map(Account::snapshot)).map_err(|_| STORAGE)?;
            Ok((snapshot, false))
        })
        .await
}

async fn select(
    owner: Owner,
    consumer: String,
    id: Option<Uuid>,
) -> Result<serde_json::Value, String> {
    owner.enabled()?;
    owner
        .store(move |device, scope| {
            let workspace = device.workspaces.get_mut(scope).ok_or(UNAVAILABLE)?;
            if let Some(id) = id {
                if !workspace.accounts.contains_key(&id) {
                    return Err(UNAVAILABLE.into());
                }
                workspace.selections.insert(consumer, id);
            } else {
                workspace.selections.remove(&consumer);
            }
            Ok((serde_json::json!(id), true))
        })
        .await
}

struct Keys(tauri::AppHandle);
impl KeyStore for Keys {
    fn get(&self, name: &str) -> Result<Vec<u8>, String> {
        crate::provider_platform::key_get(&self.0, name)
    }
    fn set(&self, name: &str, key: &[u8]) -> Result<(), String> {
        crate::provider_platform::key_set(&self.0, name, key)
    }
    fn delete(&self, name: &str) -> Result<(), String> {
        crate::provider_platform::key_delete(&self.0, name)
    }
}

fn access<T>(
    app: &tauri::AppHandle,
    action: impl FnOnce(&mut Device) -> Result<(T, bool), String>,
) -> Result<T, String> {
    let dir = crate::provider_platform::credential_dir(app)?.join("gmail-plugin");
    std::fs::create_dir_all(dir.join(".situate")).map_err(|_| STORAGE)?;
    let storage = Storage::open(&dir, "gmail-plugin-device-v1").map_err(|_| STORAGE)?;
    with_store(&storage, &Keys(app.clone()), action).map(|(value, _)| value)
}

fn with_store<T>(
    storage: &Storage,
    keys: &impl KeyStore,
    action: impl FnOnce(&mut Device) -> Result<(T, bool), String>,
) -> Result<(T, bool), String> {
    let _lock = storage.lock_credentials().map_err(|_| STORAGE)?;
    let mut device: Device = match storage.load(keys).map_err(|_| STORAGE)? {
        Some(bytes) => serde_json::from_slice(&bytes).map_err(|_| STORAGE)?,
        None => Device::default(),
    };
    if device.version != 1 {
        return Err(STORAGE.into());
    }
    let (value, changed) = action(&mut device)?;
    if changed {
        let encoded = serde_json::to_vec(&device).map_err(|_| STORAGE)?;
        storage.save(keys, &encoded).map_err(|_| STORAGE)?;
    }
    Ok((value, changed))
}

#[derive(Clone)]
struct Owner {
    app: tauri::AppHandle,
    window: String,
    scope: String,
    session: crate::workspaces::AuthorizationSession,
    incarnation: Option<String>,
}
impl Owner {
    fn new(
        app: tauri::AppHandle,
        window: &tauri::WebviewWindow,
        scope: String,
    ) -> Result<Self, String> {
        let session = crate::workspaces::authorization_session(&app, window.label(), &scope)?;
        Ok(Self {
            app,
            window: window.label().into(),
            scope,
            session,
            incarnation: None,
        })
    }
    fn authorized<T>(
        &self,
        action: impl FnOnce(&situate_core::workspaces::Location) -> Result<T, String>,
    ) -> Result<T, String> {
        crate::workspaces::with_authorization_session(
            &self.app,
            &self.window,
            &self.session,
            action,
        )
    }
    async fn store<T: Send + 'static>(
        &self,
        action: impl FnOnce(&mut Device, &str) -> Result<(T, bool), String> + Send + 'static,
    ) -> Result<T, String> {
        let owner = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            owner.authorized(|_| {
                access(&owner.app, |state| {
                    if let Some(expected) = &owner.incarnation
                        && !state.owns(&owner.scope, expected)
                    {
                        return Err(UNAVAILABLE.into());
                    }
                    action(state, &owner.scope)
                })
            })
        })
        .await
        .map_err(|_| STORAGE)?
    }
    fn enabled(&self) -> Result<(), String> {
        if !crate::experimental::enabled(&self.app)? {
            return Err(PAUSED.into());
        }
        Ok(())
    }
}

async fn accounts(
    owner: Owner,
    consumer: bool,
    cancel: CancellationToken,
) -> Result<Vec<AccountSnapshot>, String> {
    let gate = owner.clone();
    owner
        .store(move |device, scope| {
            if cancel.is_cancelled() {
                return Err(CANCELLED.into());
            }
            if consumer {
                gate.enabled()?;
            }
            Ok((
                device
                    .workspaces
                    .get(scope)
                    .into_iter()
                    .flat_map(|w| w.accounts.values().map(Account::snapshot))
                    .collect(),
                false,
            ))
        })
        .await
}

#[derive(Default)]
pub(crate) struct Attempts(std::sync::Mutex<BTreeMap<String, Attempt>>);
struct Attempt {
    window: String,
    id: Uuid,
    cancel: CancellationToken,
}
struct AttemptGuard {
    owner: Owner,
    id: Uuid,
}
impl Drop for AttemptGuard {
    fn drop(&mut self) {
        if let Ok(mut attempts) = self.owner.app.state::<Attempts>().0.lock()
            && attempts
                .get(&self.owner.scope)
                .is_some_and(|a| a.id == self.id)
        {
            attempts.remove(&self.owner.scope);
        }
    }
}

fn cancel_sign_in(owner: &Owner, id: Uuid) -> Result<(), String> {
    let attempts = owner.app.state::<Attempts>();
    let attempts = attempts.0.lock().map_err(|_| STORAGE)?;
    if let Some(attempt) = attempts
        .get(&owner.scope)
        .filter(|a| a.window == owner.window && a.id == id)
    {
        attempt.cancel.cancel();
    }
    Ok(())
}

async fn authorize(
    owner: Owner,
    input: Authorize,
    cancel: CancellationToken,
) -> Result<AccountSnapshot, String> {
    let Authorize {
        id,
        account_id,
        permissions,
    } = input;
    owner.enabled()?;
    if permissions.is_empty() {
        return Err("native.gmail.permissionsRequired".into());
    }
    let config = oauth::Config::load()?;
    let cancel = cancel.child_token();
    {
        let state = owner.app.state::<Attempts>();
        let mut attempts = state.0.lock().map_err(|_| STORAGE)?;
        if attempts.contains_key(&owner.scope) {
            return Err("native.gmail.busy".into());
        }
        attempts.insert(
            owner.scope.clone(),
            Attempt {
                window: owner.window.clone(),
                id,
                cancel: cancel.clone(),
            },
        );
    }
    let _guard = AttemptGuard {
        owner: owner.clone(),
        id,
    };
    let requested = permissions.clone();
    let (previous, revocation) = owner
        .store(move |device, scope| {
            let Some(account_id) = account_id else {
                return Ok(((None, None), false));
            };
            let account = device
                .workspaces
                .get_mut(scope)
                .and_then(|w| w.accounts.get_mut(&account_id))
                .ok_or(UNAVAILABLE)?;
            let reduction = account
                .requested
                .iter()
                .any(|p| p.granted(&account.scopes) && !requested.contains(p));
            if !reduction {
                return Ok((
                    (
                        Some((
                            account.version,
                            account.subject.clone(),
                            account.email.clone(),
                        )),
                        None,
                    ),
                    false,
                ));
            }
            account.requested.retain(|p| requested.contains(p));
            let revoke = account.token.take();
            let client = account.client.clone();
            let subject = account.subject.clone();
            let email = account.email.clone();
            block_grants(device, &client, &subject);
            let version = device.workspaces[scope].accounts[&account_id].version;
            Ok(((Some((version, subject, email)), revoke), true))
        })
        .await?;
    if let Some(token) = revocation {
        oauth::revoke(&token).await?;
    }
    if cancel.is_cancelled() {
        return Err(CANCELLED.into());
    }
    let language =
        owner.authorized(|location| Ok(crate::localization::language(&owner.app, location)))?;
    let mut response = None;
    let monitor = async {
        loop {
            tokio::time::sleep(Duration::from_millis(250)).await;
            owner.authorized(|_| owner.enabled())?;
        }
        #[allow(unreachable_code)]
        Ok::<(), String>(())
    };
    let grant = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(CANCELLED.into()),
        result = monitor => { result?; return Err(CANCELLED.into()); },
        result = tokio::time::timeout(Duration::from_secs(300), oauth::authorize(&owner.app, language, &config, &permissions, previous.as_ref().map(|(_, _, email)| email.as_str()), &mut response)) => result.map_err(|_| "native.gmail.timeout")??,
    };
    let committing = owner.clone();
    let snapshot = owner
        .store(move |device, scope| {
            committing.enabled()?;
            if cancel.is_cancelled() {
                return Err(CANCELLED.into());
            }
            let workspace = device.workspaces.entry(scope.to_owned()).or_default();
            let replacing = previous.as_ref().and_then(|(version, subject, _)| {
                account_id.map(|id| (id, *version, subject.as_str()))
            });
            let snapshot = apply_grant(workspace, replacing, config.id, permissions, grant, now())?;
            Ok((snapshot, true))
        })
        .await?;
    if let Some(response) = response {
        response.complete(true).await;
    }
    Ok(snapshot)
}

fn apply_grant(
    workspace: &mut Workspace,
    previous: Option<(Uuid, Uuid, &str)>,
    client: String,
    permissions: BTreeSet<Permission>,
    grant: oauth::Grant,
    time: u64,
) -> Result<AccountSnapshot, String> {
    let id = if let Some((id, version, subject)) = previous {
        if subject != grant.subject {
            return Err("native.gmail.wrongAccount".into());
        }
        if workspace
            .accounts
            .get(&id)
            .is_none_or(|a| a.version != version)
        {
            return Err(UNAVAILABLE.into());
        }
        id
    } else {
        if workspace
            .accounts
            .values()
            .any(|account| account.subject == grant.subject)
        {
            return Err("native.gmail.alreadyConnected".into());
        }
        Uuid::new_v4()
    };
    let account = Account {
        id,
        version: Uuid::new_v4(),
        subject: grant.subject,
        email: grant.email,
        client,
        requested: permissions,
        scopes: grant.scopes,
        token: Some(grant.token),
        expires: time.saturating_add(grant.expires.unwrap_or(TEST_LIFETIME).min(TEST_LIFETIME)),
    };
    let snapshot = account.snapshot();
    workspace.accounts.insert(id, account);
    Ok(snapshot)
}

fn block_grants(device: &mut Device, client: &str, subject: &str) {
    for account in device
        .workspaces
        .values_mut()
        .flat_map(|w| w.accounts.values_mut())
    {
        if account.client == client && account.subject == subject {
            account.block();
        }
    }
}

async fn disconnect(owner: Owner, account_id: Uuid) -> Result<(), String> {
    let token = owner
        .store(move |device, scope| {
            let workspace = device.workspaces.get_mut(scope).ok_or(UNAVAILABLE)?;
            let account = workspace.accounts.remove(&account_id).ok_or(UNAVAILABLE)?;
            if account.token.is_some() {
                block_grants(device, &account.client, &account.subject);
            }
            Ok((account.token, true))
        })
        .await?;
    if let Some(token) = token {
        oauth::revoke(&token).await?;
    }
    Ok(())
}
