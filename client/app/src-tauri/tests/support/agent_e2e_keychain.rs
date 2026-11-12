use super::{ERROR, bootstrap_step, environment, keychain_failure, write_private};
use rand::RngCore;
use security_framework::os::macos::keychain::{
    CreateOptions, KeychainUserInteractionLock, SecKeychain,
};
use std::{
    collections::BTreeSet,
    fs,
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

static KEYCHAIN: Mutex<Option<SecKeychain>> = Mutex::new(None);
static NO_DIALOGS: OnceLock<KeychainUserInteractionLock> = OnceLock::new();
const FILE: &str = "agent-e2e.keychain";
const PASSWORD: &str = "agent-e2e-keychain-password";

fn os_error(operation: &'static str, error: security_framework::base::Error) -> String {
    keychain_failure(operation, error.code());
    "native.ai.access.keyStorage".into()
}
fn owned_regular_file(path: &Path) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.nlink() == 1 =>
        {
            Ok(Some(metadata))
        }
        Ok(_) => Err(ERROR.into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(ERROR.into()),
    }
}
fn private_file(path: &Path) -> Result<bool, String> {
    match owned_regular_file(path)? {
        Some(metadata) if metadata.permissions().mode() & 0o077 == 0 => Ok(true),
        Some(_) => Err(ERROR.into()),
        None => Ok(false),
    }
}
fn protect_created_file(path: &Path) -> Result<(), String> {
    let parent = fs::symlink_metadata(path.parent().ok_or(ERROR)?).map_err(|_| ERROR)?;
    if !parent.is_dir()
        || parent.file_type().is_symlink()
        || parent.permissions().mode() & 0o077 != 0
    {
        return Err(ERROR.into());
    }
    if owned_regular_file(path)?.is_none() {
        return Ok(());
    }
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| ERROR)?;
    let metadata = file.metadata().map_err(|_| ERROR)?;
    if !metadata.is_file() || metadata.nlink() != 1 {
        return Err(ERROR.into());
    }
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|_| ERROR)?;
    if file.metadata().map_err(|_| ERROR)?.permissions().mode() & 0o077 != 0 {
        return Err(ERROR.into());
    }
    Ok(())
}
fn remove_owned_files(paths: &[PathBuf]) -> Result<(), String> {
    for path in paths {
        owned_regular_file(path)?;
    }
    for path in paths {
        if owned_regular_file(path)?.is_some() {
            fs::remove_file(path).map_err(|_| ERROR)?;
        }
    }
    Ok(())
}
fn paths(root: &Path) -> Result<[PathBuf; 3], String> {
    let root = root.canonicalize().map_err(|_| ERROR)?;
    // Security's shouldAddToSearchList exempts private keychains, but not paths
    // containing /login.keychain. Never use those names for an isolated store.
    // https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/OSX/libsecurity_keychain/lib/StorageManager.cpp#L119-L135
    if root.to_string_lossy().contains("/login.keychain") {
        return Err(ERROR.into());
    }
    Ok([
        root.join(FILE),
        root.join(format!("{FILE}-db")),
        root.join(PASSWORD),
    ])
}
pub(crate) fn prepare(first: bool) -> Result<(), String> {
    let mut held = KEYCHAIN.lock().map_err(|_| ERROR)?;
    if held.is_some() {
        return Ok(());
    }
    let env = environment()?;
    let [path, database, password_path] = paths(&env.config.workspace_root)?;
    bootstrap_step("bootstrap-keychain-permissions");
    let path_exists = private_file(&path)?;
    let database_exists = private_file(&database)?;
    let existing = path_exists || database_exists;
    let has_password = private_file(&password_path)?;
    if first && (existing || has_password) || !first && (!existing || !has_password) {
        return Err(ERROR.into());
    }
    if NO_DIALOGS.get().is_none() {
        let guard = SecKeychain::disable_user_interaction().map_err(|e| os_error("save", e))?;
        NO_DIALOGS.set(guard).map_err(|_| ERROR)?;
    }
    bootstrap_step("bootstrap-keychain-password");
    let password = if first {
        let mut random = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut random);
        let password: String = random.iter().map(|b| format!("{b:02x}")).collect();
        write_private(&password_path, password.as_bytes())?;
        password
    } else {
        let bytes = fs::read(&password_path).map_err(|_| ERROR)?;
        if bytes.len() != 64 || !bytes.iter().all(u8::is_ascii_hexdigit) {
            return Err(ERROR.into());
        }
        String::from_utf8(bytes).map_err(|_| ERROR)?
    };
    let mut keychain = if first {
        bootstrap_step("bootstrap-keychain-create");
        CreateOptions::new()
            .password(&password)
            .prompt_user(false)
            .create(&path)
            .map_err(|e| os_error("save", e))?
    } else {
        bootstrap_step("bootstrap-keychain-open");
        SecKeychain::open(&path).map_err(|e| os_error("read", e))?
    };
    if first {
        bootstrap_step("bootstrap-keychain-permissions");
        protect_created_file(&path)?;
        protect_created_file(&database)?;
    }
    bootstrap_step("bootstrap-keychain-unlock");
    keychain
        .unlock(Some(&password))
        .map_err(|e| os_error("read", e))?;
    bootstrap_step("bootstrap-keychain-permissions");
    private_file(&path)?;
    private_file(&database)?;
    *held = Some(keychain);
    Ok(())
}
pub(crate) fn get(account: &str) -> Result<Vec<u8>, String> {
    let held = KEYCHAIN.lock().map_err(|_| ERROR)?;
    let keychain = held.as_ref().ok_or(ERROR)?;
    let (password, _) = keychain
        .find_generic_password(&environment()?.service, account)
        .map_err(|e| os_error("read", e))?;
    Ok(password.to_vec())
}
pub(crate) fn set(account: &str, key: &[u8]) -> Result<(), String> {
    let mut held = KEYCHAIN.lock().map_err(|_| ERROR)?;
    held.as_mut()
        .ok_or(ERROR)?
        .set_generic_password(&environment()?.service, account, key)
        .map_err(|e| os_error("save", e))?;
    Ok(())
}
fn delete_from(keychain: &SecKeychain, account: &str) -> Result<(), String> {
    let service = &environment()?.service;
    match keychain.find_generic_password(service, account) {
        Ok((_, item)) => {
            item.delete();
            match keychain.find_generic_password(service, account) {
                Err(error) if error.code() == -25300 => Ok(()),
                _ => Err("Agent E2E credential cleanup failed".into()),
            }
        }
        Err(error) if error.code() == -25300 => Ok(()),
        Err(error) => Err(os_error("read", error)),
    }
}
pub(crate) fn delete(account: &str) -> Result<(), String> {
    let held = KEYCHAIN.lock().map_err(|_| ERROR)?;
    delete_from(held.as_ref().ok_or(ERROR)?, account)
}
pub(crate) fn cleanup(accounts: &BTreeSet<String>) -> Result<(), String> {
    let [path, database, password] = paths(&environment()?.config.workspace_root)?;
    let path_exists = owned_regular_file(&path)?.is_some();
    let database_exists = owned_regular_file(&database)?.is_some();
    let exists = path_exists || database_exists;
    if exists && !accounts.is_empty() {
        prepare(false)?;
        let mut held = KEYCHAIN.lock().map_err(|_| ERROR)?;
        for account in accounts {
            delete_from(held.as_ref().ok_or(ERROR)?, account)?;
        }
        held.take();
    } else {
        KEYCHAIN.lock().map_err(|_| ERROR)?.take();
    }
    remove_owned_files(&[path, database, password])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_keychain_paths_never_match_system_or_login_names() {
        let root = tempfile::tempdir().unwrap();
        let result = paths(root.path()).unwrap();
        assert_eq!(result[0].file_name().unwrap(), "agent-e2e.keychain");
        let login = root.path().join("login.keychain-other");
        fs::create_dir(&login).unwrap();
        assert!(paths(&login).is_err());
    }
    #[test]
    fn creation_hardens_os_permissions_but_reopen_does_not() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let file = root.path().join(FILE);
        fs::write(&file, b"synthetic").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(private_file(&file).is_err());
        protect_created_file(&file).unwrap();
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(private_file(&file).unwrap());
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(private_file(&file).is_err());
        remove_owned_files(std::slice::from_ref(&file)).unwrap();
        assert!(!file.exists());
    }
    #[test]
    fn hardening_and_cleanup_refuse_linked_files() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let file = root.path().join("target");
        fs::write(&file, b"unchanged").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        let link = root.path().join(FILE);
        std::os::unix::fs::symlink(&file, &link).unwrap();
        assert!(protect_created_file(&link).is_err());
        assert!(remove_owned_files(std::slice::from_ref(&link)).is_err());
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o644
        );
        fs::remove_file(&link).unwrap();
        fs::hard_link(&file, &link).unwrap();
        assert!(protect_created_file(&link).is_err());
        assert!(remove_owned_files(std::slice::from_ref(&link)).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"unchanged");
    }
    #[test]
    fn keychain_files_require_private_regular_single_link_storage() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("file");
        write_private(&file, b"synthetic").unwrap();
        assert!(private_file(&file).unwrap());
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(private_file(&file).is_err());
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        let hardlink = root.path().join("hardlink");
        fs::hard_link(&file, &hardlink).unwrap();
        assert!(private_file(&file).is_err());
        let dangling = root.path().join("dangling");
        std::os::unix::fs::symlink(root.path().join("missing"), &dangling).unwrap();
        assert!(private_file(&dangling).is_err());
    }
}
