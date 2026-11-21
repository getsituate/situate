use super::*;

#[test]
fn pcm_packets_preserve_signed_audio_and_silent_frame_count() {
    let mut samples = vec![0.25];
    let bytes = [0, 128, 0, 0, 0, 64];
    assert_eq!(append_pcm(&mut samples, 3, Some(&bytes)), Ok(1.0));
    assert_eq!(append_pcm(&mut samples, 2, None), Ok(0.0));
    assert_eq!(samples, [0.25, -1.0, 0.0, 0.5, 0.0, 0.0]);
    let before = samples.clone();
    assert_eq!(
        append_pcm(&mut samples, 1, Some(&[0])),
        Err(CaptureError::Interrupted)
    );
    assert_eq!(
        append_pcm(&mut samples, MAX_SAMPLES, None),
        Err(CaptureError::Capacity)
    );
    assert_eq!(samples, before);
}

#[test]
fn discard_takes_precedence_over_stop_before_start() {
    let stop = CancellationToken::new();
    let discard = CancellationToken::new();
    stop.cancel();
    let forbidden = || panic!("must not open the microphone");
    assert_eq!(record(&stop, &discard, forbidden, |_| {}), Ok(vec![]));
    discard.cancel();
    assert_eq!(
        record(&stop, &discard, forbidden, |_| {}),
        Err(CaptureError::Discarded)
    );
}

#[test]
fn wasapi_access_denial_maps_to_microphone_permission() {
    assert_eq!(
        CaptureError::from(windows::core::Error::from_hresult(E_ACCESSDENIED)),
        CaptureError::PermissionDenied,
    );
}

#[test]
#[ignore = "requires an interactive Windows session with a default capture endpoint"]
fn initializes_shared_input_at_dictation_format_without_recording() {
    let _apartment = Apartment::initialize().unwrap();
    let client = open_default().unwrap();
    let _: IAudioCaptureClient = unsafe { client.GetService() }.unwrap();
}
