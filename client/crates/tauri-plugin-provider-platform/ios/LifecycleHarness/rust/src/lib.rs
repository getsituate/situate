use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::atomic::{AtomicU32, Ordering},
    time::Duration,
};
static CALLBACKS: AtomicU32 = AtomicU32::new(0);
static STARTS: AtomicU32 = AtomicU32::new(0);
#[unsafe(no_mangle)]
pub extern "C" fn synthetic_callback_count() -> u32 {
    CALLBACKS.load(Ordering::SeqCst)
}
#[unsafe(no_mangle)]
pub extern "C" fn synthetic_start_count() -> u32 {
    STARTS.load(Ordering::SeqCst)
}
#[unsafe(no_mangle)]
pub extern "C" fn synthetic_start_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);
            let body = if request.starts_with("GET /callback?state=synthetic HTTP/") {
                CALLBACKS.fetch_add(1, Ordering::SeqCst);
                "<html><body>Loopback complete</body></html>".to_owned()
            } else if request.starts_with("GET /start HTTP/") {
                STARTS.fetch_add(1, Ordering::SeqCst);
                format!(
                    "<html><head><meta http-equiv=\"refresh\" content=\"40;url=http://127.0.0.1:{port}/callback?state=synthetic\"></head><body><h1>Synthetic delayed sign-in</h1><p>The native loopback listener will receive a synthetic callback after forty seconds.</p></body></html>"
                )
            } else {
                "<html><body>Not found</body></html>".to_owned()
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    port
}
