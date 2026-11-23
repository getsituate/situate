use super::*;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

const INSTALLATION: &str = "3f035b8e-688b-411c-a51e-29543fdb2515";

#[test]
fn reserves_only_one_event_per_utc_day_across_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("analytics-v1.json");
    let mut local = load(&path).unwrap();
    let before = OffsetDateTime::parse("2026-05-01T23:59:59Z", &Rfc3339).unwrap();
    let after = OffsetDateTime::parse("2026-05-02T00:00:01Z", &Rfc3339).unwrap();
    assert_eq!(reserve_day(&path, &mut local, before), None);
    assert!(!path.exists());

    let installation = Uuid::parse_str(INSTALLATION).unwrap();
    local.enabled = true;
    local.installation_id = Some(installation);
    assert_eq!(reserve_day(&path, &mut local, before), Some(installation));
    assert_eq!(reserve_day(&path, &mut local, before), None);
    let mut reopened = load(&path).unwrap();
    assert_eq!(reserve_day(&path, &mut reopened, before), None);
    assert_eq!(reserve_day(&path, &mut reopened, after), Some(installation));
    assert_eq!(reserve_day(&path, &mut reopened, before), None);
    reopened.enabled = false;
    save(&path, &reopened).unwrap();
    let mut reopened = load(&path).unwrap();
    assert_eq!(
        reserve_day(&path, &mut reopened, after + time::Duration::DAY),
        None
    );
}

#[test]
fn unreadable_state_does_not_grant_consent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("analytics-v1.json");
    fs::write(&path, b"{invalid").unwrap();
    assert!(load(&path).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"{invalid");
}

#[tokio::test]
async fn sends_only_the_allowed_event_fields_and_drops_cancelled_delivery() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/i/v0/e/", listener.local_addr().unwrap());
    let client = Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    let installation = Uuid::parse_str(INSTALLATION).unwrap();
    let workspace = "ce8e4ecb-4cd1-4719-b5a5-f50badb9cf31";
    let event = daily_event(
        "phc_synthetic",
        installation,
        Some(workspace_pseudonym(workspace)),
        "0.1.6",
        "15.7.1",
        "2026-05-02T00:00:01Z".to_owned(),
    );
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    deliver(&client, &endpoint, &event, &cancelled).await;
    assert!(
        tokio::time::timeout(Duration::from_millis(50), listener.accept())
            .await
            .is_err()
    );

    let server = async {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut reader = BufReader::new(&mut stream);
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        assert_eq!(line, "POST /i/v0/e/ HTTP/1.1\r\n");
        let mut length = 0;
        loop {
            line.clear();
            assert!(reader.read_line(&mut line).await.unwrap() > 0);
            if line == "\r\n" {
                break;
            }
            if let Some(value) = line.strip_prefix("content-length: ") {
                length = value.trim().parse().unwrap();
            }
        }
        let mut body = vec![0; length];
        reader.read_exact(&mut body).await.unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .await
            .unwrap();
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()
    };
    let (body, ()) = tokio::time::timeout(Duration::from_secs(3), async {
        let allowed = CancellationToken::new();
        tokio::join!(server, deliver(&client, &endpoint, &event, &allowed))
    })
    .await
    .unwrap();
    assert_eq!(
        body,
        serde_json::json!({
            "api_key": "phc_synthetic",
            "event": "app_daily_active",
            "timestamp": "2026-05-02T00:00:01Z",
            "properties": {
                "distinct_id": INSTALLATION, "installation_id": INSTALLATION,
                "workspace_id": "f975f72445ea1f8b91f48e023c1bb03d95267cb8367061ed7b480ed7e0acf854", "surface": "app", "app_version": "0.1.6",
                "platform": "macos", "os_version": "15.7.1",
                "$geoip_disable": true, "$process_person_profile": false
            }
        })
    );
    let no_workspace = daily_event(
        "phc_synthetic",
        installation,
        None,
        "0.1.6",
        "15.7.1",
        "2026-05-02T00:00:01Z".to_owned(),
    );
    assert_eq!(
        serde_json::to_value(no_workspace).unwrap()["properties"]["workspace_id"],
        serde_json::Value::Null
    );
}
