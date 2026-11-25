use std::{
    ptr, thread,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;
use windows::Win32::{
    Foundation::E_ACCESSDENIED,
    Media::Audio::{
        AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY, AUDCLNT_BUFFERFLAGS_SILENT,
        AUDCLNT_E_DEVICE_INVALIDATED, AUDCLNT_E_RESOURCES_INVALIDATED, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
        IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
        WAVE_FORMAT_PCM, WAVEFORMATEX, eCapture, eConsole,
    },
    System::{
        Com::{
            CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
            CoUninitialize,
        },
        RemoteDesktop::{
            WTS_CURRENT_SESSION, WTS_SESSIONSTATE_UNLOCK, WTSActive, WTSFreeMemory, WTSINFOEXW,
            WTSQuerySessionInformationW, WTSSessionInfoEx,
        },
    },
};

mod abi;
pub mod model;
mod recognition;
pub use recognition::{RecognitionError, runtime_available, transcribe};

pub const SAMPLE_RATE: u32 = 16_000;
const MAX_SAMPLES: usize = SAMPLE_RATE as usize * 60 * 15;
const POLL_INTERVAL: Duration = Duration::from_millis(10);
const METER_INTERVAL: Duration = Duration::from_millis(50);
const SESSION_CHECK_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, PartialEq, Eq)]
pub enum CaptureError {
    PermissionDenied,
    Unavailable,
    Interrupted,
    Capacity,
    Discarded,
}

impl From<windows::core::Error> for CaptureError {
    fn from(error: windows::core::Error) -> Self {
        match error.code() {
            E_ACCESSDENIED => Self::PermissionDenied,
            AUDCLNT_E_DEVICE_INVALIDATED | AUDCLNT_E_RESOURCES_INVALIDATED => Self::Interrupted,
            _ => Self::Unavailable,
        }
    }
}

struct Apartment;
impl Apartment {
    fn initialize() -> Result<Self, CaptureError> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn open_default() -> Result<IAudioClient, CaptureError> {
    // Shared-mode WASAPI performs channel and rate conversion before handing us PCM.
    let format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: 1,
        nSamplesPerSec: SAMPLE_RATE,
        nAvgBytesPerSec: SAMPLE_RATE * 2,
        nBlockAlign: 2,
        wBitsPerSample: 16,
        cbSize: 0,
    };
    // COM is initialized on this thread; Initialize copies the format before returning.
    unsafe {
        let devices: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_INPROC_SERVER)?;
        let device = devices.GetDefaultAudioEndpoint(eCapture, eConsole)?;
        let client: IAudioClient = device.Activate(CLSCTX_INPROC_SERVER, None)?;
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            1_000_000,
            0,
            &raw const format,
            None,
        )?;
        Ok(client)
    }
}

fn require_unlocked_session() -> Result<(), CaptureError> {
    let mut buffer = windows::core::PWSTR::null();
    let mut bytes = 0;
    // WTS allocates the result and selects the caller's session, including over Remote Desktop.
    unsafe {
        WTSQuerySessionInformationW(
            None,
            WTS_CURRENT_SESSION,
            WTSSessionInfoEx,
            &mut buffer,
            &mut bytes,
        )
        .map_err(|_| CaptureError::Interrupted)?;
        let unlocked =
            !buffer.is_null() && bytes as usize >= std::mem::size_of::<WTSINFOEXW>() && {
                let info = buffer.0.cast::<WTSINFOEXW>().read_unaligned();
                info.Level == 1 && {
                    let session = info.Data.WTSInfoExLevel1;
                    session.SessionState == WTSActive
                        && session.SessionFlags == WTS_SESSIONSTATE_UNLOCK as i32
                }
            };
        WTSFreeMemory(buffer.0.cast());
        if unlocked {
            Ok(())
        } else {
            Err(CaptureError::Interrupted)
        }
    }
}

struct CaptureSession<'a> {
    stop: &'a CancellationToken,
    discard: &'a CancellationToken,
    checked: Instant,
}

impl<'a> CaptureSession<'a> {
    fn start(
        stop: &'a CancellationToken,
        discard: &'a CancellationToken,
    ) -> Result<Self, CaptureError> {
        require_unlocked_session()?;
        Ok(Self {
            stop,
            discard,
            checked: Instant::now(),
        })
    }

    fn recording(&mut self) -> Result<bool, CaptureError> {
        if self.discard.is_cancelled() {
            return Err(CaptureError::Discarded);
        }
        let stopping = self.stop.is_cancelled();
        if stopping || self.checked.elapsed() >= SESSION_CHECK_INTERVAL {
            require_unlocked_session()?;
            self.checked = Instant::now();
        }
        Ok(!stopping)
    }
}

struct Started(IAudioClient);
impl Drop for Started {
    fn drop(&mut self) {
        let _ = unsafe { self.0.Stop() };
    }
}

struct Packet<'a> {
    client: &'a IAudioCaptureClient,
    data: *mut u8,
    frames: u32,
    flags: u32,
}
impl<'a> Packet<'a> {
    fn next(client: &'a IAudioCaptureClient) -> Result<Option<Self>, CaptureError> {
        if unsafe { client.GetNextPacketSize()? } == 0 {
            return Ok(None);
        }
        let mut packet = Self {
            client,
            data: ptr::null_mut(),
            frames: 0,
            flags: 0,
        };
        // The data stays valid only until release and only on the capture thread.
        unsafe {
            client.GetBuffer(
                &mut packet.data,
                &mut packet.frames,
                &mut packet.flags,
                None,
                None,
            )
        }?;
        Ok(Some(packet))
    }

    fn append(&self, samples: &mut Vec<f32>) -> Result<f32, CaptureError> {
        let frames = self.frames as usize;
        if self.flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
            return append_pcm(samples, frames, None);
        }
        if self.data.is_null() || frames > MAX_SAMPLES {
            return Err(CaptureError::Interrupted);
        }
        // PCM16 frames contain two bytes each. The driver owns the allocation.
        let bytes = unsafe { std::slice::from_raw_parts(self.data, frames * 2) };
        append_pcm(samples, frames, Some(bytes))
    }

    fn release(self) -> Result<(), CaptureError> {
        unsafe { self.client.ReleaseBuffer(self.frames)? };
        Ok(())
    }
}

fn append_pcm(
    samples: &mut Vec<f32>,
    frames: usize,
    pcm: Option<&[u8]>,
) -> Result<f32, CaptureError> {
    if frames > MAX_SAMPLES - samples.len() || samples.try_reserve(frames).is_err() {
        return Err(CaptureError::Capacity);
    }
    let start = samples.len();
    if let Some(bytes) = pcm {
        if bytes.len() != frames * 2 {
            return Err(CaptureError::Interrupted);
        }
        samples.extend(
            bytes
                .chunks_exact(2)
                .map(|p| f32::from(i16::from_le_bytes([p[0], p[1]])) / 32768.0),
        );
    } else {
        samples.resize(start + frames, 0.0);
    }
    Ok(samples[start..]
        .iter()
        .map(|sample| sample.abs())
        .fold(0.0, f32::max))
}

/// Records mono 16 kHz PCM in memory. Call on a dedicated blocking thread.
/// Stop returns samples; discard takes precedence and does not return audio.
pub fn record(
    stop: &CancellationToken,
    discard: &CancellationToken,
    started: impl FnOnce(),
    mut level: impl FnMut(f32),
) -> Result<Vec<f32>, CaptureError> {
    if discard.is_cancelled() {
        return Err(CaptureError::Discarded);
    }
    if stop.is_cancelled() {
        return Ok(Vec::new());
    }
    let _apartment = Apartment::initialize()?;
    let client = open_default()?;
    let capture: IAudioCaptureClient = unsafe { client.GetService()? };
    if discard.is_cancelled() {
        return Err(CaptureError::Discarded);
    }
    if stop.is_cancelled() {
        return Ok(Vec::new());
    }
    let mut session = CaptureSession::start(stop, discard)?;
    unsafe { client.Start()? };
    let running = Started(client);
    started();
    let mut samples = Vec::new();
    let mut last_level = Instant::now();
    let mut peak: f32 = 0.0;
    while session.recording()? {
        let Some(packet) = Packet::next(&capture)? else {
            thread::sleep(POLL_INTERVAL);
            continue;
        };
        // A first packet may be marked discontinuous at startup.
        let interrupted = !samples.is_empty()
            && packet.flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 != 0;
        let appended = if interrupted {
            Err(CaptureError::Interrupted)
        } else {
            packet.append(&mut samples)
        };
        packet.release()?;
        peak = peak.max(appended?);
        if last_level.elapsed() >= METER_INTERVAL {
            level(peak);
            last_level = Instant::now();
            peak = 0.0;
        }
    }
    drop(running);
    if discard.is_cancelled() {
        Err(CaptureError::Discarded)
    } else {
        Ok(samples)
    }
}

#[cfg(feature = "test-support")]
pub fn record_fixture(
    stop: &CancellationToken,
    discard: &CancellationToken,
    bytes: &[u8],
    started: impl FnOnce(),
) -> Result<Vec<f32>, CaptureError> {
    let mut session = CaptureSession::start(stop, discard)?;
    started();
    while session.recording()? {
        thread::sleep(POLL_INTERVAL);
    }
    let mut samples = Vec::new();
    append_pcm(&mut samples, bytes.len() / 2, Some(bytes))?;
    Ok(samples)
}

#[cfg(test)]
mod tests;
