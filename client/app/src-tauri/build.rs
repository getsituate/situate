fn main() {
    for key in [
        "SITUATE_DISTRIBUTION",
        "SITUATE_DICTATION_MODEL_SOURCE",
        "SITUATE_UPDATER_PUBLIC_KEY",
        "SITUATE_UPDATER_ENDPOINT",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    if let Some(source) = std::env::var_os("SITUATE_DICTATION_MODEL_SOURCE") {
        assert!(
            std::env::var("PROFILE").as_deref() != Ok("release"),
            "SITUATE_DICTATION_MODEL_SOURCE is only supported in development builds"
        );
        assert!(
            std::path::Path::new(&source).is_absolute(),
            "SITUATE_DICTATION_MODEL_SOURCE must be an absolute directory path"
        );
        assert!(
            source.to_str().is_some_and(|value| !value.contains('\0')),
            "SITUATE_DICTATION_MODEL_SOURCE must be valid UTF-8 without NUL bytes"
        );
    }
    if std::env::var("SITUATE_DISTRIBUTION").as_deref() == Ok("direct")
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
        && std::env::var("PROFILE").as_deref() == Ok("release")
    {
        assert!(
            std::env::var("SITUATE_UPDATER_PUBLIC_KEY").is_ok_and(|v| !v.trim().is_empty()),
            "Direct releases require SITUATE_UPDATER_PUBLIC_KEY"
        );
        assert!(
            std::env::var("SITUATE_UPDATER_ENDPOINT")
                .ok()
                .and_then(|v| url::Url::parse(&v).ok())
                .is_some_and(|url| {
                    url.scheme() == "https"
                        && url.host_str().is_some()
                        && url.username().is_empty()
                        && url.password().is_none()
                        && url.fragment().is_none()
                }),
            "Direct releases require an explicit HTTPS SITUATE_UPDATER_ENDPOINT"
        );
    }
    if std::env::var("TARGET").as_deref() == Ok("aarch64-apple-darwin") {
        println!("cargo:rerun-if-changed=dictation/Media");
        std::fs::create_dir_all("dictation/.build/media").unwrap();
        let status = std::process::Command::new("clang")
            .args([
                "-dynamiclib",
                "-fobjc-arc",
                "-arch",
                "arm64",
                "-mmacosx-version-min=14.0",
                "-framework",
                "Foundation",
                "-Wl,-install_name,@rpath/libSituateMedia.dylib",
                "dictation/Media/SystemMedia.m",
                "-o",
                "dictation/.build/media/libSituateMedia.dylib",
            ])
            .status()
            .expect("Clang is required for system media integration");
        assert!(status.success(), "Could not build system media integration");
    }
    tauri_build::build();
    if std::env::var("TARGET").as_deref() == Ok("aarch64-apple-darwin") {
        println!("cargo:rerun-if-changed=dictation/Package.swift");
        println!("cargo:rerun-if-changed=dictation/Package.resolved");
        println!("cargo:rerun-if-changed=dictation/Sources");
        let args = [
            "build",
            "--package-path",
            "dictation",
            "--disable-automatic-resolution",
            "-c",
            "release",
            "--product",
            "SituateDictation",
        ];
        let status = std::process::Command::new("swift")
            .args(args)
            .status()
            .expect("Swift 6.2 or later is required");
        assert!(status.success(), "Could not build the dictation runtime");
        let output = std::process::Command::new("swift")
            .args([
                "build",
                "--package-path",
                "dictation",
                "-c",
                "release",
                "--show-bin-path",
            ])
            .output()
            .expect("Could not locate the dictation runtime");
        assert!(output.status.success());
        println!(
            "cargo:rustc-link-search=native={}",
            String::from_utf8(output.stdout).unwrap().trim()
        );
        println!("cargo:rustc-link-lib=static=SituateDictation");
        let developer = std::process::Command::new("xcode-select")
            .arg("-p")
            .output()
            .expect("Xcode is required");
        assert!(developer.status.success());
        let developer = String::from_utf8(developer.stdout).unwrap();
        println!(
            "cargo:rustc-link-search=native={}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx",
            developer.trim()
        );
        println!("cargo:rustc-link-search=native=/usr/lib/swift");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        println!("cargo:rustc-link-lib=dylib=c++");
        for framework in ["AppKit", "AVFoundation", "CoreML", "Accelerate", "Network"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
}
