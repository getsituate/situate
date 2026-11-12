#[path = "../../../../src/android_finish.rs"]
mod android_finish;

use std::{
    ffi::c_void,
    fs::OpenOptions,
    io::{Read, Write},
    net::TcpListener,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

static CALLBACKS: AtomicU32 = AtomicU32::new(0);
static ACTIVE: Mutex<Option<(Arc<AtomicBool>, JoinHandle<()>)>> = Mutex::new(None);
const EVENTS: &str = "/data/data/dev.situate.tests.providerplatform/files/rust-events.jsonl";

fn event(kind: &str, elapsed_ms: u128) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(EVENTS)
        .unwrap();
    writeln!(
        file,
        "{{\"kind\":\"{kind}\",\"timeMs\":{now},\"elapsedMs\":{elapsed_ms}}}"
    )
    .unwrap();
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_situate_providers_harness_NativeLoopback_start(
    _: *mut c_void,
    _: *mut c_void,
) -> i32 {
    let mut active = ACTIVE.lock().unwrap();
    if active.is_some() {
        return 0;
    }
    CALLBACKS.store(0, Ordering::SeqCst);
    let Ok(listener) = TcpListener::bind("127.0.0.1:0") else {
        return 0;
    };
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let stopping = stop.clone();
    let thread = std::thread::spawn(move || {
        let start = Instant::now();
        let mut heartbeat = Instant::now();
        event("listening", 0);
        while !stopping.load(Ordering::SeqCst) {
            if heartbeat.elapsed() >= Duration::from_secs(1) {
                event("heartbeat", start.elapsed().as_millis());
                heartbeat = Instant::now();
            }
            let (mut stream, _) = match listener.accept() {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(30));
                    continue;
                }
                Err(_) => break,
            };
            stream
                .set_read_timeout(Some(Duration::from_millis(500)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_millis(500)))
                .unwrap();
            let mut buf = [0; 4096];
            let n = stream.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);
            let shell_callback = request.starts_with("GET /shell-callback?state=synthetic HTTP/");
            let body = if shell_callback
                || request.starts_with("GET /callback?state=synthetic HTTP/")
            {
                CALLBACKS.fetch_add(1, Ordering::SeqCst);
                event(
                    if shell_callback {
                        "shell_callback"
                    } else {
                        "callback"
                    },
                    start.elapsed().as_millis(),
                );
                "<h1>Loopback complete</h1>".to_string()
            } else if request.starts_with("GET /start HTTP/") {
                event("page", start.elapsed().as_millis());
                format!(
                    "<html><head><meta http-equiv=\"refresh\" content=\"40;url=http://127.0.0.1:{port}/callback?state=synthetic\"></head><body><h1>Synthetic delayed sign-in</h1><p>Redirect after forty seconds.</p></body></html>"
                )
            } else {
                "<h1>Not found</h1>".into()
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        }
        event("stopped", start.elapsed().as_millis());
    });
    *active = Some((stop, thread));
    i32::from(port)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_situate_providers_harness_NativeLoopback_stop(
    _: *mut c_void,
    _: *mut c_void,
) {
    if let Some((stop, thread)) = ACTIVE.lock().unwrap().take() {
        stop.store(true, Ordering::SeqCst);
        let _ = thread.join();
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_situate_providers_harness_NativeLoopback_finishAuth(
    mut env: jni::JNIEnv<'_>,
    _: jni::objects::JObject<'_>,
    id: jni::objects::JString<'_>,
) -> jni::sys::jboolean {
    let id: String = match env.get_string(&id) {
        Ok(value) => value.into(),
        Err(_) => {
            let _ = env.exception_clear();
            return jni::sys::JNI_FALSE;
        }
    };
    if android_finish::finish(&id).is_ok() {
        event("finish_ack", 0);
        jni::sys::JNI_TRUE
    } else {
        jni::sys::JNI_FALSE
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_situate_providers_harness_NativeLoopback_exitRequested(
    _: *mut c_void,
    _: *mut c_void,
) {
    event("native_cancel", 0);
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_dev_situate_providers_harness_NativeLoopback_callbacks(
    _: *mut c_void,
    _: *mut c_void,
) -> i32 {
    CALLBACKS.load(Ordering::SeqCst) as i32
}
