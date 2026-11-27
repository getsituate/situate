use super::*;
use crate::gmail::tests::account;
use std::collections::BTreeSet;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

#[test]
fn gmail_search_transmits_the_requested_page_size_and_continuation() {
    let account = Uuid::new_v4();
    let (_, request) = parse("listMessages", json!({"accountId":account,"input":{"query":"from:demo@example.test","maxResults":5,"pageToken":"synthetic-token"}})).unwrap();
    assert_eq!(request.permission, Permission::Read);
    assert_eq!(
        request.url.as_str(),
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&pageToken=synthetic-token&q=from%3Ademo%40example.test"
    );
    let (_, default) = parse("listMessages", json!({"accountId":account})).unwrap();
    assert_eq!(default.url.query(), Some("maxResults=50"));
    for invalid in [json!(0), json!(51), json!(2.5), json!("5")] {
        assert_eq!(
            parse(
                "listMessages",
                json!({"accountId":account,"input":{"maxResults":invalid}})
            )
            .err()
            .as_deref(),
            Some(INVALID)
        );
    }
}

#[test]
fn read_permission_can_request_headers_without_the_full_message() {
    let account = Uuid::new_v4();
    for input in [
        json!({"id":"demo-msg"}),
        json!({"id":"demo-msg","format":"full"}),
    ] {
        let (_, full) = parse("getMessage", json!({"accountId":account,"input":input})).unwrap();
        assert_eq!(full.permission, Permission::Read);
        assert_eq!(full.url.query(), Some("format=full"));
    }
    let (_, headers) = parse(
        "getMessage",
        json!({"accountId":account,"input":{"id":"demo-msg","format":"metadata"}}),
    )
    .unwrap();
    assert_eq!(headers.permission, Permission::Read);
    let query: std::collections::HashMap<_, _> = headers.url.query_pairs().collect();
    assert_eq!(query["format"], "metadata");
    assert_eq!(
        query["fields"],
        "id,threadId,labelIds,internalDate,payload(headers)"
    );
}

#[test]
fn every_operation_family_needs_both_account_permission_and_the_google_grant() {
    let id = Uuid::new_v4();
    for (operation, permission, scope, input) in [
        ("listLabels", Permission::Labels, "gmail.labels", json!({})),
        (
            "getMetadata",
            Permission::Metadata,
            "gmail.metadata",
            json!({"id":"fixture"}),
        ),
        (
            "listMessages",
            Permission::Read,
            "gmail.readonly",
            json!({"query":"subject:fixture"}),
        ),
        (
            "sendMessage",
            Permission::Send,
            "gmail.send",
            json!({"raw":"dGVzdA"}),
        ),
        (
            "createDraft",
            Permission::Draft,
            "gmail.compose",
            json!({"raw":"dGVzdA"}),
        ),
        (
            "insertMessage",
            Permission::Insert,
            "gmail.insert",
            json!({"raw":"dGVzdA"}),
        ),
        (
            "trashMessage",
            Permission::Modify,
            "gmail.modify",
            json!({"id":"fixture"}),
        ),
        (
            "listFilters",
            Permission::FiltersRead,
            "gmail.settings.basic",
            json!({}),
        ),
        (
            "deleteFilter",
            Permission::FiltersWrite,
            "gmail.settings.basic",
            json!({"id":"fixture"}),
        ),
        (
            "deleteMessage",
            Permission::Delete,
            "",
            json!({"id":"fixture"}),
        ),
    ] {
        let (requested, request) = parse(operation, json!({"accountId":id,"input":input})).unwrap();
        assert_eq!(requested, id);
        assert_eq!(request.permission, permission);
        let scope = if scope.is_empty() {
            "https://mail.google.com/".into()
        } else {
            format!("https://www.googleapis.com/auth/{scope}")
        };
        let mut workspace = Workspace::default();
        workspace
            .accounts
            .insert(id, account(id, BTreeSet::from([permission]), &[&scope]));
        let allowed = |workspace: &Workspace| {
            authorize(
                Ok(()),
                Some(workspace),
                id,
                permission,
                "synthetic-desktop-client",
                99,
            )
            .map(|_| ())
        };
        assert!(allowed(&workspace).is_ok());
        workspace.accounts.get_mut(&id).unwrap().scopes.clear();
        assert_eq!(allowed(&workspace), Err(DENIED.into()));
        workspace
            .accounts
            .get_mut(&id)
            .unwrap()
            .scopes
            .insert(scope);
        workspace.accounts.get_mut(&id).unwrap().requested.clear();
        assert_eq!(allowed(&workspace), Err(DENIED.into()));
    }
}

#[test]
fn either_workspace_account_can_be_used_without_changing_a_saved_preference() {
    let mut workspace = Workspace::default();
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    for id in [first, second] {
        workspace.accounts.insert(
            id,
            account(
                id,
                BTreeSet::from([Permission::Read]),
                &["https://www.googleapis.com/auth/gmail.readonly"],
            ),
        );
    }
    let read = |workspace: &Workspace, id| {
        authorize(
            Ok(()),
            Some(workspace),
            id,
            Permission::Read,
            "synthetic-desktop-client",
            99,
        )
        .map(|account| account.id)
    };
    assert_eq!(read(&workspace, first), Ok(first));
    assert_eq!(read(&workspace, second), Ok(second));
    workspace.selections.insert("plugin:first".into(), first);
    assert_eq!(read(&workspace, second), Ok(second));
    assert_eq!(read(&Workspace::default(), second), Err(UNAVAILABLE.into()));
    workspace.accounts.remove(&second);
    assert_eq!(read(&workspace, second), Err(UNAVAILABLE.into()));
}

#[test]
fn a_draft_grant_cannot_send_and_workspace_pause_and_expiry_fail_closed() {
    let id = Uuid::new_v4();
    let mut workspace = Workspace::default();
    workspace.accounts.insert(
        id,
        account(
            id,
            BTreeSet::from([Permission::Draft]),
            &["https://www.googleapis.com/auth/gmail.compose"],
        ),
    );
    let ask = |enabled, permission, time| {
        authorize(
            enabled,
            Some(&workspace),
            id,
            permission,
            "synthetic-desktop-client",
            time,
        )
        .map(|_| ())
    };
    assert_eq!(ask(Ok(()), Permission::Send, 99), Err(DENIED.into()));
    assert_eq!(ask(Ok(()), Permission::Draft, 100), Err(RECONNECT.into()));
    assert_eq!(
        ask(Err(super::super::PAUSED.into()), Permission::Draft, 99),
        Err(super::super::PAUSED.into())
    );
}

#[test]
fn metadata_cannot_search_and_write_responses_do_not_include_mail_content() {
    let account = Uuid::nil();
    assert!(
        parse(
            "listMetadata",
            json!({"accountId":account,"input":{"query":"secret"}})
        )
        .is_err()
    );
    assert!(
        parse(
            "getMessage",
            json!({"accountId":account,"input":{"id":"../send"}})
        )
        .is_err()
    );
    let (_, request) = parse(
        "trashMessage",
        json!({"accountId":account,"input":{"id":"fixture"}}),
    )
    .unwrap();
    assert_eq!(
        request.url.query_pairs().collect::<Vec<_>>(),
        vec![("fields".into(), "id,threadId,labelIds".into())]
    );
}

#[tokio::test]
async fn trash_and_restore_send_an_explicitly_empty_post_body() {
    for (name, path) in [("trashMessage", "trash"), ("restoreMessage", "untrash")] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = async {
            let (socket, _) = listener.accept().await.unwrap();
            let mut socket = BufReader::new(socket);
            let mut line = String::new();
            socket.read_line(&mut line).await.unwrap();
            assert_eq!(line, format!("POST /{path} HTTP/1.1\r\n"));
            let mut empty_length = false;
            loop {
                line.clear();
                assert_ne!(socket.read_line(&mut line).await.unwrap(), 0);
                if line == "\r\n" {
                    break;
                }
                empty_length |= line.trim_end().eq_ignore_ascii_case("content-length: 0");
                assert!(!line.to_ascii_lowercase().starts_with("transfer-encoding:"));
            }
            let response = if empty_length {
                "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n"
            } else {
                "HTTP/1.1 411 Length Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            };
            socket
                .get_mut()
                .write_all(response.as_bytes())
                .await
                .unwrap();
        };
        let (_, mut request) = parse(
            name,
            json!({"accountId":Uuid::new_v4(),"input":{"id":"fixture"}}),
        )
        .unwrap();
        request.url = Url::parse(&format!("http://{addr}/{path}")).unwrap();
        let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            tokio::join!(
                send(
                    oauth::client().unwrap(),
                    request,
                    "synthetic",
                    CancellationToken::new()
                ),
                server
            )
        })
        .await
        .unwrap();
        assert_eq!(result.unwrap(), Value::Null, "{name}");
    }
}

#[tokio::test]
async fn trash_reports_the_gmail_status_and_reason_without_retaining_provider_text() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = async {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut first = String::new();
        BufReader::new(&mut socket)
            .read_line(&mut first)
            .await
            .unwrap();
        assert_eq!(first, "POST /trash HTTP/1.1\r\n");
        let body = r#"{"error":{"message":"private@example.test","errors":[{"reason":"insufficientPermissions","message":"synthetic-mail-id"}]}}"#;
        let response = format!(
            "HTTP/1.1 403 Forbidden\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(response.as_bytes()).await.unwrap();
    };
    let mut request = Operation::TrashMessage {
        id: "synthetic-mail-id".into(),
    }
    .request()
    .unwrap();
    request.url = Url::parse(&format!("http://{addr}/trash")).unwrap();
    let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        tokio::join!(
            send(
                oauth::client().unwrap(),
                request,
                "synthetic",
                CancellationToken::new()
            ),
            server
        )
    })
    .await
    .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&result.unwrap_err()).unwrap(),
        json!({"key":"native.gmail.apiFailed","params":{"status":403,"reason":"insufficientPermissions"}})
    );
}

#[tokio::test]
async fn a_failed_send_is_uncertain_and_not_repeated() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = async {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut first = String::new();
        BufReader::new(&mut socket)
            .read_line(&mut first)
            .await
            .unwrap();
        assert_eq!(first, "POST /send HTTP/1.1\r\n");
        socket.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
        drop(socket);
        listener
    };
    let mut request = Operation::SendMessage {
        raw: "dGVzdA".into(),
    }
    .request()
    .unwrap();
    request.url = Url::parse(&format!("http://{addr}/send")).unwrap();
    let (result, _listener) = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        tokio::join!(
            send(
                oauth::client().unwrap(),
                request,
                "synthetic",
                CancellationToken::new()
            ),
            server
        )
    })
    .await
    .unwrap();
    let error = Failure::decode(&result.unwrap_err()).unwrap();
    assert!(error.key == Kind::ApiOutcomeUnknown);
    assert_eq!(error.status(), Some(503));
}
