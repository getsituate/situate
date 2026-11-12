const SYSTEM_PATTERNS: &[&str] = &[
    ".DS_Store",
    "._*",
    ".AppleDouble",
    ".Spotlight-V100",
    ".Trashes",
    ".TemporaryItems",
    ".fseventsd",
    ".VolumeIcon.icns",
    "Thumbs.db",
    "Thumbs.db:encryptable",
    "ehthumbs.db",
    "ehthumbs_vista.db",
    "Desktop.ini",
    ".Trash-*",
];

const EDITOR_PATTERNS: &[&str] = &[
    ".*.swp",
    ".*.swo",
    ".*.swn",
    "#*#",
    ".#*",
    ".~lock.*#",
    "~$*",
];

pub(crate) fn is_internal(name: &str) -> bool {
    let name = name.trim_end_matches([' ', '.']);
    name.eq_ignore_ascii_case(".situate")
        || name.eq_ignore_ascii_case(".git")
        || name.to_ascii_lowercase().starts_with(".situate-write-")
}

pub(crate) fn is_ignored(name: &str) -> bool {
    let lowercase = name.to_ascii_lowercase();
    SYSTEM_PATTERNS.iter().any(|pattern| {
        if pattern.contains(['*', '?']) {
            matches(&pattern.to_ascii_lowercase(), &lowercase)
        } else {
            name.eq_ignore_ascii_case(pattern)
        }
    }) || EDITOR_PATTERNS.iter().any(|pattern| matches(pattern, name))
}

// Patterns apply to one entry name, never to a relative path.
fn matches(pattern: &str, name: &str) -> bool {
    let prefix = pattern.split(['*', '?']).next().unwrap_or_default();
    if !name.starts_with(prefix) {
        return false;
    }
    let name: Vec<_> = name.chars().collect();
    let mut previous = vec![false; name.len() + 1];
    previous[0] = true;
    for token in pattern.chars() {
        let mut next = vec![false; name.len() + 1];
        next[0] = token == '*' && previous[0];
        for (index, character) in name.iter().enumerate() {
            next[index + 1] = if token == '*' {
                previous[index + 1] || next[index]
            } else {
                previous[index] && (token == '?' || token == *character)
            };
        }
        previous = next;
    }
    previous[name.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_specific_system_and_editor_artifacts() {
        for name in [
            ".DS_Store",
            ".ds_store",
            "._report.pdf",
            ".AppleDouble",
            ".Spotlight-V100",
            ".Trashes",
            ".TemporaryItems",
            ".fseventsd",
            ".VolumeIcon.icns",
            "Thumbs.db",
            "THUMBS.DB:encryptable",
            "ehthumbs.db",
            "ehthumbs_vista.db",
            "desktop.ini",
            ".Trash-501",
            ".note.md.swp",
            ".note.swo",
            ".note.swn",
            "#note#",
            ".#note",
            ".~lock.report.odt#",
            "~$report.docx",
        ] {
            assert!(is_ignored(name), "{name}");
        }
        for name in [
            "note.md",
            ".gitignore",
            ".env",
            "note.tmp",
            "note.temp",
            "note.bak",
            "note.old",
            "note~",
            "node_modules",
            "dist",
            "build",
            "app.log",
            "notes.db",
            "note.swp",
            ".note.SWP",
            "DS_Store",
            "myThumbs.db",
            ".situated",
            ".situate",
            ".git",
        ] {
            assert!(!is_ignored(name), "{name}");
        }
    }

    #[test]
    fn wildcards_match_complete_names_and_unicode_characters() {
        for (pattern, name, expected) in [
            ("", "", true),
            ("", "a", false),
            ("*", "", true),
            ("a?c", "aéc", true),
            ("a?c", "ac", false),
            ("a*b?", "axybz", true),
            ("a*b?", "ab", false),
            ("a**b", "ab", true),
            ("*.swp", ".note.swp.extra", false),
            ("#*#", "#note", false),
        ] {
            assert_eq!(matches(pattern, name), expected, "{pattern}: {name}");
        }
    }
}
