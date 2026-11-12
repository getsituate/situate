# Migration fixtures

All payloads are synthetic, not exported user data. The top-level m0001 `before`/`after` pair describes the metadata bootstrap. Its opaque JSON record verifies byte preservation rather than representing a known store.

## Public release writers

`m0001/releases/<version>/` contains exact bytes generated through `workspaces::create`, `Storage::create_conversation` and `Storage::save_conversation` from the source revision embedded in each signed macOS release. Each conversation retains a message, draft and pending input. No provider connections, credentials or personal workspace data are present.

| App                                                                                     | Signed source revision                     | Public DMG SHA-256                                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| [0.0.1](https://getsituate.com/releases/0.0.1/Situate-0.0.1-macos-universal-direct.dmg) | `1d0878ed718712f5f10e7258da8a9f9fcdbb2c55` | `bf0105ea63a256edccb4492d0af75afc01745ae721e05b32b58a24d651cdaaf5` |
| [0.1.0](https://getsituate.com/releases/0.1.0/Situate-0.1.0-macos-universal-direct.dmg) | `61955ff3900e3f4b08c94a4b6a161157bcbc6dbf` | `9da9810344b1760494ec8232c5c9468ff8ac8bf17f32475c17abe0da58e29769` |
| [0.1.1](https://getsituate.com/releases/0.1.1/Situate-0.1.1-macos-universal-direct.dmg) | `8b7faa6a0020c337dc9cf7dcf99f8cd760172398` | `48c2198ebf2a2117e29102ecd39edd05abb2e2a7279f22358230315b631a708e` |
| [0.1.2](https://getsituate.com/releases/0.1.2/Situate-0.1.2-macos-universal-direct.dmg) | `d5fde67967d9f4393a7f3f99faa059b1ddd7919b` | `00ec8123c432312b7b98044172123ed81a7f63afec3bb756ab7f8dae0c62d26e` |
| [0.1.3](https://getsituate.com/releases/0.1.3/Situate-0.1.3-macos-universal-direct.dmg) | `cb2829ac7f35f909d10b9c51a9acad23f698250d` | `afff24c0f65bd9d54a4f0fc8baf3a31c158f36cc1055acaf5957c506067bbb25` |
| [0.1.5](https://getsituate.com/releases/0.1.5/Situate-0.1.5-macos-universal-direct.dmg) | `6c310a75ecd7d38ff9b4dcf94ba042580f2b68fa` | `cc3e105ee69c6291da8ec68e35ad977e1305feea4544c6148bc6894a151f6b81` |

The DMGs were read from these public HTTPS routes and their application signatures verified with `codesign --verify --deep --strict`. The source revisions come from the signed `situate-distribution.json` resource, not a filename or an inferred version tag. A version label alone is insufficient provenance for another artifact.

The `.fixture` suffix prevents formatters from rewriting released serialized bytes; remove that suffix when materializing a managed-state payload. The package test checks exact byte preservation through bootstrap. The core integration test checks retained messages, drafts and queued input through current writes and reopening. Both tests run offline without the DMGs, historical source trees or an app installation.

The public update manifest named 0.1.5 on 2026-11-12; the standard 0.1.4 DMG route returned HTTP 404. The verified direct-distribution artifact set therefore ends at 0.1.5. A release-preparation commit alone does not establish a published artifact.

These fixtures cover the version-2 conversation stores emitted by the listed artifacts. The version-1 prototype at `7312396c4e9be2c90b72083aa7f9eb7750125e97`, also labeled 0.0.1, was used internally and was not publicly distributed; it is not a supported release fixture. Source-matched serializer qualification does not replace exact-artifact UI, installation or device-local connection qualification.

Migration 1 metadata initialization imposes no new minimum app version and performs no conversation conversion. Keep the DMGs and temporary qualification workspaces outside the repository.

## Conversation history conversion

`m0002/before` and `m0002/after` specify an independent version-2-to-JSONL fixture pair. Migration 2 also consumes the public-release inputs above in forward-upgrade tests, retaining messages, drafts and waiting inputs. The target requires app version 0.1.6 or newer; it provides no reverse conversion or older writer.

The package tests cover conversion failure after earlier conversations were written, process termination during conversion and source cleanup, restoration and repeated reopening. The production core tests separately validate that converted entries can be read, edited and reopened. The listed signed source revisions predate the workspace compatibility gate. Their binaries cannot acquire a minimum-version check retroactively and are unsupported for converted workspaces. The tests exercise rejection at the current gate when given an older app version; they do not claim that a released pre-gate binary performs that rejection. Upgrade every installation that opens the workspace before conversion, and retain a separate backup of the closed workspace. No old-format writer or reverse conversion is provided.
