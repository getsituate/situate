use super::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{mpsc, oneshot},
    task::JoinHandle,
};

struct Clock(JoinHandle<()>);
impl Clock {
    fn pause() -> Self {
        tokio::time::pause();
        // Keep virtual time under test control while loopback I/O waits for readiness.
        Self(tokio::spawn(async {
            loop {
                tokio::task::yield_now().await;
            }
        }))
    }
}
impl Drop for Clock {
    fn drop(&mut self) {
        self.0.abort();
    }
}

struct StreamFixture {
    commands: mpsc::UnboundedSender<Vec<u8>>,
    frames: mpsc::UnboundedReceiver<Value>,
    token: CancellationToken,
    request: JoinHandle<Result<(), String>>,
    server: JoinHandle<()>,
}
impl StreamFixture {
    async fn new() -> Self {
        Self::with_diagnostic(None).await
    }
    async fn with_diagnostic(diagnostic: Option<crate::diagnostics::Operation>) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/responses", listener.local_addr().unwrap());
        let (commands, mut incoming) = mpsc::unbounded_channel::<Vec<u8>>();
        let (ready, accepted) = oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 8192];
            assert!(socket.read(&mut buffer).await.unwrap() > 0);
            ready.send(()).unwrap();
            while let Some(bytes) = incoming.recv().await {
                if socket.write_all(&bytes).await.is_err() {
                    break;
                }
            }
        });
        let (output, frames) = mpsc::unbounded_channel();
        let channel = Channel::new(move |frame| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = frame {
                let _ = output.send(serde_json::from_str(&json).unwrap());
            }
            Ok(())
        });
        let token = CancellationToken::new();
        let cancel = token.clone();
        let request = tokio::spawn(async move {
            let result = send(
                (
                    tests::connection(),
                    "openai-responses".into(),
                    url,
                    "{}".into(),
                    HashMap::new(),
                ),
                cancel,
                |frame| channel.send(frame).map_err(|_| NETWORK_ERROR.to_owned()),
                diagnostic.as_ref(),
            )
            .await;
            if let Some(diagnostic) = diagnostic {
                diagnostic.result(&result);
            }
            result
        });
        accepted.await.unwrap();
        Self {
            commands,
            frames,
            token,
            request,
            server,
        }
    }
    async fn headers(&mut self, length: Option<usize>) {
        let length = length.map_or(String::new(), |n| format!("Content-Length: {n}\r\n"));
        self.commands.send(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n{length}\r\n").into_bytes()).unwrap();
        assert_eq!(self.frames.recv().await.unwrap()["type"], "headers");
    }
    async fn data(&mut self, data: &[u8]) {
        self.commands.send(data.into()).unwrap();
        let frame = self.frames.recv().await.unwrap();
        assert_eq!(frame["type"], "data");
        assert_eq!(frame["bytes"], serde_json::json!(data));
    }
    async fn close(self) -> Result<(), String> {
        drop(self.commands);
        self.server.await.unwrap();
        self.request.await.unwrap()
    }
}

#[tokio::test]
async fn a_stalled_tls_handshake_uses_the_connection_deadline() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("https://{}/responses", listener.local_addr().unwrap());
    let (ready, accepted) = oneshot::channel();
    let (release, released) = oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = [0; 8192];
        assert!(socket.read(&mut buffer).await.unwrap() > 0);
        ready.send(()).unwrap();
        let _ = released.await;
        drop(socket);
    });
    let request = tokio::spawn(async move {
        send(
            (
                tests::connection(),
                "openai-responses".into(),
                url,
                "{}".into(),
                HashMap::new(),
            ),
            CancellationToken::new(),
            |_| panic!("An incomplete connection must not emit response data"),
            None,
        )
        .await
    });
    accepted.await.unwrap();
    let _clock = Clock::pause();
    tokio::time::advance(Duration::from_secs(11)).await;
    assert_eq!(
        request.await.unwrap().unwrap_err(),
        "native.ai.request.connectTimeout"
    );
    release.send(()).unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn active_streams_outlive_both_the_old_total_deadline_and_the_idle_limit() {
    let mut fixture = StreamFixture::new().await;
    let _clock = Clock::pause();
    fixture.headers(None).await;
    for _ in 0..7 {
        tokio::time::advance(Duration::from_secs(120)).await;
        fixture.data(b": heartbeat\n\n").await;
    }
    fixture.close().await.unwrap();
}

#[tokio::test]
async fn silence_before_headers_has_a_distinct_response_timeout() {
    let fixture = StreamFixture::new().await;
    let _clock = Clock::pause();
    tokio::time::advance(Duration::from_secs(301)).await;
    assert_eq!(
        fixture.close().await.unwrap_err(),
        "native.ai.request.responseTimeout"
    );
}

#[tokio::test]
async fn stream_silence_times_out_since_the_last_received_data() {
    let mut fixture = StreamFixture::new().await;
    let _clock = Clock::pause();
    fixture.headers(None).await;
    tokio::time::advance(Duration::from_secs(240)).await;
    fixture.data(b"data: partial\n\n").await;
    tokio::time::advance(Duration::from_secs(240)).await;
    tokio::task::yield_now().await;
    assert!(!fixture.request.is_finished());
    tokio::time::advance(Duration::from_secs(61)).await;
    assert_eq!(
        fixture.close().await.unwrap_err(),
        "native.ai.response.idleTimeout"
    );
}

#[tokio::test]
async fn broken_streams_are_not_user_cancellation_or_timeouts() {
    let mut fixture = StreamFixture::new().await;
    fixture.headers(Some(1000)).await;
    fixture.data(b"data: partial\n\n").await;
    assert_eq!(
        fixture.close().await.unwrap_err(),
        "native.ai.response.interrupted"
    );
}

#[tokio::test]
async fn model_diagnostics_preserve_failure_phase_and_counts_without_content() {
    use crate::diagnostics::OperationKind;
    use crate::openai_oauth::diagnostic_tests::Capture;
    let capture = Capture::new();
    let diagnostic = capture.operation_kind(OperationKind::Model, None);
    let mut fixture = StreamFixture::with_diagnostic(Some(diagnostic)).await;
    let _clock = Clock::pause();
    fixture.headers(None).await;
    fixture.data(b"PRIVATE_RESPONSE_SENTINEL").await;
    tokio::time::advance(Duration::from_secs(301)).await;
    assert_eq!(
        fixture.close().await.unwrap_err(),
        "native.ai.response.idleTimeout"
    );
    let records = capture.records();
    assert_eq!(records.len(), 4);
    let failed = &records[2]["attributes"];
    assert_eq!(failed["stage"], "response_body");
    assert_eq!(failed["error_code"], "timeout");
    assert_eq!(failed["http_status"], 200);
    assert_eq!(failed["bytes"], 25);
    assert!(failed["idle_ms"].is_number());
    assert_eq!(records[3]["attributes"]["outcome"], "failure");
    assert_eq!(records[3]["attributes"]["error_code"], "timeout");
    let serialized = serde_json::to_string(&records).unwrap();
    assert!(!serialized.contains("PRIVATE_"));
    assert!(!serialized.contains("test-secret"));
    assert!(!serialized.contains("127.0.0.1"));
}

#[tokio::test]
async fn explicit_cancellation_stops_a_stream_without_waiting_for_inactivity() {
    use crate::diagnostics::OperationKind;
    use crate::openai_oauth::diagnostic_tests::Capture;
    let capture = Capture::new();
    let diagnostic = capture.operation_kind(OperationKind::Model, None);
    let mut fixture = StreamFixture::with_diagnostic(Some(diagnostic)).await;
    let _clock = Clock::pause();
    fixture.headers(None).await;
    fixture.token.cancel();
    assert_eq!(
        fixture.close().await.unwrap_err(),
        "native.ai.response.stopped"
    );
    let records = capture.records();
    assert_eq!(
        records.last().unwrap()["attributes"]["outcome"],
        "cancelled"
    );
    assert_eq!(
        records.last().unwrap()["attributes"]["error_code"],
        "cancelled"
    );
    assert_eq!(records.last().unwrap()["level"], "info");
}
