# Prepare app release notes

Prepare reviewed English notes and translations for every supported interface language before a distribution build. You can write them manually or use the development terminal's optional Pi/Herdr workflow. Neither path builds or publishes an app.

Use the repository's [Volta toolchain](README.md#install-volta) and begin with a clean checkout.

## Manual preparation

Prepare the version already committed in the checkout. To select a different version, run `node tools/release.mjs set-version --version VERSION`, review the changed version pins and commit them before preparing notes.

```sh
node tools/release.mjs prepare --version VERSION --baseline COMPARISON_SHA
```

For the first release with no earlier finalized notes, use the full SHA of the repository's root commit as the explicit comparison baseline. Find it with `git rev-list --max-parents=0 HEAD`. The analysis revision is the current committed `HEAD`; include product changes in commits after the root. Do not substitute an unavailable historical revision or invent historical approvals. Later releases normally omit `--baseline` to use the analysis revision of the highest earlier committed finalized release.

Write `.release-preparation/VERSION/en.json` using the [locale format below](#private-files-and-review-commands). Review the committed changes, not just commit messages, and include only supported user-visible effects. Then approve English, write and review every required translation, and finalize:

```sh
node tools/release.mjs status --version VERSION --json
node tools/release.mjs approve --version VERSION --source-hash SOURCE_HASH
# Write and review the other locale files before accepting them.
node tools/release.mjs accept-local-translations --version VERSION --source-hash SOURCE_HASH
node tools/release.mjs finalize --version VERSION
```

Use the exact source hash reported by status. Review and commit `releases/VERSION/release.json` and `client/packages/localization/src/catalogs/releases/VERSION/` together without reformatting them. Product changes after analysis require new preparation and approval. Distribution validation also requires a clean committed checkout and the separate migration qualification described below. None of these commands requires Pi, Herdr or a model API.

## Optional agent-assisted draft and review

Run the development terminal inside Herdr with your local Pi setup. This workflow combines the version bump and finalized notes in one commit.

Select an Apple platform in **Release** and enter the product version. New versions and versions without finalized notes open release-note preparation. If no preparation exists yet, the baseline prompt opens directly, followed by confirmation to start Pi. For an existing draft, continue reviewing it in its Pi pane. You can also prepare notes without selecting a build through **Release → Prepare release notes**. The version is numeric `major.minor.patch`; commit types do not select it. An iOS build number identifies an upload, not another public changelog entry.

Leave the comparison SHA empty to use the analysis revision of the highest earlier version with finalized release notes committed in `HEAD`. If no earlier notes exist, supply an explicit full Git commit SHA. The baseline must be an ancestor of the current `HEAD`. Older releases need no retroactive changelogs.

The equivalent command is:

```sh
node tools/release.mjs start-local --version VERSION --baseline COMPARISON_SHA
```

Omit `--baseline` when earlier committed release notes are available. The command captures `HEAD` automatically, writes a private prompt and opens a sibling Herdr pane running Pi. It leaves version pins unchanged. The agent examines committed changes, writes English notes and waits for your feedback. Continue reviewing in that pane; request translations only when satisfied with the English text.

The agent must distinguish shipped product changes from plans, workshop experiments and internal refactors. Commit messages alone do not establish user impact. Review its evidence and uncertainties, as well as the draft itself.

## Private files and review commands

Preparation files live in the Git-ignored `.release-preparation/VERSION/` directory. Agent-assisted preparation also writes `prompt.txt` with the assignment and paths. `state.json` binds the target version, comparison baseline, analysis revision and supported locales. `en.json` is the English source; other language files use their locale identifier, such as `de.json`.

Each locale file uses this exact JSON structure:

```json
{
  "title": "Release title",
  "entries": [
    {
      "id": "keep-drafts",
      "type": "fixed",
      "platforms": ["macos", "ios"],
      "title": "Keep drafts",
      "paragraphs": ["Drafts remain available after switching views."]
    }
  ]
}
```

Types are `new`, `changed`, `fixed` or `important`. Entry IDs are unique lowercase kebab-case strings, at most 80 characters long. Platforms are `macos`, `ios` or both. Prose is plain text, not HTML or Markdown. An empty entry list is valid when no user-visible changes are supported by the evidence.

Both workflows use these review commands:

```sh
node tools/release.mjs status --version VERSION --json
node tools/release.mjs approve --version VERSION --source-hash SOURCE_HASH
node tools/release.mjs accept-local-translations --version VERSION --source-hash SOURCE_HASH
```

Status reports source and translation paths, the exact English source hash and validation errors. Approve English only after reviewing it, before translating. Translation acceptance validates every language and binds it to that approved hash. English edits invalidate approval and translations; review the new source before requesting translations again. Translations must preserve entry order, IDs, types, platforms, facts, numbers and warnings. Structural checks cannot establish translation accuracy.

Bare `status` discovers the most recently selected local target, including after reopening the development terminal before the version bump. Private preparation files are owner-only; do not commit them or use personal workspace content as release evidence.

## Confirm agent-assisted preparation

Review the translations, return to the development terminal, choose **Changelog prepared**, and confirm. The equivalent explicit confirmation is:

```sh
node tools/release.mjs complete-local --version VERSION
```

This requires a clean checkout, valid English approval and complete translations. It updates the npm, Cargo and Tauri version pins, finalizes the catalogs and makes **one local commit** containing both. Normal Git hooks and signing configuration apply. A private index prevents unrelated staged files from entering the commit; pre-existing user changes block completion. There is no separate version commit and no push.

The analysis revision remains the original captured `HEAD`. Verification permits only product-version pin changes and the release catalogs after that revision; application changes, including non-version configuration or dependency changes in version-bearing files, invalidate preparation.

Cancellation before commit restores preparation files. Once Git commit starts, it finishes without cancellation so signing and ref updates are not interrupted. If a hook or another ordinary pre-commit step fails, completion restores its own files without discarding intervening user edits. Correct the failure and explicitly confirm again. Repeating completion after a successful commit validates and returns the existing result without making another commit.

If startup is interrupted, inspect `local-session.json` and its recorded pane before taking further action. Startup never automatically repeats an uncertain pane creation or prompt. Resume the existing agent directly; archive the session record only after confirming that a replacement will not duplicate work. An interrupted completion retains `completion.json` and may leave a Git index lock. Inspect the recorded owner, commit and files before removing locks or restoring files; never discard retained drafts or user edits to clear a failure.

## Published migration checkpoint

Release-note baselines and migration baselines are separate. Migration qualification requires local published source commits ancestral to the candidate, unchanged migration implementation bytes, and preserved registry/module prefixes.

Direct macOS qualification reads `releases/migration-checkpoint.json` from the publication tool checkout's committed `HEAD`, even when qualifying an older artifact revision. The file pins only a publication version, source revision and stored-manifest SHA-256. It is a provenance pin, not an attestation of migration contents.

The verified-SSH history response includes a restricted qualification projection from the same immutable manifest bytes whose digest identifies the checkpoint. Every attested predecessor must remain present with its exact version, revision and manifest digest. Only those predecessors can omit local Git objects. The checkpoint's migration count must match its source inventory; its source and every uncovered publication still undergo normal Git history checks. Missing checkpoints, proof, predecessor records or hashes fail qualification. The full server history remains the publication race/reconciliation baseline.

For iOS and external distribution, supply the full published source commit from trusted publication evidence. The baseline must exist locally; the checkpoint does not replace this explicit comparison:

```sh
SITUATE_MIGRATIONS_PUBLISHED_REVISION=FULL_PUBLISHED_SOURCE_COMMIT \
node tools/release.mjs validate --version CANDIDATE_VERSION
```

Neither workflow replaces released-data fixtures or native upgrade qualification.

## Build and publication

To rebuild the checkout's current version, select an Apple platform in **Release**, then choose **Build current version** (`c`) instead of entering a version. This skips changelog preparation and leaves version files unchanged. The same action is available in the preparation dialog; when no build target is selected, it returns to the Release menu. Tests and build confirmation remain separate, and distribution validation still applies.

Changelog completion does not qualify migration history. Direct macOS builds read published source commits automatically from the release server over verified SSH, using `WEBSITE_DEPLOY_HOST` and optional `WEBSITE_SSH_IDENTITY`. No migration comparison hash is configured manually. iOS and external distribution retain the explicit `SITUATE_MIGRATIONS_PUBLISHED_REVISION` workflow described in [release compatibility verification](testing.md#release-compatibility-verification). A missing build prerequisite does not undo a completed changelog commit.

```sh
node tools/release.mjs validate --version VERSION --distribution direct
```

Distribution validation requires finalized content, consistent version pins and a clean committed checkout. Follow the [Apple release guide](../../client/README.md#apple-distribution). Builds reuse the exact finalized bytes without invoking an agent; another iOS build number does not regenerate notes. Hash-bound finalized files must not be reformatted.

The app bundles all finalized, committed changelogs at or below its installed version, sorted numerically. It excludes drafts and newer versions, works offline and does not show notes automatically. The signed resource and build manifest bind the catalog digest. Finalized release metadata and translations are included automatically; no separate publication record is required.

Publication still requires the [publication runbook](../../infrastructure/releases/README.md), exact target confirmation and recovery after uncertain remote outcomes. Never replace published bytes under the same version. The development terminal uses the agent-assisted workflow; manual preparation uses the command-line path above.
