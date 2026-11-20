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
    let dictation_arch = match std::env::var("TARGET").as_deref() {
        Ok("aarch64-apple-darwin") => Some("arm64"),
        Ok("x86_64-apple-darwin") => Some("x86_64"),
        _ => None,
    };
    if dictation_arch.is_some() {
        println!("cargo:rerun-if-changed=dictation/Media");
        std::fs::create_dir_all("dictation/.build/media").unwrap();
        let status = std::process::Command::new("clang")
            .args([
                "-dynamiclib",
                "-fobjc-arc",
                "-arch",
                "arm64",
                "-arch",
                "x86_64",
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
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Tauri's resource manifest only reaches binaries, not the library test harness.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
        tauri_build::try_build(
            tauri_build::Attributes::new()
                .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
        )
        .expect("Could not prepare the Tauri build");
    } else {
        tauri_build::build();
    }
    if let Some(arch) = dictation_arch {
        println!("cargo:rerun-if-changed=dictation/Package.swift");
        println!("cargo:rerun-if-changed=dictation/Package.resolved");
        println!("cargo:rerun-if-changed=dictation/Sources");
        // SwiftPM's Xcode build system uses the same product path for both architectures.
        let scratch = format!("dictation/.build/{arch}");
        let args = [
            "build",
            "--package-path",
            "dictation",
            "--scratch-path",
            &scratch,
            "--arch",
            arch,
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
            .args(args)
            .arg("--show-bin-path")
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
