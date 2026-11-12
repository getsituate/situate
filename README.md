# Situate

Situate is a personal organizational system project for organizing information and coordinating work with AI assistance.

This repository contains a desktop/mobile client, product documentation, a requirements catalog, and development tooling. See [Situate — Product Capability Catalog](docs/product-capability-catalog/README.md) for capability-level support, prerequisites, evidence and known gaps at a recorded product revision.

The current MVP targets **macOS and iOS**. Windows, Linux desktop and Android are deferred; retained code for those platforms is not a support commitment. See the [platform scope](requirements/data/foundations.md#mvp-platform-scope).

## Repository layout

- `client/` — [Vue/Tauri client, Rust core, shared UI components, build commands and tests](client/README.md).
- `docs/` — [product and business model](docs/product-concept.md), [positioning](docs/positioning.md), [capability catalog](docs/product-capability-catalog/README.md), [architecture documentation](docs/architecture/README.md), and the [historical prototype handover](docs/prototype-handover.md).
- `requirements/` — goals, requirements, and a read-only web viewer.
- `design/brand/` — [brand handbook](design/brand/README.md), [visual reference](design/brand/reference/index.html), reusable artwork, and the Bend character kit.
- `.pi/` — agent extensions, roles, and skills used during development.
- `AGENTS.md` — repository contribution guidelines for coding agents.

## Developer setup

Install Pi and Herdr for agent-assisted development and parallel work. See [Developer setup](docs/development/README.md) for installation, authentication, delegation, and verification commands.

## Tests

Run `node tools/test.mjs` for the active Apple MVP scope, or `node tools/test.mjs --unit --changed` for fast tests in affected projects. Expensive workshop, design-browser and visual sweeps are opt-in with `node tools/test.mjs --extended` or their dedicated commands. See the [test suite guide](docs/development/testing.md) for profiles, Git comparison bases, prerequisites, and JSON output.

## Requirements viewer

Install [Volta and the pinned Node.js/npm toolchain](docs/development/README.md#install-volta) before running these commands.

```sh
cd requirements
npm ci
npm run dev
```

To validate the catalog and check the application:

```sh
npm run validate
npm test
npm run build
```

See [the requirements viewer documentation](requirements/README.md) for the data format and browser tests.

## License

Original software and documentation are licensed under the [MIT License](LICENSE). Original illustrations, Bend, wordmarks and app-icon artwork are licensed under [CC BY 4.0](LICENSES/CC-BY-4.0.txt). Third-party components retain their respective licenses and notices.

See [Licensing and reuse](LICENSING.md) for the scope and attribution requirements and the [trademark policy](TRADEMARKS.md) for use of Situate's name and identity. The copyright licenses do not grant permission to impersonate the project or its official services.
