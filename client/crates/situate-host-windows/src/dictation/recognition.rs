use super::{SAMPLE_RATE, abi::*, model::verified};
use std::{
    ffi::{CStr, CString, c_char},
    os::windows::ffi::OsStrExt,
    path::Path,
};
use tokio_util::sync::CancellationToken;
use windows::{
    Win32::{
        Foundation::{FreeLibrary, HMODULE},
        System::LibraryLoader::{
            GetProcAddress, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR, LOAD_LIBRARY_SEARCH_SYSTEM32,
            LoadLibraryExW,
        },
    },
    core::{PCWSTR, s},
};

const DLLS: [(&str, u64, &str); 3] = [
    (
        "sherpa-onnx-c-api.dll",
        4775424,
        "2aaa023729c4d022e8fa93ee7c7215eaaa3ec894af2035a5f735dc65993c70ce",
    ),
    (
        "onnxruntime.dll",
        17799168,
        "7f66f939a881baf4f46a2216496798edf4a1429878b646d12674aa62f27d8a25",
    ),
    (
        "onnxruntime_providers_shared.dll",
        104960,
        "551d0e1fe4c227d8542314ba718d52f4379e0c7bfe729a37c59833a884e27b4d",
    ),
];

pub fn runtime_available(directory: &Path) -> bool {
    directory.is_absolute()
        && DLLS
            .iter()
            .all(|(name, bytes, hash)| verified(&directory.join(name), *bytes, hash))
}

#[derive(Debug, PartialEq, Eq)]
pub enum RecognitionError {
    Unavailable,
    Failed,
    Discarded,
}

struct Library(HMODULE);
impl Drop for Library {
    fn drop(&mut self) {
        let _ = unsafe { FreeLibrary(self.0) };
    }
}

struct Runtime {
    _library: Library,
    create: unsafe extern "C" fn(*const OfflineRecognizerConfig) -> *const OfflineRecognizer,
    destroy: unsafe extern "C" fn(*const OfflineRecognizer),
    stream: unsafe extern "C" fn(*const OfflineRecognizer) -> *const OfflineStream,
    destroy_stream: unsafe extern "C" fn(*const OfflineStream),
    accept: unsafe extern "C" fn(*const OfflineStream, i32, *const f32, i32),
    decode: unsafe extern "C" fn(*const OfflineRecognizer, *const OfflineStream),
    result: unsafe extern "C" fn(*const OfflineStream) -> *const c_char,
    free_result: unsafe extern "C" fn(*const c_char),
}

impl Runtime {
    fn load(directory: &Path) -> Result<Self, RecognitionError> {
        if !runtime_available(directory) {
            return Err(RecognitionError::Unavailable);
        }
        // Use the installed DLL directory and System32, never the workspace or PATH.
        let path: Vec<u16> = directory
            .join(DLLS[0].0)
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let library = Library(
                LoadLibraryExW(
                    PCWSTR(path.as_ptr()),
                    None,
                    LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32,
                )
                .map_err(|_| RecognitionError::Unavailable)?,
            );
            // The DLL digest above pins the C signatures represented by Runtime.
            macro_rules! symbol {
                ($name:literal) => {
                    std::mem::transmute(
                        GetProcAddress(library.0, s!($name))
                            .ok_or(RecognitionError::Unavailable)?,
                    )
                };
            }
            Ok(Self {
                create: symbol!("SherpaOnnxCreateOfflineRecognizer"),
                destroy: symbol!("SherpaOnnxDestroyOfflineRecognizer"),
                stream: symbol!("SherpaOnnxCreateOfflineStream"),
                destroy_stream: symbol!("SherpaOnnxDestroyOfflineStream"),
                accept: symbol!("SherpaOnnxAcceptWaveformOffline"),
                decode: symbol!("SherpaOnnxDecodeOfflineStream"),
                result: symbol!("SherpaOnnxGetOfflineStreamResultAsJson"),
                free_result: symbol!("SherpaOnnxDestroyOfflineStreamResultJson"),
                _library: library,
            })
        }
    }
}

/// Runs on a blocking worker. Only the model paths cross the file interface.
pub fn transcribe(
    runtime: &Path,
    model: &Path,
    audio: &[f32],
    discard: &CancellationToken,
) -> Result<String, RecognitionError> {
    if discard.is_cancelled() {
        return Err(RecognitionError::Discarded);
    }
    if audio.iter().all(|sample| sample.abs() < 0.001) {
        return Ok(String::new());
    }
    let runtime = Runtime::load(runtime)?;
    if !super::model::ready(model) {
        return Err(RecognitionError::Unavailable);
    }
    let file = |name| {
        let path = model.join(name);
        CString::new(path.to_str().ok_or(RecognitionError::Unavailable)?)
            .map_err(|_| RecognitionError::Unavailable)
    };
    let (encoder, decoder, joiner, tokens) = (
        file("encoder.int8.onnx")?,
        file("decoder.int8.onnx")?,
        file("joiner.int8.onnx")?,
        file("tokens.txt")?,
    );
    // These C layouts contain only integers, floats and raw pointers. The native API
    // treats the all-zero unused configuration fields as absent.
    let mut config: OfflineRecognizerConfig = unsafe { std::mem::zeroed() };
    config.feat_config = FeatureConfig {
        sample_rate: SAMPLE_RATE as i32,
        feature_dim: 80,
    };
    config.model_config.transducer = OfflineTransducerModelConfig {
        encoder: encoder.as_ptr(),
        decoder: decoder.as_ptr(),
        joiner: joiner.as_ptr(),
    };
    config.model_config.tokens = tokens.as_ptr();
    config.model_config.provider = c"cpu".as_ptr();
    config.model_config.model_type = c"nemo_transducer".as_ptr();
    config.model_config.num_threads = 4;
    config.decoding_method = c"greedy_search".as_ptr();
    let recognizer = unsafe { (runtime.create)(&config) };
    if recognizer.is_null() {
        return Err(RecognitionError::Failed);
    }
    let result = (|| {
        let mut parts = Vec::new();
        // Bound the offline encoder's working set for long recordings.
        for chunk in audio.chunks(60 * SAMPLE_RATE as usize) {
            if discard.is_cancelled() {
                return Err(RecognitionError::Discarded);
            }
            if chunk.iter().all(|sample| sample.abs() < 0.001) {
                continue;
            }
            let stream = unsafe { (runtime.stream)(recognizer) };
            if stream.is_null() {
                return Err(RecognitionError::Failed);
            }
            let text = unsafe {
                (runtime.accept)(
                    stream,
                    SAMPLE_RATE as i32,
                    chunk.as_ptr(),
                    chunk.len() as i32,
                );
                (runtime.decode)(recognizer, stream);
                let json = (runtime.result)(stream);
                let parsed = if json.is_null() {
                    None
                } else {
                    let value = serde_json::from_slice::<serde_json::Value>(
                        CStr::from_ptr(json).to_bytes(),
                    )
                    .ok();
                    (runtime.free_result)(json);
                    value
                };
                (runtime.destroy_stream)(stream);
                parsed.and_then(|value| value["text"].as_str().map(str::trim).map(str::to_owned))
            }
            .ok_or(RecognitionError::Failed)?;
            if !text.is_empty() {
                parts.push(text);
            }
        }
        if discard.is_cancelled() {
            Err(RecognitionError::Discarded)
        } else {
            Ok(parts.join(" "))
        }
    })();
    unsafe { (runtime.destroy)(recognizer) };
    result
}
