fn main() {
    assert!(
        std::env::var("PROFILE").as_deref() != Ok("release"),
        "Design Workshop is only available in debug builds"
    );
    assert!(
        !matches!(
            std::env::var("CARGO_CFG_TARGET_OS").as_deref(),
            Ok("ios" | "android")
        ),
        "Design Workshop is only available on desktop"
    );
    tauri_build::build();
}
