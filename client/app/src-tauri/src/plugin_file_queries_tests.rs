use super::*;
use std::fs;

fn fixture() -> tempfile::TempDir {
    tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
}
fn paths(entries: &[Entry]) -> Vec<&str> {
    entries.iter().map(|entry| entry.path.as_str()).collect()
}

#[test]
fn lists_sorted_files_filters_extensions_and_searches_literal_utf8() {
    let root = fixture();
    fs::create_dir(root.path().join("notes")).unwrap();
    fs::create_dir(root.path().join(".hidden")).unwrap();
    for (path, bytes) in [
        ("z.txt", &b"Needle.*"[..]),
        ("notes/b.MD", &b"Needle.*\r\n"[..]),
        ("notes/a.md", &b"needle.*"[..]),
        (".hidden/secret.md", &b"Needle.*"[..]),
        (".secret.md", &b"Needle.*"[..]),
        ("binary.md", &b"Needle.*\0"[..]),
        ("invalid.md", &b"Needle.*\xff"[..]),
    ] {
        fs::write(root.path().join(path), bytes).unwrap();
    }
    let token = CancellationToken::new();
    let entries = list(root.path(), Query::default(), None, &token).unwrap();
    assert_eq!(
        paths(&entries),
        [
            "binary.md",
            "invalid.md",
            "notes/a.md",
            "notes/b.MD",
            "z.txt"
        ]
    );
    assert!(entries.iter().all(|entry| !entry.change_token.is_empty()));
    let query = || Query {
        roots: Some(vec!["notes".into()]),
        extensions: Some(vec![".md".into()]),
    };
    assert_eq!(
        paths(&list(root.path(), query(), None, &token).unwrap()),
        ["notes/a.md", "notes/b.MD"]
    );
    assert_eq!(
        paths(&list(root.path(), Query::default(), Some("Needle.*"), &token).unwrap()),
        ["notes/b.MD", "z.txt"]
    );
    assert!(
        list(root.path(), query(), Some("Needle.+"), &token)
            .unwrap()
            .is_empty()
    );
    let before = entries.last().unwrap().change_token.clone();
    fs::write(root.path().join("z.txt"), "replacement").unwrap();
    let after = list(root.path(), Query::default(), None, &token).unwrap();
    assert_ne!(before, after.last().unwrap().change_token);
}

#[test]
fn reads_are_ordered_exact_and_do_not_observe_or_normalize_history() {
    let root = fixture();
    fs::write(root.path().join("note.md"), "plain\r\n").unwrap();
    fs::write(root.path().join("empty.txt"), "").unwrap();
    fs::create_dir(root.path().join(".situate")).unwrap();
    let store = situate_core::content::ContentStore::open(root.path()).unwrap();
    let before = serde_json::to_value(store.history().unwrap()).unwrap();
    fs::write(root.path().join("note.md"), "hello\n").unwrap();
    let token = CancellationToken::new();
    let entries = read_many(
        root.path(),
        vec!["note.md".into(), "empty.txt".into(), "note.md".into()],
        &token,
    )
    .unwrap();
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        ["note.md", "empty.txt", "note.md"]
    );
    assert_eq!(entries[0].text, "hello\n");
    assert_eq!(
        entries[0].revision,
        "ce013625030ba8dba906f756967f9e9ca394464a"
    );
    assert_eq!(
        entries[1].revision,
        "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"
    );
    assert_eq!(entries[2].revision, entries[0].revision);
    list(root.path(), Query::default(), None, &token).unwrap();
    list(root.path(), Query::default(), Some("hello"), &token).unwrap();
    assert_eq!(
        serde_json::to_value(store.history().unwrap()).unwrap(),
        before
    );
    assert_eq!(fs::read(root.path().join("note.md")).unwrap(), b"hello\n");
    assert!(root.path().join(".situate/history.git").is_dir());
}

#[test]
fn denies_invalid_and_missing_roots_and_paths() {
    let root = fixture();
    fs::write(root.path().join("file.md"), "text").unwrap();
    let token = CancellationToken::new();
    for path in [
        "",
        "/absolute",
        "../escape",
        "a/../b",
        "a//b",
        "a/./b",
        "a/.hidden/b",
        "a\\b",
        "a:b",
        "a\nb",
        "missing",
        "file.md",
    ] {
        assert!(
            list(
                root.path(),
                Query {
                    roots: Some(vec![path.into()]),
                    extensions: None
                },
                None,
                &token
            )
            .is_err(),
            "{path:?}"
        );
    }
    for path in ["", "../escape", ".hidden", "a/../file.md", "missing"] {
        assert!(read_many(root.path(), vec!["file.md".into(), path.into()], &token).is_err());
    }
    for roots in [vec![], vec!["x".into(); 33]] {
        assert!(
            list(
                root.path(),
                Query {
                    roots: Some(roots),
                    extensions: None
                },
                None,
                &token
            )
            .is_err()
        );
    }
    for extensions in [
        vec![],
        vec!["md".into()],
        vec![".".into()],
        vec![".a/b".into()],
        vec![".md".into(); 17],
    ] {
        assert!(
            list(
                root.path(),
                Query {
                    roots: None,
                    extensions: Some(extensions)
                },
                None,
                &token
            )
            .is_err()
        );
    }
    for text in [String::new(), "x".repeat(4097)] {
        assert!(list(root.path(), Query::default(), Some(&text), &token).is_err());
    }
}

#[cfg(unix)]
#[test]
fn never_traverses_or_reads_symlinks() {
    use std::os::unix::fs::symlink;
    let root = fixture();
    let outside = fixture();
    fs::write(outside.path().join("secret.md"), "outside").unwrap();
    fs::create_dir(root.path().join("local")).unwrap();
    fs::write(root.path().join("local/good.md"), "inside").unwrap();
    symlink(outside.path(), root.path().join("escape")).unwrap();
    symlink(root.path().join("local"), root.path().join("alias")).unwrap();
    symlink(
        outside.path().join("secret.md"),
        root.path().join("file.md"),
    )
    .unwrap();
    symlink(outside.path(), root.path().join("local/nested")).unwrap();
    let token = CancellationToken::new();
    assert_eq!(
        paths(&list(root.path(), Query::default(), None, &token).unwrap()),
        ["local/good.md"]
    );
    for path in ["escape", "alias", "local/nested"] {
        assert!(
            list(
                root.path(),
                Query {
                    roots: Some(vec![path.into()]),
                    extensions: None
                },
                None,
                &token
            )
            .is_err()
        );
    }
    for path in [
        "file.md",
        "escape/secret.md",
        "alias/good.md",
        "local/nested/secret.md",
    ] {
        assert!(read_many(root.path(), vec![path.into()], &token).is_err());
    }
}

#[test]
fn enforces_read_and_search_budgets_without_partial_results() {
    let root = fixture();
    let token = CancellationToken::new();
    fs::write(root.path().join("large.txt"), vec![b'x'; TEXT_LIMIT]).unwrap();
    assert_eq!(
        read_many(root.path(), vec!["large.txt".into(); 16], &token)
            .unwrap()
            .len(),
        16
    );
    assert_eq!(
        read_many(root.path(), vec!["large.txt".into(); 17], &token).unwrap_err(),
        TOO_LARGE
    );
    assert_eq!(
        read_many(root.path(), vec!["large.txt".into(); 257], &token).unwrap_err(),
        TOO_LARGE
    );
    fs::write(root.path().join("large.txt"), vec![b'x'; TEXT_LIMIT + 1]).unwrap();
    assert_eq!(
        read_many(root.path(), vec!["large.txt".into()], &token).unwrap_err(),
        TOO_LARGE
    );
    fs::write(root.path().join("large.txt"), vec![b'x'; TOTAL_LIMIT]).unwrap();
    assert_eq!(
        list(root.path(), Query::default(), Some("x"), &token)
            .unwrap()
            .len(),
        1
    );
    fs::write(root.path().join("large.txt"), vec![b'x'; TOTAL_LIMIT + 1]).unwrap();
    assert_eq!(
        list(root.path(), Query::default(), Some("x"), &token).unwrap_err(),
        TOO_LARGE
    );
    fs::write(root.path().join("invalid.txt"), [255]).unwrap();
    assert!(read_many(root.path(), vec!["invalid.txt".into()], &token).is_err());
    fs::write(root.path().join("binary.txt"), b"valid UTF8\0binary").unwrap();
    assert!(read_many(root.path(), vec!["binary.txt".into()], &token).is_err());
}

#[test]
#[ignore = "Measures synthetic filesystem query latency; run explicitly without concurrent builds"]
fn benchmark_markdown_queries() {
    use std::time::Instant;
    let root = fixture();
    let text = format!(
        "# Synthetic note\n\n{}",
        "Search needle in ordinary Markdown.\n".repeat(100)
    );
    for index in 0..251 {
        fs::write(root.path().join(format!("note-{index:03}.md")), &text).unwrap();
    }
    let token = CancellationToken::new();
    let started = Instant::now();
    let entries = list(root.path(), Query::default(), None, &token).unwrap();
    let list_elapsed = started.elapsed();
    let started = Instant::now();
    let matches = list(root.path(), Query::default(), Some("Search needle"), &token).unwrap();
    let search_elapsed = started.elapsed();
    let started = Instant::now();
    let texts = read_many(
        root.path(),
        entries.iter().map(|entry| entry.path.clone()).collect(),
        &token,
    )
    .unwrap();
    let read_elapsed = started.elapsed();
    assert_eq!(entries.len(), 251);
    assert_eq!(matches.len(), 251);
    assert_eq!(texts.len(), 251);
    assert!(texts.iter().all(|entry| entry.text == text));
    println!(
        "251 Markdown files, {} bytes: list={list_elapsed:?}, search={search_elapsed:?}, readMany={read_elapsed:?}",
        251 * text.len()
    );
}

#[test]
fn scan_and_depth_limits_fail_explicitly() {
    let root = fixture();
    let token = CancellationToken::new();
    for index in 0..=ENTRY_LIMIT {
        fs::write(root.path().join(format!(".hidden-{index}")), "").unwrap();
    }
    assert_eq!(
        list(root.path(), Query::default(), None, &token).unwrap_err(),
        TOO_LARGE
    );
    let deep = fixture();
    let mut path = deep.path().to_path_buf();
    for _ in 0..=DEPTH_LIMIT {
        path.push("d");
        fs::create_dir(&path).unwrap();
    }
    assert_eq!(
        list(deep.path(), Query::default(), None, &token).unwrap_err(),
        TOO_LARGE
    );
}

#[test]
fn cancellation_fails_queries_and_chunked_reads() {
    let root = fixture();
    let token = CancellationToken::new();
    token.cancel();
    assert_eq!(
        list(root.path(), Query::default(), None, &token).unwrap_err(),
        "native.plugins.hostCancelled"
    );
    assert_eq!(
        list(root.path(), Query::default(), Some("text"), &token).unwrap_err(),
        "native.plugins.hostCancelled"
    );
    assert_eq!(
        read_many(root.path(), vec![], &token).unwrap_err(),
        "native.plugins.hostCancelled"
    );
    let file = fs::File::create(root.path().join("file.txt")).unwrap();
    assert_eq!(
        read_bytes(file, TEXT_LIMIT, &token).unwrap_err(),
        "native.plugins.hostCancelled"
    );
}
