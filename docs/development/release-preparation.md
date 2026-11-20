# Prepare changelog declarations

Add a versionless declaration in `changes/` when a pull request changes the client. CI checks changed paths, including app code, bundled assets, localization and client dependency files. Documentation, tests and developer tooling alone need no declaration. CI still validates any declaration a PR adds.

A declaration contains reviewed public entries in every language from `client/packages/localization/locales.json`, or an empty entry list with an internal reason. An empty changelog does not mean that the application needs no release.

Use the repository's [Volta toolchain](README.md#install-volta).

## Author and review a declaration

For a client change with no user-facing effect:

```sh
node tools/change-fragments.mjs author --id improve-build-inputs --reason "Build-input validation only; no user-facing changes."
```

Omit `--id` to generate a unique identifier before the PR exists. Do not reuse an identifier already present on the base branch. Keep reasons non-sensitive: the declaration itself is committed, although its reason is excluded from public release assets and app history.

For public entries, supply a JSON file containing one locale object per supported language:

```sh
node tools/change-fragments.mjs author --id keep-drafts --stdin < /PATH/TO/localized-draft.json
node tools/change-fragments.mjs validate --id keep-drafts
```

Each locale object uses this structure; the input file wraps those objects under locale keys such as `en` and `de`:

```json
{
  "title": "Changes",
  "entries": [
    {
      "id": "keep-drafts",
      "type": "fixed",
      "platforms": ["macos"],
      "title": "Keep drafts",
      "paragraphs": ["Drafts remain available after switching views."]
    }
  ]
}
```

Types are `new`, `changed`, `fixed` and `important`. Entry IDs are lowercase kebab-case strings, at most 80 characters long. New entries target macOS only; historical catalogs retain their original platform metadata. Use plain text without HTML. Describe implemented effects, required actions and limitations, not plans or commit lists.

In the PR review, check that the English text describes the implemented behavior and that each translation preserves the facts, limitations and warnings. CI checks the structure, required languages, entry order, IDs, types and platforms; it does not check what the text means.

Commit the completed declaration with the change. To validate the range locally, use full commit SHAs, with an ancestral base such as the PR merge base:

```sh
node tools/change-fragments.mjs validate --base BASE_SHA --head PR_HEAD_SHA
```

Use a new declaration to correct an existing one. Finalized release catalogs stay unchanged.

## Generated release inputs

[Release creation](../../client/README.md#build-and-verify) assigns the public CalVer version and Apple build number after merge. Do not bump tracked versions, create a release-note commit or run a note-writing agent during a release.

Assembly selects committed declarations since the preceding completed GitHub Release. Drafts, reservations and failed candidates do not assign declarations. Later releases retain completed GitHub Release history even if the host never promoted that version. Legacy committed catalogs remain readable without retroactive imports or rewritten prose.

The creator writes `release-inputs.json` and `situate-release-history.json` outside tracked source. The input manifest binds source, baseline, version, build, tag, fragment identities and catalog hashes. Its catalog file SHA-256 includes the final newline; the existing signed `releaseContent` digest hashes the canonical catalog without that newline. Both frontend and native packaging consume the same generated catalog bytes before signing. Newly assembled candidates omit the optional display date; historical dates are preserved.

The app bundles the current candidate, even with no public entries, and finalized earlier versions in descending numeric order. It excludes internal reasons, drafts and newer uninstalled versions. History works offline and never opens automatically. GitHub release notes group the current release's English entries under Important, Features, Changes, and Fixes, in that order. Empty sections are omitted. You can edit the visible notes after publication. Leave the hidden release identity comment and all assets unchanged. Publication copies the exact sealed assets; it does not regenerate history.

## Published migration checkpoint

Content assignment, compatibility and host availability have different baselines. Completed public GitHub Releases count as published app versions for compatibility, even without host promotion. The host inventory remains authoritative for website/update availability and the installed predecessor used in updater qualification.

Direct macOS qualification reads `releases/migration-checkpoint.json` from the tool checkout's committed `HEAD`. This pins a publication version, source revision and stored-manifest SHA-256, not migration correctness. The verified-SSH history response projects qualification fields from those exact immutable manifest bytes. Every attested predecessor must remain present with its exact version, revision and manifest digest; only covered predecessors may omit local Git objects. The checkpoint source and uncovered publications still require local ancestry, unchanged migration implementation bytes and preserved registry/module prefixes. The only byte-change exception is the [exact one-way `m0002_conversation_history` validation correction](testing.md#workspace-migration-checks).

Missing history, checkpoint proof or required Git objects blocks qualification. The complete host inventory remains the race/reconciliation baseline. These checks do not replace released-data fixtures, mixed-version tests or native upgrade qualification; see [release compatibility verification](testing.md#release-compatibility-verification).

## Retained historical preparation state

Older releases used `releases/VERSION/release.json`, locale files under `client/packages/localization/src/catalogs/releases/VERSION/` and private `.release-preparation/VERSION/` drafts. Preserve their hash-bound bytes and existing readers. New releases use declarations and generated inputs instead.

If an old preparation session or completion was interrupted, retain its `local-session.json`, `completion.json`, recorded pane, drafts and Git locks. Inspect the recorded process, commit and files before removing a stale lock or restoring anything. Do not discard drafts, reset user edits, or start another agent merely because the previous outcome is uncertain. See the [publication recovery runbook](../../infrastructure/releases/README.md#interrupted-publication) for external operations.
