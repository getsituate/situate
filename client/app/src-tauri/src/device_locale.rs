use situate_core::localization::{DateFormat, NumberFormat, Preferences, TimeFormat};

pub fn preferences(_app: &tauri::AppHandle) -> Preferences {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        use objc2_foundation::{
            NSDateFormatter, NSDateFormatterStyle, NSLocale, NSNumberFormatter,
        };
        let languages = NSLocale::preferredLanguages();
        let language = languages
            .firstObject()
            .map(|s| s.to_string())
            .unwrap_or_default();
        let date = NSDateFormatter::new();
        date.setDateStyle(NSDateFormatterStyle::ShortStyle);
        let time = NSDateFormatter::new();
        time.setTimeStyle(NSDateFormatterStyle::ShortStyle);
        let number = NSNumberFormatter::new();
        from_patterns(
            &language,
            &time.dateFormat().to_string(),
            &date.dateFormat().to_string(),
            &number.decimalSeparator().to_string(),
            &number.groupingSeparator().to_string(),
        )
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        if let Ok(value) = _app
            .state::<tauri_plugin_workspace_access::Access>()
            .content(serde_json::json!({"operation":"deviceLocale"}))
        {
            let field = |name| {
                value
                    .get(name)
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
            };
            return from_patterns(
                field("language"),
                field("time"),
                field("date"),
                field("decimal"),
                field("group"),
            );
        }
    }
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Globalization::*;
        let language = if unsafe { GetUserDefaultUILanguage() } & 0x3ff == 7 {
            "de"
        } else {
            "en"
        };
        from_patterns(
            language,
            &windows_user_locale_field(LOCALE_STIMEFORMAT),
            &windows_user_locale_field(LOCALE_SSHORTDATE),
            &windows_user_locale_field(LOCALE_SDECIMAL),
            &windows_user_locale_field(LOCALE_STHOUSAND),
        )
    }
    #[cfg(target_os = "linux")]
    {
        let language = environment_language();
        let locale =
            unsafe { libc::newlocale(libc::LC_ALL_MASK, c"".as_ptr(), std::ptr::null_mut()) };
        if !locale.is_null() {
            let field = |kind| unsafe {
                std::ffi::CStr::from_ptr(libc::nl_langinfo_l(kind, locale))
                    .to_string_lossy()
                    .into_owned()
            };
            let time = field(libc::T_FMT);
            let date = field(libc::D_FMT);
            let result = from_patterns(
                &language,
                &strftime_pattern(&time),
                &strftime_pattern(&date),
                &field(libc::RADIXCHAR),
                &field(libc::THOUSEP),
            );
            unsafe {
                libc::freelocale(locale);
            }
            return result;
        }
        Preferences::initial(&language, None, None, None)
    }
    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "windows",
        target_os = "linux"
    )))]
    Preferences::initial(&environment_language(), None, None, None)
}

#[cfg(target_os = "windows")]
fn windows_user_locale_field(kind: u32) -> String {
    let mut buffer = [0u16; 128];
    let length = unsafe {
        // WinNls.h defines LOCALE_NAME_USER_DEFAULT as NULL; an empty string is invariant.
        windows_sys::Win32::Globalization::GetLocaleInfoEx(
            std::ptr::null(),
            kind,
            buffer.as_mut_ptr(),
            buffer.len() as i32,
        )
    };
    if length > 0 {
        String::from_utf16_lossy(&buffer[..length as usize - 1])
    } else {
        String::new()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "windows")))]
fn environment_language() -> String {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .find_map(|key| std::env::var(key).ok().filter(|s| !s.is_empty()))
        .unwrap_or_default()
}

#[cfg(any(target_os = "linux", test))]
fn strftime_pattern(pattern: &str) -> String {
    let mut result = String::new();
    let mut chars = pattern.chars();
    while let Some(c) = chars.next() {
        if c != '%' {
            result.push(c);
            continue;
        }
        let mut code = chars.next();
        if matches!(code, Some('E' | 'O')) {
            code = chars.next();
        }
        result.push_str(match code {
            Some('H' | 'k' | 'T' | 'R') => "H",
            Some('I' | 'l' | 'r') => "h",
            Some('d' | 'e') => "d",
            Some('m') => "M",
            Some('y' | 'Y') => "y",
            Some('F') => "y-M-d",
            Some('D') => "M/d/y",
            _ => "?",
        });
    }
    result
}

fn from_patterns(
    language: &str,
    time: &str,
    date: &str,
    decimal: &str,
    group: &str,
) -> Preferences {
    let time = unquoted_pattern(time);
    let date = unquoted_pattern(date);
    let time = if time.contains(['H', 'k']) {
        Some(TimeFormat::TwentyFour)
    } else if time.contains(['h', 'K']) {
        Some(TimeFormat::Twelve)
    } else {
        None
    };
    let fields: Vec<char> =
        date.chars()
            .filter(|c| matches!(c, 'd' | 'M' | 'y'))
            .fold(Vec::new(), |mut fields, c| {
                if !fields.contains(&c) {
                    fields.push(c);
                }
                fields
            });
    let date = match fields.as_slice() {
        ['d', 'M', 'y'] if date.contains('.') => Some(DateFormat::DmyDot),
        ['d', 'M', 'y'] if date.contains('/') => Some(DateFormat::DmySlash),
        ['M', 'd', 'y'] if date.contains('/') => Some(DateFormat::Mdy),
        ['y', 'M', 'd'] if date.contains('-') => Some(DateFormat::Ymd),
        _ => None,
    };
    let number = match (decimal, group) {
        (".", ",") => Some(NumberFormat::DotComma),
        (",", ".") => Some(NumberFormat::CommaDot),
        (".", " " | "\u{a0}" | "\u{202f}") => Some(NumberFormat::DotSpace),
        (",", " " | "\u{a0}" | "\u{202f}") => Some(NumberFormat::CommaSpace),
        (".", "'" | "’") => Some(NumberFormat::DotApostrophe),
        _ => None,
    };
    Preferences::initial(language, time, date, number)
}

fn unquoted_pattern(pattern: &str) -> String {
    let mut quoted = false;
    pattern
        .chars()
        .filter(|&c| {
            if c == '\'' {
                quoted = !quoted;
                false
            } else {
                !quoted
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_format_fields_match_current_user_locale() {
        use windows_sys::Win32::Globalization::*;

        for kind in [
            LOCALE_STIMEFORMAT,
            LOCALE_SSHORTDATE,
            LOCALE_SDECIMAL,
            LOCALE_STHOUSAND,
        ] {
            let length =
                unsafe { GetLocaleInfoW(LOCALE_USER_DEFAULT, kind, std::ptr::null_mut(), 0) };
            assert!(length > 0, "user locale field {kind} must be available");
            let mut buffer = vec![0u16; length as usize];
            let written =
                unsafe { GetLocaleInfoW(LOCALE_USER_DEFAULT, kind, buffer.as_mut_ptr(), length) };
            assert_eq!(written, length, "user locale field {kind}");
            let expected = String::from_utf16(&buffer[..written as usize - 1]).unwrap();
            assert_eq!(
                windows_user_locale_field(kind),
                expected,
                "locale field {kind}"
            );
        }
    }

    #[test]
    fn quoted_literals_and_posix_formats_do_not_override_independent_fields() {
        let p = from_patterns("de", "h:mm 'HH hours'", "dd/MM/yyyy 'day'", ".", ",");
        assert_eq!(p.formats.time, TimeFormat::Twelve);
        assert_eq!(p.formats.date, DateFormat::DmySlash);
        assert_eq!(strftime_pattern("%d.%m.%Y"), "d.M.y");
        assert_eq!(strftime_pattern("%r"), "h");
        assert_eq!(strftime_pattern("%F"), "y-M-d");
    }
    #[test]
    fn mixed_device_choices_and_unsupported_fields_fall_back_independently() {
        let p = from_patterns("de", "h:mm a", "yyyy-MM-dd", ".", "’");
        assert_eq!(p.formats.time, TimeFormat::Twelve);
        assert_eq!(p.formats.date, DateFormat::Ymd);
        assert_eq!(p.formats.number, NumberFormat::DotApostrophe);
        let p = from_patterns("en", "HH:mm", "d MMM y", ",", "\u{202f}");
        assert_eq!(p.formats.time, TimeFormat::TwentyFour);
        assert_eq!(p.formats.date, DateFormat::Mdy);
        assert_eq!(p.formats.number, NumberFormat::CommaSpace);
    }
}
