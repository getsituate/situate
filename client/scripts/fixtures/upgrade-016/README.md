# Workspace upgrade baseline

`workspace.mjs` stores unchanged bytes written by the 0.1.6 storage code at `81f1eae50f90bf7e8039222c31ea2cf3488f614c`. The signed 0.1.6 DMG that embeds this revision has SHA-256 `02f2eb0b4a339771ce82634a21a7583aa6623791aaa402b85bc9a261fad29be5`. The fixture has no Keychain entries or device-local AI credentials.

The workspace contains two synthetic conversations covering the 0.1.6 built-in tools, including successful and failed tool results. The tool records are test data; their commands and network requests are not replayed. The notes have Git-backed revisions. Archive index is a connection plugin with a local, read-only document source that returns sample text without network access. The snapshot includes its enabled source revision and history.

`writer.rs` uses the old workspace, content, conversation and plugin writers. To inspect or reproduce the format in a disposable checkout, place it at `client/crates/situate-core/examples/upgrade_fixture.rs` at the exact source revision above, put `service.js` beside it, then run:

```sh
node tools/run-coordinated.mjs -- cargo run --manifest-path client/Cargo.toml \
  --locked -p situate-core --example upgrade_fixture -- "$ABSOLUTE_EMPTY_DIRECTORY"
```

Keep the committed baseline unchanged. A new generation has different workspace and history identities. When adding another baseline, copy only the synthetic workspace: retain directories, Git objects, refs and empty `content.lock` files; omit Git sample hooks and default excludes. Do not copy the app's home, new test drafts, or caches.
