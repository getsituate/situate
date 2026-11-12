# Production infrastructure

The Terraform root in `terraform/` describes the existing Hetzner server, firewall, SSH key, `getsituate.com` zone and eight application-managed DNS RRSets. It preserves Google Workspace MX, SPF, domain verification and DKIM alongside the website and redirect records, and declares a non-enforcing DMARC policy (`v=DMARC1; p=none`). Hetzner manages the zone's apex NS and SOA records.

Import blocks identify the existing resources; they are not instructions to provision a replacement server. Resource deletion and replacement are protected. The cloud-init template describes fresh-host bootstrap; imported server bootstrap inputs remain ignored and are not replayed during adoption. Cloud adoption does not deploy services, publish applications or change mail-provider accounts. The [former preview](../website/README.md) is retired; the production edge redirects `reboot.getsituate.com` to `getsituate.com`.

## Credentials and inventory

Use the repository's Volta-pinned Node.js, Terraform 1.5+ and the committed provider lockfile. The Node commands read only their required variables from explicitly set environment values or the ignored repository-root `.env`. They parse that file as data, require owner-only permissions, and do not read it in CI. `inspect.mjs` consumes `HCLOUD_TOKEN`; HCP operations in `terraform.mjs` consume `TF_CLOUD_ORGANIZATION` and `TF_TOKEN_app_terraform_io`, with `HCLOUD_TOKEN` added only for plans and adoption. Explicit environment values, including empty ones, take precedence. Direct Terraform commands do not load the repository's `.env`.

The inventory command makes authenticated GET requests only. It exports the existing SSH **public** key and complete TXT RRSets to a new mode-0600 variable file. It rejects missing, duplicate or unrepresented DNS RRSets and never overwrites a file or follows an existing output symlink. TXT record strings retain Hetzner's quoting, including multi-part DKIM values. Empty record comments are normalized to the provider's null representation.

From the repository root:

```sh
node infrastructure/production/inspect.mjs inventory \
  infrastructure/production/terraform/production.tfvars.json
```

Keep inventories, state, saved plans and plan JSON private and outside Git. Review the inventory locally without placing its contents in CI artifacts or logs. Use a new filename for a later snapshot.

## HCP workspace setup

Production state belongs to organization `Situate`, workspace `situate-production` at `app.terraform.io`, using Local execution. The eleven existing resources have been adopted and a subsequent no-change plan verified. Supply `TF_CLOUD_ORGANIZATION=Situate`; do not create a replacement workspace or repeat ownership adoption for host cutover. The following setup instructions apply to recovery or an explicitly approved new workspace:

1. Create a CLI-driven workspace with execution mode **Local**. Terraform runs on the operator's machine; HCP stores and locks state. Do not connect VCS triggers or enable automatic applies.
2. Keep the organization on the Free plan and monitor its resource allowance. This configuration declares twelve resources. Reassess the service before accepting a paid upgrade.
3. Enable MFA, protect account recovery and provide a user or team API token with workspace state read/write permissions. A user token inherits that user's permissions; an owner's token is not restricted to this workspace.
4. Set `TF_CLOUD_ORGANIZATION` and `TF_TOKEN_app_terraform_io` through the environment or private root `.env`. Add `HCLOUD_TOKEN` for plans and adoption, not HCP inspection or state export. Never put tokens in Terraform configuration, command arguments or public logs.

HCP encrypts stored state and uses TLS; this is not end-to-end encryption against the service operator. State may contain sensitive resource attributes. The standard Free service does not establish EU-only residency. See [ADR-0014](../../docs/architecture/09-architecture-decisions/ADR-0014-host-production-state-in-hcp-terraform.adoc) for the decision and recovery boundaries.

`terraform.mjs` inspects the existing workspace using authenticated GET requests. It rejects missing workspaces, inaccessible state versions, remote execution and invalid state metadata. Locked workspaces block operations except the read-only `status` command. It never creates a workspace or changes its settings.

## Inspect adoption without applying

Use a clean checkout with no initialized local backend or local state files. Saved plans and state exports require an owner-only directory outside every Git repository; choose new filenames for each operation.

```sh
node infrastructure/production/terraform.mjs status
node infrastructure/production/terraform.mjs init
node infrastructure/production/terraform.mjs validate
node infrastructure/production/terraform.mjs plan \
  infrastructure/production/terraform/production.tfvars.json /private-plan-directory/adoption.tfplan
```

Initialization associates this checkout with the existing HCP workspace and records its immutable workspace ID in private backend metadata. It does not import infrastructure or migrate existing state. An initialized backend must retain the same organization, workspace ID and metadata; changing targets or recovering an old local backend requires a separately reviewed handoff.

Only continue if planning succeeds. Check the saved plan independently:

```sh
set -o pipefail
terraform -chdir=infrastructure/production/terraform show -json /private-plan-directory/adoption.tfplan \
  | node infrastructure/production/inspect.mjs check-plan
```

The checker accepts exactly the eleven managed resource addresses with imports and no-op actions. It rejects updates, creation, deletion, replacement, unexpected resources and incomplete plans. Even a comment-only DNS update must be reconciled. Review the human-readable plan too. Local inspection plans and plans from another backend cannot be reused for HCP adoption.

An adjacent `.tfplan.state.json` binds the plan hash to the HCP organization, workspace name, immutable workspace ID and current state-version ID/serial. Keep both files private. A replaced workspace, changed state, old local-backend binding or changed plan bytes requires a fresh plan.

## Adoption and recovery

After the approved ownership handoff and a fresh no-change plan against HCP:

```sh
node infrastructure/production/terraform.mjs adopt \
  /private-plan-directory/adoption.tfplan --confirm-ownership-handoff
```

The wrapper rechecks the workspace, plan and binding, retains Terraform's remote locking and stale-plan checks, and writes an adjacent adoption journal before apply. It captures a private state export before the attempt and attempts another afterward, including partial failure. An inaccessible or still-locked workspace can prevent the latter; retain the journal and inspect the remote state. An empty state is recorded as an empty-state observation, not a fake Terraform state file. Completion receives a separate receipt. Existing journals block blind retries; there is no automatic retry or general-purpose apply command.

After interruption or failure, inspect HCP's current state version, locks, the local journal and exports. A disconnected process does not prove that no import occurred. Do not force-unlock a possible active writer. Once the operation has settled, reconcile imported resources and prepare a new reviewed plan rather than replaying the old one or pushing an earlier state over the current version.

Export a recovery copy without cloud-provider credentials:

```sh
node infrastructure/production/terraform.mjs export /private-backup-directory/production.tfstate
```

Exports are plaintext, mode `0600`, outside Git. Capture independent exports before ownership changes and after successful state-changing operations; encrypt them for off-device storage. State/account recovery and independent restoration exercises remain unqualified; verify account recovery access and rehearse restoration from an independent encrypted export before relying on it. Adjacent snapshots and HCP history do not protect against account loss or workspace deletion. Keep independent exports outside the HCP account. Free history is bounded; consult the [state-version retention policy](https://developer.hashicorp.com/terraform/cloud-docs/api-docs/state-versions) rather than assuming indefinite retention.

On a replacement computer, restore account access, credentials and the repository, confirm the same HCP organization/workspace ID, initialize a clean checkout and inspect state before planning. If HCP state is unavailable, freeze writers and review the chosen export's lineage, serial and resource identities before explicitly authorized restoration. Never automatically replace remote state or treat an export as a second active backend.

## GitHub Actions boundary

A future trusted GitHub Actions job can use the same Local execution workspace. Supply tokens through protected environment secrets, serialize infrastructure writers and require explicit production approval. Never expose credentials or state to fork/untrusted PR jobs or upload state, plans or private inventories as public artifacts. Adoption tooling does not install such a workflow or authorize CI applies. Website and app publication remain separate from Terraform operations.

## Transfer ownership

A resource must have exactly one active Terraform owner. Before any state-changing operation:

1. Obtain approval for the exact state handoff and freeze writers for both the previous production root and `infrastructure/website/terraform/`.
2. Locate their authoritative states and back them up privately, including lineage, serial and backend configuration. Absence of a local state file is not proof that a resource is unowned.
3. Configure and verify the HCP workspace, account recovery and independent state exports described above before transferring ownership. Keep normal remote locking and distinguish exports or disposable inspection state from the authoritative HCP backend.
4. If an authoritative state is recoverable, transfer it using Terraform's state/backend migration facilities in a separately reviewed operation; the adoption wrapper refuses automatic local-to-HCP migration. Existing server, firewall, key, zone and website-record addresses are retained. `moved` blocks rename the former `null_mx` and `spf` resource addresses without replacing their live RRSets. If an authoritative state cannot be recovered, establish that no other active owner remains before importing.
5. Transfer the `reboot` RRSet from the preview state, or explicitly remove its old state ownership without destroying the record before importing it here. Do not leave two active states managing it. Retire the superseded DNS root, wrapper and old deployment automation in the same authorized handoff; leaving runnable old configuration permits ownership to be recreated accidentally.
6. Generate a fresh plan against the chosen backend, run the no-change check and review it. Apply only that newly reviewed plan with explicit approval. Then verify the authoritative DNS responses, mail records, HTTPS site, reboot redirect and active state ownership.

Do not combine ownership adoption with provider upgrades, operating-system changes, SSH rotation, proxy replacement or website cutover. `prevent_destroy` is an additional guard, not a substitute for state backups and plan review. Later intentional infrastructure changes require their own reviewed plans; the adoption check deliberately rejects them. This includes creating the DMARC RRSet: the adoption inventory and checker cover only the eleven original resources, not subsequent additions. The wrapper has no general-purpose apply command.

## Production services and traffic activation

`docker/compose.yaml` runs a non-root, read-only Nginx service on the existing external `getsituate_default` network. It mounts `/opt/situate` read-only for the [application publisher](../releases/README.md). Immutable artifacts live under `/opt/situate/releases/<version>/`; `/opt/situate/current-release` points to that version's `metadata/` directory. Nginx exposes only the two current JSON endpoints and safe versioned artifact filenames, not journals, staging directories or directory listings. Mutable metadata is not cached; versioned artifact URLs are immutable. Access logs and download tracking are disabled; Compose bounds operational logs to three 10 MiB files per container.

`docker/edge-compose.yaml` describes the Caddy edge for deliberate relocation and recovery. Its stable installation is `/opt/situate-production/edge/{compose.yaml,Caddyfile}`, independent of website release directories. It reuses the existing certificate/config volumes and network. Normal feed and website activation reloads the running proxy without recreating it. The canonical Caddyfile redirects both `www.getsituate.com` and `reboot.getsituate.com` to the apex with HTTP 301, preserving paths and query strings. Do not restore the retired `/config/sites/reboot.caddy` snippet alongside that configuration. Never run `down -v`, prune the certificate volumes or remove legacy containers as an incidental part of deployment.

The server needs Bash, Docker Compose, GNU coreutils/tar, flock and Python 3. Use `WEBSITE_DEPLOY_HOST` and optional `WEBSITE_SSH_IDENTITY`, with a previously verified SSH host key. Docker access is effectively root access. The following operations have different effects and need separate approval:

```sh
node infrastructure/production/deploy.mjs check
node infrastructure/production/deploy.mjs prepare
node infrastructure/production/deploy.mjs deploy
node infrastructure/production/deploy.mjs edge --confirm-domain getsituate.com
node infrastructure/production/deploy.mjs feeds --confirm-domain getsituate.com
node infrastructure/production/deploy.mjs activate --confirm-domain getsituate.com --confirm-public-content
```

- `check` builds locally and validates both Compose files; it does not contact the host.
- `prepare` runs the supplied host-preparation script with non-interactive sudo. It requires the existing network/volumes and creates deploy-owned storage, including the stable edge directory; it does not install packages or switch traffic.
- `deploy` builds and uploads a fresh website service release, then health-checks it before moving its current pointer. Once the proxy targets this service, subsequent deployments change the live website. This command is not an inert staging operation. The previous website service is restored on a catchable activation failure; interrupted/failed recovery leaves markers that block retries.
- `edge` relocates the running Caddy configuration into the stable edge directory and recreates only Caddy with the pinned edge Compose definition. Deploy the website service first to supply the relocation script; this does not require switching the apex website. Relocation preserves the complete current configuration, imported snippets, certificates, network and other containers. It never installs the canonical apex routes, pulls an image or removes orphans. The previous Compose file must remain available for recovery. A previously relocated edge is validated without recreation; this command is not an edge-upgrade workflow.
- `feeds` adds only the new `/releases/*` route to the complete existing Caddy configuration, preserving the current apex website. Published metadata must already be reachable through the new Nginx service. This supports separately approved native A/B qualification before website cutover.
- `activate` installs the canonical apex/`www` configuration. It requires the explicit public-content confirmation and healthy release metadata. It backs up and validates the complete proxy configuration and preserves the bind-mounted file inode during reload. An unresolved `proxy.pending` or `edge.pending` blocks further changes.

Before `activate`, review public claims and the website/app [privacy disclosures](../../website/legal/review.md) against the actual release. Obsolete recruiting pages and campaign redirects are not hosted by the canonical configuration; no public-page preparation is required.

Preserve recoverable copies of new `/opt/situate` artifacts and publication records, `/opt/situate-production` configuration, shared Caddy volumes and the proxy's actual bind-mounted configuration. Preserve HCP state, signing keys and their existing backups. Verify account access and backup readability independently. Rehearse state restoration and fresh-host service recovery in an isolated environment before relying on them; these exercises remain unqualified. Follow [signing-key recovery](../releases/README.md#signing-key-recovery) for signing incidents. Prototype site/counter content and data are intentionally discarded: no full prototype backup, restore exercise, backup service or data migration is required. This does not authorize deleting unknown content or unresolved operation evidence. Verify disk space before publication; do not automatically delete immutable releases to make room. After SSH interruption inspect `current`, `current.next`, `deploy.pending`, `proxy.pending`, `edge.pending`, backups and running containers before retrying. A disconnected local process does not establish the remote outcome. Website service recovery never rewinds the application feed. Application defects are corrected through higher-version releases only.

### Edge relocation and recovery

Freeze previous deployment writers before relocation. Proxy operations use `/opt/situate-production/edge.lock`; while `/opt/getsituate` exists they also acquire its legacy deployment lock. Removing that directory after retirement does not require creating a replacement legacy lock. Production website activation and relocation also share the production deployment lock.

Relocation rejects interrupted operations, unknown configuration mounts, missing recovery definitions and pre-existing destination files. It validates the unchanged configuration in the running proxy before recreation. A catchable failure attempts to recreate only Caddy from the previous Compose file, confirms the old mount and validates its configuration. Successful recovery clears its marker and newly installed edge files; failed recovery retains `edge.pending`. Backups record the original configuration, Compose definition and source paths under a private `edge-backup.*` directory. They are local recovery material, not an encrypted off-device backup.

After interruption, inspect the marker, backup, original files and actual container mount before deciding whether the old or relocated edge is active. Do not rerun relocation, delete its marker, remove the original release or overwrite destination files while the outcome is uncertain. Validate and restore the chosen configuration and service first. Clear pending evidence only after confirming recovery and that no earlier operation remains active.

For fresh-host recovery, restore the external volumes/network and reviewed site/artifact data first. Install the reviewed Caddy configuration as `/opt/situate-production/edge/Caddyfile` and this repository's `docker/edge-compose.yaml` as `/opt/situate-production/edge/compose.yaml`. With separately approved deployment, validate that Compose file, obtain its pinned Caddy image and start only `caddy` with `--no-deps`, retaining the external volumes. Relocation itself requires an existing proxy and is not a fresh-host bootstrap command. Validate routing, certificates and metadata afterward. Host recreation uses the cloud-init template only after a separately reviewed replacement plan, never as part of resource adoption.

### Retiring prototype hosting

Retirement is a separate destructive operation, not part of deploy or relocation. Freeze all old writers, finish edge relocation, activate the reviewed website and publish working production release metadata first. Verify mail DNS and any retained preview/test-feed service separately. Prototype data is deliberately discarded without migration or a full backup; deleting prototype files ends recovery through its previous Compose definition. Keep the stable edge configuration and shared certificates recoverable.

After separately authorizing host access, create a private inventory outside Git and review **every** listed container and file as disposable prototype material:

```sh
umask 077
node infrastructure/production/deploy.mjs inventory > /private-directory/prototype-inventory.json
# Review the known container IDs before authorizing their shutdown.
node infrastructure/production/deploy.mjs quiesce /private-directory/prototype-inventory.json \
  --confirm-host getsituate-production --confirm-discard-prototype
node infrastructure/production/deploy.mjs inventory > /private-directory/prototype-stopped-inventory.json
# Review every file in the stopped inventory before authorizing destruction.
node infrastructure/production/deploy.mjs retire /private-directory/prototype-stopped-inventory.json \
  --confirm-host getsituate-production --confirm-discard-prototype
```

All three commands run through `sudo -n python3` and require root. The counter directory is owned by UID 10001 and cannot be completely inventoried by the deploy user. Noninteractive sudo must already be authorized; tooling does not change sudo policy or directory permissions. Scans use explicit directory traversal that fails on unreadable subtrees before any stop/removal. Missing lock files inherit their parent directory's owner so subsequent deploy-user operations remain possible.

Inventory does not change traffic, stop services or delete content; it only creates missing lock files. It lists exactly services `site` (`getsituate-site-1`) and `download-counter` (`getsituate-download-counter-1`) from project `getsituate`, plus the exact `/opt/getsituate` tree with streamed file hashes and symlink targets. Unknown service names or container names in that project block the operation, even without a prototype mount. Preserve unfamiliar services and unknown content separately; never approve them merely because they appear in an inventory. Apple `.p8` keys, names containing `tfstate`, other key/state/credential-like filenames, special files, hard links and nested mounts block inventory rather than being silently discarded.

Retirement checks the exact hostname and unchanged inventory under the legacy, edge, production, publication and preview locks. It refuses unresolved pending/next markers in these deployment trees. It verifies the actual stable Caddy mount, shared certificate/config volumes and network, canonical website configuration, active Caddy admin routes, healthy new website service and distribution mount. Routes referencing prototype names, aliases or IP addresses and retained containers mounting prototype files block deletion. Public HTTPS checks cover the home page and both release metadata endpoints. Obsolete recruiting/campaign URLs are not activation or retirement prerequisites. These checks establish reachability, not legal approval, artifact signatures or native update qualification.

`quiesce` binds approval to the reviewed container IDs, not the changing counter file hashes. After new-service checks it writes `retirement.pending`, stops only those containers and verifies their stopped state and the retained services. It removes no containers or files and renames its marker to `retirement-quiesced.json`. Generate and review a fresh inventory afterward to capture final counter writes. Do not restart the prototype between that inventory and retirement.

`retire` refuses running prototype containers and any file-inventory change before writing its marker. It then writes `retirement.pending`, removes only the exact already-stopped container IDs **without volumes**, rechecks new-service routes and mounts, and unlinks the exact inventoried prototype files and directories. It removes `/opt/getsituate` last and renames the marker to `retirement.complete.json`. Images, named volumes, the shared network, preview/test-feed services and `/opt/situate` artifacts are not deleted. No Compose teardown, orphan removal or Docker pruning runs. Cleanup of separate test-feed services, unused images or leftover named prototype volumes requires its own inventory and approval; this command does not guess their ownership.

Any failure after the marker is written leaves it in place, including partial container/file removal. There is no automatic rollback, retry or recreation of discarded content. After interruption, inspect that marker, container IDs, remaining paths, active routes and new endpoints before explicitly reconciling the operation. For an interrupted quiesce, confirm every inventoried container is stopped and the new endpoints still work; preserve the journal as a private recovery receipt before explicitly clearing the marker and generating a fresh inventory. Do not restart a counter merely to replay shutdown. For interrupted removal, establish which IDs/files remain, preserve the journal, resolve unknown writers/content and generate a fresh inventory only after explicit reconciliation. File changes after quiesce block destruction instead of discarding unreviewed bytes. Production and preview proxy commands refuse a retained retirement marker. Never delete the marker merely to unblock a command; a failed SSH request can have completed some or all destructive steps.

## Verification

```sh
node --test infrastructure/production/inspect.test.mjs
terraform -chdir=infrastructure/production/terraform fmt -check
terraform -chdir=infrastructure/production/terraform validate
```

Unit tests use synthetic inventories and plan JSON; they do not qualify a live state migration, resource update or service deployment.
