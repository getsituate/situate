use reqwest::{Client, StatusCode, Url, header, redirect};
use sha2::{Digest, Sha256};
use std::{
    io,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tokio::io::AsyncWriteExt;
use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation};

const SOURCE: &str = "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/ed5d745623472f97cfc2e6c2916ee248798fc5a8";
const FILES: [ModelFile; 4] = [
    ModelFile(
        "encoder.int8.onnx",
        652282294,
        "1afbe69c1ffdabee94755f42e4daf1d93549131a3da11356bda84fcef0f2c479",
    ),
    ModelFile(
        "decoder.int8.onnx",
        11845274,
        "0222a86147299d4dee90edf95b6d13827edb42ad8b7c9cf0b2582f030937c0b5",
    ),
    ModelFile(
        "joiner.int8.onnx",
        6355277,
        "cbd02f3696e9944970111fb439d9c3fd365a80374565f13f2b9c7007d253fc98",
    ),
    ModelFile(
        "tokens.txt",
        93939,
        "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
    ),
];

#[derive(Clone, Copy)]
struct ModelFile(&'static str, u64, &'static str);

#[derive(Debug, PartialEq, Eq)]
pub enum ProvisionError {
    Waiting,
    Storage,
    Failed,
}

impl From<io::Error> for ProvisionError {
    fn from(error: io::Error) -> Self {
        if error.kind() == io::ErrorKind::StorageFull {
            Self::Storage
        } else {
            Self::Failed
        }
    }
}

pub(super) fn verified(path: &Path, bytes: u64, digest: &str) -> bool {
    let Ok(meta) = path.symlink_metadata() else {
        return false;
    };
    if !meta.is_file() || meta.len() != bytes {
        return false;
    }
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut hash = Sha256::new();
    io::copy(&mut file, &mut hash).is_ok() && format!("{:x}", hash.finalize()) == digest
}

pub fn ready(directory: &Path) -> bool {
    FILES
        .iter()
        .all(|file| verified(&directory.join(file.0), file.1, file.2))
}

fn eligible() -> bool {
    // Windows reports the active Internet profile, not whether that path is metered.
    // Unknown adapters are not eligible for an automatic model download.
    fn profile() -> windows::core::Result<bool> {
        let _com = super::Apartment::initialize()
            .map_err(|_| windows::core::Error::from_hresult(windows::Win32::Foundation::E_FAIL))?;
        let connection = NetworkInformation::GetInternetConnectionProfile()?;
        Ok(
            connection.GetNetworkConnectivityLevel()? == NetworkConnectivityLevel::InternetAccess
                && !connection.IsWwanConnectionProfile()?
                && (connection.IsWlanConnectionProfile()?
                    || connection.NetworkAdapter()?.IanaInterfaceType()? == 6),
        )
    }
    profile().unwrap_or(false)
}

async fn network_available(mobile: &AtomicBool) -> bool {
    mobile.load(Ordering::Relaxed) || tokio::task::spawn_blocking(eligible).await.unwrap_or(false)
}

async fn verify_path(path: &Path, file: ModelFile) -> bool {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || verified(&path, file.1, file.2))
        .await
        .unwrap_or(false)
}

fn allowed_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url
            .host_str()
            .is_some_and(|host| host == "huggingface.co" || host.ends_with(".hf.co"))
}

fn partial_response(headers: &header::HeaderMap, received: u64, total: u64) -> bool {
    headers
        .get(header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|range| range == format!("bytes {received}-{}/{total}", total - 1))
}

async fn fetch(
    client: &Client,
    directory: &Path,
    spec: ModelFile,
    mobile: &AtomicBool,
    progress: &mut impl FnMut(u64),
) -> Result<(), ProvisionError> {
    let ModelFile(name, total, _) = spec;
    let destination = directory.join(name);
    if verify_path(&destination, spec).await {
        progress(total);
        return Ok(());
    }
    let partial = directory.join(format!("{name}.part"));
    let mut received = match tokio::fs::symlink_metadata(&partial).await {
        Ok(meta) if meta.is_file() && meta.len() <= total => meta.len(),
        Ok(meta) if meta.is_file() => {
            tokio::fs::remove_file(&partial).await?;
            0
        }
        Ok(_) => return Err(ProvisionError::Failed),
        Err(error) if error.kind() == io::ErrorKind::NotFound => 0,
        Err(error) => return Err(error.into()),
    };
    if received < total {
        if !network_available(mobile).await {
            return Err(ProvisionError::Waiting);
        }
        let mut request = client
            .get(format!("{SOURCE}/{name}"))
            .header(header::ACCEPT_ENCODING, "identity");
        if received != 0 {
            request = request.header(header::RANGE, format!("bytes={received}-"));
        }
        let mut response = request.send().await.map_err(|_| ProvisionError::Failed)?;
        match response.status() {
            StatusCode::OK => received = 0,
            StatusCode::PARTIAL_CONTENT
                if received > 0 && partial_response(response.headers(), received, total) => {}
            _ => return Err(ProvisionError::Failed),
        }
        if response
            .headers()
            .get(header::CONTENT_ENCODING)
            .is_some_and(|encoding| encoding != "identity")
            || response
                .content_length()
                .is_some_and(|length| length != total - received)
        {
            return Err(ProvisionError::Failed);
        }
        let mut output = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(received > 0)
            .truncate(received == 0)
            .open(&partial)
            .await?;
        let mut checked = std::time::Instant::now();
        progress(received);
        while let Some(chunk) = response.chunk().await.map_err(|_| ProvisionError::Failed)? {
            if checked.elapsed() >= Duration::from_secs(1) {
                if !network_available(mobile).await {
                    return Err(ProvisionError::Waiting);
                }
                checked = std::time::Instant::now();
            }
            if chunk.len() as u64 > total - received {
                return Err(ProvisionError::Failed);
            }
            output.write_all(&chunk).await?;
            received += chunk.len() as u64;
            progress(received);
        }
        output.sync_all().await?;
        if received != total {
            return Err(ProvisionError::Failed);
        }
    }
    if !verify_path(&partial, spec).await {
        tokio::fs::remove_file(&partial).await?;
        return Err(ProvisionError::Failed);
    }
    tokio::fs::rename(&partial, destination).await?;
    progress(total);
    Ok(())
}

/// Serializes provisioning across application instances. Verified files can be reused offline.
pub async fn provision(
    directory: &Path,
    mobile: &AtomicBool,
    mut progress: impl FnMut(u8),
) -> Result<(), ProvisionError> {
    tokio::fs::create_dir_all(directory).await?;
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join("provision.lock"))?;
    lock.try_lock().map_err(|_| ProvisionError::Waiting)?;
    let client = Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 8 && allowed_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("invalid model download redirect")
            }
        }))
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| ProvisionError::Failed)?;
    let total: u64 = FILES.iter().map(|file| file.1).sum();
    let mut complete = 0;
    for file in FILES {
        fetch(&client, directory, file, mobile, &mut |n| {
            progress(((complete + n) * 100 / total) as u8)
        })
        .await?;
        complete += file.1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_requires_exact_remaining_bytes() {
        let mut headers = header::HeaderMap::new();
        headers.insert(header::CONTENT_RANGE, "bytes 5-9/10".parse().unwrap());
        assert!(partial_response(&headers, 5, 10));
        assert!(!partial_response(&headers, 4, 10));
        assert!(!partial_response(&headers, 5, 11));
    }

    #[test]
    fn only_verified_regular_model_files_are_ready() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tokens.txt");
        let digest = format!("{:x}", Sha256::digest(b"correct"));
        std::fs::write(&path, b"correct").unwrap();
        assert!(verified(&path, 7, &digest));
        assert!(!ready(dir.path()));
        std::fs::write(&path, b"corrupt").unwrap();
        assert!(!verified(&path, 7, &digest));
    }
}
