use futures_util::{Stream, StreamExt};
use serde_json::Value;

const LIMIT: usize = 1024 * 1024;
pub(super) enum Error {
    Request(reqwest::Error),
    Invalid,
}

pub(super) async fn fetch(client: reqwest::Client, url: url::Url) -> Result<Option<Value>, Error> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(Error::Request)?;
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(None);
    }
    response.error_for_status_ref().map_err(Error::Request)?;
    if !response.status().is_success() {
        return Err(Error::Invalid);
    }
    let length = response.content_length();
    let stream = response
        .bytes_stream()
        .map(|result| result.map(|bytes| bytes.to_vec()).map_err(Error::Request));
    read(stream, length).await.map(Some)
}

async fn read(
    mut stream: impl Stream<Item = Result<Vec<u8>, Error>> + Unpin,
    length: Option<u64>,
) -> Result<Value, Error> {
    if length.is_some_and(|length| length > LIMIT as u64) {
        return Err(Error::Invalid);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if chunk.len() > LIMIT.saturating_sub(bytes.len()) {
            return Err(Error::Invalid);
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| Error::Invalid)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn feed_reader_handles_no_content_and_rejects_a_streamed_oversized_response() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for (status, body, accepted) in [
            ("204 No Content", Vec::new(), true),
            ("503 Service Unavailable", b"{}".to_vec(), false),
            ("200 OK", vec![b' '; LIMIT + 1], false),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/feed", listener.local_addr().unwrap())
                .parse()
                .unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 4096];
                let _ = socket.read(&mut request).await;
                socket
                    .write_all(format!("HTTP/1.1 {status}\r\nConnection: close\r\n\r\n").as_bytes())
                    .await
                    .unwrap();
                let _ = socket.write_all(&body).await;
            });
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            let result = fetch(client, url).await;
            assert_eq!(result.is_ok(), accepted);
            if accepted {
                assert!(result.ok().unwrap().is_none());
            } else if status.starts_with("503") {
                assert!(
                    matches!(result, Err(Error::Request(error)) if error.status() == Some(reqwest::StatusCode::SERVICE_UNAVAILABLE))
                );
            } else {
                assert!(matches!(result, Err(Error::Invalid)));
            }
            server.await.unwrap();
        }
    }
    #[tokio::test]
    async fn feed_limit_counts_streamed_bytes_even_without_or_with_a_false_length() {
        for length in [None, Some(1), Some(LIMIT as u64)] {
            let chunks = futures_util::stream::iter([Ok(vec![b' '; LIMIT]), Ok(vec![b' '; 1])]);
            assert!(read(chunks, length).await.is_err());
        }
        let chunks =
            futures_util::stream::poll_fn(|_| -> std::task::Poll<Option<Result<Vec<u8>, Error>>> {
                panic!("An oversized length must be rejected before reading")
            });
        assert!(read(chunks, Some(LIMIT as u64 + 1)).await.is_err());
    }
    #[tokio::test]
    async fn feed_limit_accepts_exact_boundary_and_rejects_invalid_json() {
        let mut bytes = br#"{"version":"2.0.0"}"#.to_vec();
        bytes.resize(LIMIT, b' ');
        let stream = futures_util::stream::iter([Ok(bytes)]);
        assert_eq!(read(stream, None).await.ok().unwrap()["version"], "2.0.0");
        let stream = futures_util::stream::iter([Ok(b"invalid".to_vec())]);
        assert!(read(stream, None).await.is_err());
    }
}
