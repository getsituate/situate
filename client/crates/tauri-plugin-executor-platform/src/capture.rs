//! Captures a bounded, rendered WebView region; callers own authorization.

const INVALID: &str = "native.plugins.checkInvalid";
const LIMIT: &str = "native.plugins.checkLimit";
#[cfg(target_os = "macos")]
const UNAVAILABLE: &str = "native.plugins.captureUnavailable";
const MAX_SIDE: f64 = 2048.0;
const MAX_PIXELS: f64 = 4_000_000.0;

/// Coordinates in the WKWebView's local view coordinate system (points, not device pixels).
#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl CaptureRect {
    pub(crate) fn validate(self) -> Result<(), String> {
        if ![self.x, self.y, self.width, self.height]
            .into_iter()
            .all(f64::is_finite)
            || self.x < 0.0
            || self.y < 0.0
            || self.width <= 0.0
            || self.height <= 0.0
        {
            return Err(INVALID.into());
        }
        if self.width > MAX_SIDE
            || self.height > MAX_SIDE
            || self.width.ceil() * self.height.ceil() > MAX_PIXELS
        {
            return Err(LIMIT.into());
        }
        Ok(())
    }

    #[cfg(any(target_os = "macos", test))]
    fn validate_in(self, bounds: Self) -> Result<(), String> {
        self.validate()?;
        if ![bounds.x, bounds.y, bounds.width, bounds.height]
            .into_iter()
            .all(f64::is_finite)
            || bounds.width <= 0.0
            || bounds.height <= 0.0
            || self.x < bounds.x
            || self.y < bounds.y
            || self.width > bounds.width
            || self.height > bounds.height
            || self.x - bounds.x > bounds.width - self.width
            || self.y - bounds.y > bounds.height - self.height
        {
            return Err(INVALID.into());
        }
        Ok(())
    }
}

#[cfg(any(target_os = "macos", test))]
fn complete(
    sender: tokio::sync::oneshot::Sender<Result<String, String>>,
    deadline: tokio::time::Instant,
    closed: impl Fn() -> bool,
    encode: impl FnOnce() -> Result<String, String>,
) {
    if sender.is_closed() || tokio::time::Instant::now() >= deadline {
        return;
    }
    if closed() {
        let _ = sender.send(Err("executor.closed".into()));
        return;
    }
    let result = encode();
    if sender.is_closed() || tokio::time::Instant::now() >= deadline {
        return;
    }
    let _ = sender.send(if closed() {
        Err("executor.closed".into())
    } else {
        result
    });
}

#[cfg(target_os = "macos")]
pub(crate) mod macos {
    use super::*;
    use base64::Engine;
    use block2::RcBlock;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_core_graphics::CGImage;
    use objc2_foundation::{NSDictionary, NSError, NSNumber, NSPoint, NSRect, NSSize};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use std::{cell::RefCell, time::Duration};
    use tokio::sync::oneshot;

    const MAX_PNG_BYTES: usize = 8 * 1024 * 1024;
    const TIMEOUT: Duration = Duration::from_secs(5);

    pub(crate) async fn capture(
        window: &tauri::WebviewWindow,
        rect: CaptureRect,
        session: std::sync::Arc<crate::Session>,
    ) -> Result<String, String> {
        rect.validate()?;
        let (sender, receiver) = oneshot::channel();
        let deadline = tokio::time::Instant::now() + TIMEOUT;
        window
            .with_webview(move |platform| {
                if sender.is_closed() || tokio::time::Instant::now() >= deadline {
                    return;
                }
                if session.lifecycle.lock().unwrap().is_closed() {
                    let _ = sender.send(Err("executor.closed".into()));
                    return;
                }
                let Some(mtm) = MainThreadMarker::new() else {
                    let _ = sender.send(Err(UNAVAILABLE.into()));
                    return;
                };
                // Tauri lends the WKWebView only on its UI thread. No native pointer leaves it.
                let Some(view) = (unsafe { platform.inner().cast::<WKWebView>().as_ref() }) else {
                    let _ = sender.send(Err(UNAVAILABLE.into()));
                    return;
                };
                let bounds = view.bounds();
                if let Err(error) = rect.validate_in(CaptureRect {
                    x: bounds.origin.x,
                    y: bounds.origin.y,
                    width: bounds.size.width,
                    height: bounds.size.height,
                }) {
                    let _ = sender.send(Err(error));
                    return;
                }
                let Some(native_window) = view.window() else {
                    let _ = sender.send(Err(UNAVAILABLE.into()));
                    return;
                };
                let scale = native_window.backingScaleFactor();
                if !scale.is_finite() || scale <= 0.0 {
                    let _ = sender.send(Err(UNAVAILABLE.into()));
                    return;
                }
                let sender = RefCell::new(Some(sender));
                let completion = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                    let Some(sender) = sender.borrow_mut().take() else {
                        return;
                    };
                    complete(
                        sender,
                        deadline,
                        || session.lifecycle.lock().unwrap().is_closed(),
                        || {
                            if MainThreadMarker::new().is_none() || !error.is_null() {
                                Err(UNAVAILABLE.into())
                            } else {
                                // WebKit owns both callback arguments for this invocation; neither is retained.
                                unsafe { image.as_ref() }
                                    .ok_or_else(|| UNAVAILABLE.to_string())
                                    .and_then(encode_png)
                            }
                        },
                    );
                });
                // WebKit copies the escaping block, releasing its captured sender when finished.
                // Normalize backing pixels to one per view point, then verify the returned bitmap.
                unsafe {
                    let configuration = WKSnapshotConfiguration::new(mtm);
                    configuration.setRect(NSRect::new(
                        NSPoint::new(rect.x, rect.y),
                        NSSize::new(rect.width, rect.height),
                    ));
                    configuration.setSnapshotWidth(Some(&NSNumber::new_f64(rect.width / scale)));
                    view.takeSnapshotWithConfiguration_completionHandler(
                        Some(&configuration),
                        &completion,
                    );
                }
            })
            .map_err(|_| UNAVAILABLE.to_string())?;
        let result = tokio::time::timeout_at(deadline, receiver)
            .await
            .map_err(|_| UNAVAILABLE.to_string())?
            .map_err(|_| UNAVAILABLE.to_string())?;
        if tokio::time::Instant::now() >= deadline {
            return Err(UNAVAILABLE.into());
        }
        result
    }

    fn encode_png(image: &NSImage) -> Result<String, String> {
        // A null proposed rect requests the snapshot image itself, never another view or screen.
        let cg_image =
            unsafe { image.CGImageForProposedRect_context_hints(std::ptr::null_mut(), None, None) }
                .ok_or_else(|| UNAVAILABLE.to_string())?;
        let width = CGImage::width(Some(&cg_image));
        let height = CGImage::height(Some(&cg_image));
        CaptureRect {
            x: 0.0,
            y: 0.0,
            width: width as f64,
            height: height as f64,
        }
        .validate()?;
        let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg_image);
        // An empty dictionary supplies no untyped encoding options.
        let png = unsafe {
            bitmap.representationUsingType_properties(
                NSBitmapImageFileType::PNG,
                &NSDictionary::new(),
            )
        }
        .ok_or_else(|| UNAVAILABLE.to_string())?;
        if png.len() > MAX_PNG_BYTES {
            return Err(LIMIT.into());
        }
        if png.is_empty() {
            return Err(UNAVAILABLE.into());
        }
        Ok(base64::engine::general_purpose::STANDARD.encode(png.to_vec()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropped_capture_receiver_fences_native_completion() {
        let (sender, receiver) = tokio::sync::oneshot::channel::<Result<String, String>>();
        drop(receiver);
        complete(
            sender,
            tokio::time::Instant::now() + std::time::Duration::from_secs(5),
            || false,
            || panic!("cancelled capture encoded"),
        );
    }

    #[test]
    fn close_fences_outstanding_callback_without_the_caller_future() {
        let closed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let native_closed = closed.clone();
        let (sender, mut receiver) = tokio::sync::oneshot::channel::<Result<String, String>>();
        let callback = move || {
            complete(
                sender,
                tokio::time::Instant::now() + std::time::Duration::from_secs(5),
                || native_closed.load(std::sync::atomic::Ordering::Acquire),
                || panic!("closed capture encoded"),
            )
        };
        closed.store(true, std::sync::atomic::Ordering::Release);
        callback();
        assert_eq!(receiver.try_recv().unwrap(), Err("executor.closed".into()));
    }

    #[test]
    fn close_during_encoding_and_late_callbacks_cannot_publish_png() {
        let closed = std::cell::Cell::new(false);
        let (sender, mut receiver) = tokio::sync::oneshot::channel();
        complete(
            sender,
            tokio::time::Instant::now() + std::time::Duration::from_secs(5),
            || closed.get(),
            || {
                closed.set(true);
                Ok("png".into())
            },
        );
        assert_eq!(receiver.try_recv().unwrap(), Err("executor.closed".into()));

        let (sender, mut receiver) = tokio::sync::oneshot::channel::<Result<String, String>>();
        complete(
            sender,
            tokio::time::Instant::now() - std::time::Duration::from_secs(1),
            || false,
            || panic!("late capture encoded"),
        );
        assert_eq!(
            receiver.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Closed)
        );
    }

    fn bounds() -> CaptureRect {
        CaptureRect {
            x: 0.0,
            y: 0.0,
            width: 1000.0,
            height: 800.0,
        }
    }

    #[test]
    fn accepts_contained_fractional_rect_and_exact_edges() {
        assert_eq!(bounds().validate_in(bounds()), Ok(()));
        assert_eq!(
            CaptureRect {
                x: 10.25,
                y: 20.5,
                width: 989.75,
                height: 779.5
            }
            .validate_in(bounds()),
            Ok(())
        );
    }

    #[test]
    fn rejects_nonfinite_negative_and_empty_geometry() {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0] {
            for rect in [
                CaptureRect {
                    x: value,
                    ..bounds()
                },
                CaptureRect {
                    y: value,
                    ..bounds()
                },
                CaptureRect {
                    width: value,
                    ..bounds()
                },
                CaptureRect {
                    height: value,
                    ..bounds()
                },
            ] {
                assert_eq!(rect.validate(), Err(INVALID.into()));
            }
        }
        assert_eq!(
            CaptureRect {
                width: 0.0,
                ..bounds()
            }
            .validate(),
            Err(INVALID.into())
        );
        assert_eq!(
            CaptureRect {
                height: 0.0,
                ..bounds()
            }
            .validate(),
            Err(INVALID.into())
        );
    }

    #[test]
    fn rejects_any_overhang_without_clipping() {
        for rect in [
            CaptureRect {
                x: 0.01,
                ..bounds()
            },
            CaptureRect {
                y: 0.01,
                ..bounds()
            },
            CaptureRect {
                width: 1000.01,
                ..bounds()
            },
            CaptureRect {
                height: 800.01,
                ..bounds()
            },
            CaptureRect {
                x: f64::MAX,
                width: 1.0,
                ..bounds()
            },
        ] {
            assert_eq!(rect.validate_in(bounds()), Err(INVALID.into()));
        }
        assert_eq!(
            bounds().validate_in(CaptureRect { x: 1.0, ..bounds() }),
            Err(INVALID.into())
        );
        assert_eq!(
            bounds().validate_in(CaptureRect {
                width: f64::INFINITY,
                ..bounds()
            }),
            Err(INVALID.into())
        );
    }

    #[test]
    fn bounds_dimensions_and_rounded_pixel_area() {
        assert_eq!(
            CaptureRect {
                width: 2048.0,
                height: 1.0,
                ..bounds()
            }
            .validate(),
            Ok(())
        );
        assert_eq!(
            CaptureRect {
                width: 2048.01,
                ..bounds()
            }
            .validate(),
            Err(LIMIT.into())
        );
        assert_eq!(
            CaptureRect {
                width: 2000.0,
                height: 2000.0,
                ..bounds()
            }
            .validate(),
            Ok(())
        );
        assert_eq!(
            CaptureRect {
                width: 2000.01,
                height: 2000.0,
                ..bounds()
            }
            .validate(),
            Err(LIMIT.into())
        );
        assert_eq!(
            CaptureRect {
                width: 2048.0,
                height: 2048.0,
                ..bounds()
            }
            .validate(),
            Err(LIMIT.into())
        );
    }
}
