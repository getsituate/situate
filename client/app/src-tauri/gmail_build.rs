use std::{env, fs, io::Write, path::PathBuf, process::Command};

const ID: &str = "SITUATE_GMAIL_TEST_CLIENT_ID";
const SECRET: &str = "SITUATE_GMAIL_TEST_CLIENT_SECRET";
const INPUT: &str = "SITUATE_GMAIL_BUILD_INPUT";

pub fn write_config() {
    for key in ["CI", ID, SECRET, INPUT] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    let pair = if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let [id, secret] = build_inputs();
        if id.is_empty() && secret.is_empty() {
            None
        } else {
            assert!(
                id.strip_suffix(".apps.googleusercontent.com")
                    .is_some_and(valid)
                    && id.len() <= 256
                    && valid(&secret),
                "Set both SITUATE_GMAIL_TEST_CLIENT_ID and SITUATE_GMAIL_TEST_CLIENT_SECRET to valid Google desktop OAuth client values."
            );
            Some((id, secret))
        }
    } else {
        None
    };
    let directory = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory"));
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(directory.join("gmail-oauth-config.rs"))
        .expect("Cannot open Gmail build configuration output");
    writeln!(file, "{pair:?}").expect("Cannot write Gmail build configuration");
}

fn valid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn build_inputs() -> [String; 2] {
    if let Some(input) = env::var_os(INPUT) {
        let path = PathBuf::from(input);
        println!("cargo:rerun-if-changed={}", path.display());
        let bytes = fs::read(path).expect("Cannot read Gmail release build inputs");
        return decode(&bytes);
    }
    let read = |key| match env::var(key) {
        Ok(value) => Some(value),
        Err(env::VarError::NotPresent) => None,
        Err(env::VarError::NotUnicode(_)) => panic!("Gmail build input must be UTF-8: {key}"),
    };
    let id = read(ID);
    let secret = read(SECRET);
    if env::var_os("CI").is_some_and(|value| !value.is_empty())
        || (id.is_some() && secret.is_some())
    {
        return [id.unwrap_or_default(), secret.unwrap_or_default()];
    }
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let dotenv = repository.join(".env");
    println!("cargo:rerun-if-changed={}", dotenv.display());
    if matches!(fs::symlink_metadata(&dotenv), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
    {
        return [id.unwrap_or_default(), secret.unwrap_or_default()];
    }
    let script = repository.join("client/scripts/gmail-build-inputs.mjs");
    println!("cargo:rerun-if-changed={}", script.display());
    println!(
        "cargo:rerun-if-changed={}",
        repository
            .join("client/scripts/private-dotenv.mjs")
            .display()
    );
    let output = Command::new("node")
        .env_clear()
        .envs(
            ["PATH", "HOME", "VOLTA_HOME", ID, SECRET]
                .into_iter()
                .filter_map(|key| env::var_os(key).map(|value| (key, value))),
        )
        .arg(script)
        .output()
        .expect("Gmail build inputs require the repository's Volta-managed Node.js");
    assert!(
        output.status.success(),
        "Cannot read Gmail build inputs from the repository-root .env. Check its access and permissions (0600)."
    );
    decode(&output.stdout)
}

fn decode(bytes: &[u8]) -> [String; 2] {
    serde_json::from_slice(bytes).unwrap_or_else(|_| panic!("Invalid Gmail build input format"))
}
