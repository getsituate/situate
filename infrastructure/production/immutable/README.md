# Immutable production host operations

Use the [legacy production runbook](../README.md) until cutover is approved. This runbook does not authorize a build, spend, apply, traffic change, publication or retirement. Qualify the exact image and rehearse storage recovery and traffic changes with synthetic data before scheduling production downtime.

## Build and qualify an image

1. Select a reviewed Git commit. Export only the image source and its shared release validator from that commit: `git archive "$REVISION" infrastructure/production/immutable infrastructure/production/docker/nginx.conf infrastructure/releases/remote.py`. Record the full Git revision and archive SHA-256. Verify the archive before extracting it on a disposable Ubuntu 24.04 amd64 builder. Start the builder from a reviewed, retained numeric base snapshot ID; confirm its ID from the provider. Exclude auto-updating snaps and agents from that base. Use only temporary builder access. Do not grant the builder production access or stage production content, certificates, private keys or credentials there.
2. Review and retain a separate input bundle for this revision and base with the files below. Obtain the complete `.deb` dependency closure from authenticated, versioned package sources; include the Docker Engine, Compose plugin and any required runtime and OS updates. Verify repository signatures and package hashes when collecting packages. Establish the expected final inventory in a disposable trial; use the exact reviewed bundle for the final bake. Do not use a rolling package mirror during the bake.

   | File                                                | Contents (one value per file unless noted)                                                                                                                                |
   | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `revision`                                          | Full Git commit                                                                                                                                                           |
   | `base-image-id`                                     | Numeric provider ID confirmed above                                                                                                                                       |
   | `base-packages-sha256`, `installed-packages-sha256` | SHA-256 of `dpkg-query -W -f='${db:Status-Abbrev}\t${binary:Package}\t${Version}\n' \| LC_ALL=C sort` on the expected base and on the fully installed build, respectively |
   | `packages.sha256`                                   | SHA-256, two spaces and one plain local `.deb` filename per line; retain the named files                                                                                  |
   | `packages-lock-sha256`                              | SHA-256 of the exact `packages.sha256` bytes                                                                                                                              |

3. Run `sudo ./infrastructure/production/immutable/bake.sh /path/to/inputs --confirm-disposable-builder` on the disposable builder. It installs only the locked packages, bakes both digest-pinned amd64 container images and the serving configuration, records `/usr/local/lib/situate/image-provenance`, and clears instance identity. Restrict build egress to the registries needed for the pinned images; no package repository access is needed. Do not continue a failed bake. Remove temporary build inputs and transfer material; check service state, image provenance, access keys, cloud-init seed and disk contents before powering off. Capture a versioned snapshot of the stopped builder. Retain its provider ID, archive and input digests and provenance; use a new snapshot ID for every change. Never snapshot a serving host as an image.
4. In an isolated project/network, boot the **exact** candidate snapshot ID with the [access-only cloud-init](../terraform/immutable-cloud-init.yaml.tftpl), test keys and no production secrets or endpoints. Deny package and registry egress. Verify the SSH host key through an independent channel before connecting. Run `sudo /usr/local/lib/situate/verify-boot.sh REVISION` to check the baked package set, container images, and refusal to serve without a volume. Then demonstrate successful start from those cached images and refusal to start with incorrect or unsettled storage. Exercise the steps below with synthetic website versions, two distinct app publications and isolated TLS material in Caddy's storage layout. Use client-local hostname overrides and test trust, not production DNS or `curl -k`. Verify HTTPS against the exact baked routes. Rehearse interruption, detach/attach, backup restore to a new volume, and failback **after** the second publication. Confirm the first host cannot write or serve stale bytes. Confirm website activation changes neither container IDs nor serving config, TLS state or application feed.

Keep evidence with the private qualification receipt. The wrapper checks receipt bytes and identity, not the quality of the exercise. Create the receipt only after review. It needs `schemaVersion: 1`, `imageId` (numeric ID as a string), `sourceRevision`, and a `gates` object with `offlineBoot`, `storageFence`, `httpsAndRedirects`, `publicationAndFailback`, and `independentRestore` each set to `true`. Keep the receipt private and immutable. Neither local tests nor a successful image bake qualify a snapshot.

## Stage under the production workspace

Use the same initialized, adopted `situate-production` HCP workspace in Local execution; use Terraform 1.10 or later within the root's supported major version. Run `terraform.mjs status` and confirm the immutable workspace ID, current state and lock. Use a private operation log, inventory, qualification receipt and saved plans outside Git (directories `0700`, files `0600`). Retain all previously applied generation entries. In the existing inventory set:

- `qualified_hosts.<generation>` to `image_id`, `source_revision`, `qualification_sha256` (SHA-256 of the receipt), and `operator_public_key` (a separate Ed25519 public key, without its comment). The normal publisher key remains unprivileged at `deploy`; only `situate-ops` has sudo. Confirm the new SSH host key through an independent channel.
- `publication_volumes` to a list including a new name if staging storage. Size the volume against releases, checkpoints, site, TLS and future growth before provisioning. The checked-in size is 50 GiB; changing capacity requires separate review.
- Keep `publication_host`, `publication_volume` and `traffic_host` at their current values. For the first migration only, leave the attachment selectors unset and explicitly select `traffic_host = "legacy"` in the migration checkout below.

Use the commands below separately for each phase. Replace `PHASE` with `stage`, `attach`, `detach` or `traffic`. Supply the final receipt argument only for `stage` when creating a host. Review the exact saved plan, backend binding and HCP state before obtaining apply approval. Resolve unrelated drift before proceeding; never bypass the checker or Terraform locking.

```sh
node infrastructure/production/terraform.mjs immutable-plan PHASE PRIVATE.tfvars.json NEW.tfplan [QUALIFICATION.json]
node infrastructure/production/terraform.mjs show NEW.tfplan
node infrastructure/production/terraform.mjs immutable-apply PHASE NEW.tfplan --confirm-immutable-change [QUALIFICATION.json]
```

Staging does not attach storage, start serving, or move DNS. An attach plan creates exactly one manual attachment for the selected host and volume. A detach plan removes only that attachment. Never combine detach and attach, use force-detach, or mount a clone while the former writer is available. A traffic plan changes only the existing apex A/AAAA records to the attached immutable host. `www`, `reboot` and mail RRSets stay unchanged. A partial A/AAAA change is possible; inspect both authoritative records before resuming writers. A failure or disconnect leaves the outcome uncertain: inspect the HCP lock/state, provider resource and operation journal, and retain before/after state exports. Do not replay a saved plan or force unlock. If state needs reconciliation, review it separately under the same workspace owner.

## Initial handoff and traffic

The normal Terraform root cannot target or recreate the legacy VM. In a dedicated migration checkout, before planning, copy `legacy-migration.tf.example` and `legacy-migration_override.tf.example` from this directory to `infrastructure/production/terraform/` with the `.example` suffix removed. Both files are temporary and must stay out of Git and CI. Confirm the legacy server is already in the authoritative HCP state at `hcloud_server.production`; do not import another server or apply a plan that deletes or replaces it during staging.

1. Agree on a maintenance window and name one operator to control writes, storage and traffic. Time the frozen-state copy and verification in rehearsal and account for the apex DNS TTL (900 seconds by default); clients with stale addresses can see downtime until their caches expire. Pause release automation (including builds, recovery and allocator/checkpoint writers) and website deploys. Disable new legacy publisher access, drain existing sessions and jobs, and settle release claims and pending operations on the old host. Check legacy deploy/proxy/preview pending markers and the release histories using their runbooks. A missing acknowledgement is not a cancellation. Capture independent SHA-256 hashes of both current JSON documents, the current versioned artifacts, and a manifest of the complete frozen `/opt/situate` tree, including pointer and private publisher state. Compare with the live HTTPS responses before fencing the old VM. Do not copy only the public files.
2. Export the frozen distribution tree and the Caddy data volume (`/data`, not `/config`), with symlinks and modes, to an encrypted independent backup. Retain production site sources or the last reviewed static version separately. Prove there are no writes after the export; then stop and power off the legacy VM and confirm its provider state before serving from the new host. Leave it off. Do not route traffic back to its root-disk copy after cutover. Cached DNS may still reach its old addresses; downtime is intentional.
3. Attach the new volume to the selected immutable host using `attach` with `publication_host` and `publication_volume` set. **Only for a newly allocated, verified blank volume**, with separate destructive approval, create an ext4 filesystem on `/dev/disk/by-id/scsi-0HC_Volume_ID` (confirm the exact ID, no signatures, no mounts and the inventory first). Mount temporarily at a root-only scratch mountpoint, set the filesystem root to `root:root` mode `0700`, then unmount. Never format an existing publication or recovery volume.
4. On the selected host as `situate-ops`, `sudo /usr/local/lib/situate/state.sh mount ID`. This mounts the volume at `/srv/situate-state`; it does not expose the publisher path. For initial import only, restore the frozen `/opt/situate` tree into `distribution/` preserving bytes, relative links and modes. Assign UID/GID `1100` to that tree (`distribution/` mode `0755`). Restore Caddy's `/data` into `tls/` (`root:root`, mode `0700`), keep keys private, and confirm certificate validity for apex, `www` and `reboot`. Make `website/versions` root-owned mode `0755`, then use `website.py seed` below. Compare the restored tree with the frozen source inventory; ownership is the only intentional change to distribution. Fail closed on missing state, unknown links/mounts or unverified certificates.
5. With the independently captured website digest and metadata hashes (in download, update order), run the following. Never generate the expected app hashes from an untrusted recovery copy. `bind` exposes a read-only `/opt/situate`; Nginx mounts it read-only even after publishers resume. Starting the service with a missing or writable publication bind is refused. A reboot leaves the volume unmounted and the service stopped; repeat the mount/bind/start gates with current evidence.

   ```sh
   sudo /usr/local/lib/situate/state.sh bind SITE_SHA DOWNLOAD_SHA UPDATE_SHA
   sudo systemctl start situate-serving.service
   ```

6. Test both IPv4 and IPv6 without changing DNS (`curl --resolve` with normal certificate verification). Check apex page, `www` and `reboot` 301 targets including path and query; fetch `/releases/current/download.json`, `/releases/current/update.json` and versioned DMG, updater and signature bytes. Compare exact metadata and artifact hashes, and check mutable `no-store` and immutable artifact caching. Confirm the old host remains fenced. Set `traffic_host` to the attached generation and review/apply `traffic` separately. Repeat the checks using authoritative DNS and public HTTPS. Wait out applicable DNS caching before enabling writes. Confirm publisher destination and verified SSH host key, and only then run `sudo /usr/local/lib/situate/state.sh enable --confirm-publication` and resume publishers.

### Retire the legacy VM

After production acceptance, keep legacy publication fenced. Run `legacy-retirement-begin PROPOSAL.json --confirm-legacy-cutover` with the private journal directory configured. Use the proposal fields below with `previous: "legacy"`, the exact legacy Hetzner ID, and the accepted `candidateId` as a string. Generate and review the `unprotect` plan with both migration files still present and `retiring_generation` set to `legacy`. Supply the same live acceptance evidence required for normal retirement.

Only after unprotect succeeds, remove the two temporary Terraform files and unset `retiring_generation`. Generate and review the `retire` plan; it must delete exactly the legacy server without changing DNS, volume attachment, or publication data. Apply it only with specific deletion approval. Verify the provider deletion and the absence of the server from HCP state. Keep the encrypted independent backup and discard the migration checkout after preserving its private receipts.

## Website-only publication

Build a new static tree in an empty private staging directory using the existing website builder from the reviewed content revision. Use the approved public analytics configuration, if any. For an artifact with analytics disabled, run from the repository root:

```sh
node --input-type=module -e 'import { build } from "./website/site.mjs"; await build(process.argv[1], { analyticsToken: "" })' /new/private/site
```

Record the revision and run `python3 infrastructure/production/immutable/website.py digest /new/private/site`. Transfer only this reviewed static tree to a root-controlled staging directory. The SHA-256 covers paths, entry types and file bytes; symlinks, special files and release routes are rejected. Run on the mounted selected host:

```sh
sudo python3 /usr/local/lib/situate/website.py seed SITE_SHA /root/reviewed-site --confirm-website SITE_SHA
sudo python3 /usr/local/lib/situate/website.py activate SITE_SHA /root/reviewed-site --confirm-website SITE_SHA
```

Use `seed` only for an empty website during initial import; use `activate` for later content changes. Activation copies new bytes into a content-addressed directory and atomically changes `website/current`; omit the path to select a stored website version. It cannot modify app publication or proxy configuration. Verify HTTPS and confirm both current JSON digests are unchanged. `website.pending`, `current.next` or `.incoming-*` behind an interruption block activation. Inspect the journal, pointer and version digests against the original reviewed input. Preserve evidence and reconcile while writers are frozen; never delete a marker to force a retry.

### Enable automatic website publication

The [website workflow](../../../.github/workflows/deploy-website.yml) publishes
the checked build from the latest `main` after **Deploy hosting** succeeds. A
website-only change does not replace the host. A change to the receiver
requires a new image and a qualified host replacement.

Before the first rollout with the receiver, set these GitHub settings:

| Location                                  | Setting                       | Value                                                                                                          |
| ----------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `hosting-production` environment variable | `WEBSITE_CONTENT_PUBLIC_KEY`  | Dedicated Ed25519 public key, without its comment. Enrolled on each replacement; never bake it into the image. |
| `website-production` environment secret   | `WEBSITE_CONTENT_SSH_KEY`     | Matching private key.                                                                                          |
| `website-production` environment variable | `WEBSITE_CONTENT_KNOWN_HOSTS` | Independently verified `@cert-authority getsituate.com` entry for the existing host CA.                        |
| `website-production` environment variable | `WEBSITE_POSTHOG_TOKEN`       | Approved public project token to preserve analytics, or empty to disable it.                                   |
| Repository variable                       | `WEBSITE_DEPLOY_ENABLED`      | Set to `true` after reviewing the first public build and configuring the environment.                          |

Restrict `website-production` to `main`. Keep `PR verification` required on
`main`; no second routine approval is needed for website content. Hosting must
already be migrated and `HOSTING_PRODUCTION_ENABLED` enabled. Configure the
public key **before** deploying the first image with the receiver: changing a
GitHub variable alone does not replace the host. The CI key can invoke only the
website receiver and cannot access the app publisher or the operator shell.

The receiver uses the existing volume and holds the state lock through HTTPS
verification. A confirmed mismatch restores the previous website pointer.
An interrupted upload or inconclusive check may leave `website.pending`
behind and blocks further publication. Freeze writers and reconcile the
journal and both content digests before retrying. After a settled failure,
dispatch **Deploy hosting** against `main` to run the website workflow again.
Neither website deployment nor rollback changes the app update feed.

## Replace, fail back or restore

For a normal replacement, use one operator and a private, durable `SITUATE_ROLLOUT_DIRECTORY` outside Git and outside the two VMs. Do not use a runner's temporary filesystem. Begin with `terraform.mjs rollout-begin PROPOSAL.json` before planning `stage`. The proposal contains `sourceRevision`, `previous`, `previousId`, `candidate`, `volumeId` and `imageId`; provider IDs are strings. Start with the currently serving immutable generation recorded in HCP.

The initial import has no detachable legacy volume and uses only `stage → attach → traffic`, with no rollout journal. The plan checker permits that path while apex records still target the legacy VM, including completion of a partial DNS switch to the same attached candidate. Normal replacements follow the journal below. Supply the same private evidence file to plan and apply; the wrapper checks the record and the plan, not the live host or network observations.

| Phase                      | Required evidence                                                              |
| -------------------------- | ------------------------------------------------------------------------------ |
| `stage`                    | Exact-image qualification receipt. No change to the current volume or traffic. |
| `detach`                   | `replacementReady`, `publishersSettled`, `oldHostFenced`                       |
| `attach`                   | `volumeDetached`                                                               |
| `traffic`                  | `volumeVerified`, `candidateHttpsVerified`                                     |
| `unprotect`, then `retire` | `publicEndpointsVerified`, `publisherTargetVerified`                           |

Each post-stage evidence record contains the journal's `operationId`, the verified `candidateId` as a string, and the named observations set to `true`. Do not enter an observation until independently verified. For `unprotect`, set `retiring_generation` to the previous generation. For `retire`, unset it and remove only that generation from `qualified_hosts`. Preserve the serving generation and volume. An interrupted phase leaves a pending record and cannot be replayed under a new plan. Reconcile against authoritative HCP and provider state before requesting a recovery plan. If HCP advanced exactly one version and the entire attempted plan appears to have applied, run `terraform.mjs rollout-reconcile PHASE ATTEMPTED.tfplan PRIVATE.tfvars.json OBSERVATION.tfplan [QUALIFICATION.json]`. It compares a fresh no-change plan with the exact attempted plan and advances only the journal. It never runs an apply. An unchanged HCP state, partial or unrelated changes, or failed or unknown host operations still require separate recovery. Do not delete the active record to clear a deployment.

Before enabling writes or authorizing retirement, run `node infrastructure/production/immutable/probe.mjs < PRIVATE.json`. Provide `generation`, `serverId`, `imageId`, `sourceRevision`, `volumeId`, `ipv4`, `ipv6`, and the frozen `downloadSha256`, `updateSha256`, `updaterSha256`, and `signatureSha256`. Set `public: true` after the DNS switch. The probe reads Hetzner and checks HTTPS; it cannot confirm SSH publisher access or authorize a phase on its own.

The GitHub hosting check runs without production credentials. It does not build cloud images, deploy, or qualify a production rollout.

- Retain the previous VM until acceptance and keep the previous qualified image after retirement. After staging and verifying the replacement, pause both publishers, settle work, `state.sh freeze` and record `state.sh receipt` off-host. Compare it with public responses and verify artifact hashes. Stop `situate-serving.service`, confirm no listener/containers, `state.sh unmount`, and confirm the old host is fenced (power off if in doubt). Unset both publication selectors and apply `detach`; confirm the provider shows no attached server before applying `attach` elsewhere. Keep `traffic_host` unchanged during these steps: its old target must be fenced, not serving a stale copy. Follow bind, endpoint checks, traffic and resumption gates above on the new writer.
- Fail back only to a compatible qualified immutable host with the **same** authoritative volume, latest settled receipt and verified latest bytes. Before the first immutable cutover, the legacy host may still be the authority; after cutover this path never points DNS at its stale root disk. If the same-volume failback is unavailable, keep traffic paused during recovery. Never switch app versions, copy the old VM's `/opt/situate` over current state, or restore an older feed to shorten downtime.
- Maintain encrypted off-device copies of site versions and pointer, the entire distribution tree (all versioned bytes, manifests, history, allocation/notary records and checkpoints), and Caddy `/data`. Take filesystem-consistent backups with writers stopped and Caddy stopped or from a verified consistent snapshot. Record the latest committed app version, both metadata hashes, artifact hashes and backup identity independently on each publication; keep original publisher journals and evidence when outcome is uncertain. Signing keys remain outside hosting. Keep independent HCP state exports as described in the legacy runbook.
- If the volume is lost, fence the old writer, prove which release last committed using independent publication evidence and recover its exact bytes and matching publisher state. Stage a new named volume, retain the old entry, and restore to the new ext4 volume with no serving bind. Verify the restored inventory, active site and TLS against the latest trusted evidence before binding. If you cannot establish or recover the latest state, or TLS cannot be safely restored, leave traffic and publishers paused. Do not use a snapshot solely because it mounts. No operation automatically retries, force-unmounts or restores an earlier active pointer.

On any uncertain mount, bind, unmount or serving operation, inspect `/run/situate-state`, exact `findmnt` sources/options, volume attachments, container/listener state and the pending publisher records. Host-local markers are not evidence that a provider operation failed. Resolve the state before any detach, remount, traffic or publication action.

## GitHub Actions

A push to `immutable-infrastructure` runs offline checks and then the Hetzner rehearsal. Restrict the `hosting-rehearsal` GitHub environment to that exact branch and set `HCLOUD_REHEARSAL_TOKEN` to a read/write token for an empty test project. The job builds a snapshot, boots two hosts from it, and tests the handoff, failback and restore with synthetic data. It checks HTTPS using runner-local hostname overrides and a test CA, then deletes the test resources. It does not use HCP Terraform or change public DNS. GitHub manual dispatch requires the workflow to exist on the default branch; use pushes while the workflow exists only on this branch.

After the initial migration, restrict the `hosting-production` GitHub environment to protected `main`. The job runs on GitHub's Ubuntu runner and derives the serving generation and volume from the pinned HCP Terraform workspace. Configure `TF_CLOUD_ORGANIZATION` and `SITUATE_HCP_WORKSPACE_ID` as variables and `HCLOUD_TOKEN`, `TF_TOKEN_APP_TERRAFORM_IO`, `HOSTING_OPERATOR_KEY`, `HOSTING_PUBLISHER_KEY`, and `HOSTING_HOST_CA_KEY` as secrets. Set `HOSTING_PRODUCTION_ENABLED=true` only after migration and credential setup. When hosting inputs change on `main`, the runner builds and qualifies the exact revision before staging its replacement. It uses temporary, run-scoped servers, firewalls and volumes with synthetic data in the production Hetzner project because the snapshot must be usable there. It retains only the qualified snapshot and never mounts live storage during qualification. The separate branch rehearsal still uses the empty test project. Keep private state and plan files off GitHub artifacts.

Establish the first immutable host's SSH host CA trust during migration. Configure release publishers to connect to `deploy@getsituate.com` and trust that same host CA. SSH enrollment authenticates each new host before it receives a certificate; the CA private key stays off the web hosts.

### Recover an interrupted deployment

Do not rerun a failed production job. GitHub serializes production jobs; a GitHub deployment record in `hosting-production-operation` blocks subsequent deployments after an interrupted change. Use the logs to locate the failed step, then verify the HCP workspace and lock, the running servers and their delete protection, the volume attachment and mounts in Hetzner, the authoritative A and AAAA records, and live HTTPS. If qualification was interrupted, inspect resources labeled `rehearsal=sit-prod-RUN_ID-RUN_ATTEMPT`. Verify they are not referenced by any live host or Terraform state before cleaning up. The logs are not a recovery point.

Restore one serving immutable generation with its verified current volume and DNS pointing to it. Do not restore an older release feed or lift the predecessor's delete protection just to unblock CI. Keep the GitHub record unresolved while making repairs. Once no job or writer is active and the repaired state is verified, an authorized operator can mark the **exact** unresolved record inactive:

```sh
gh api --method POST repos/getsituate/situate/deployments/DEPLOYMENT_ID/statuses \
  -f state=inactive -F auto_inactive=false
```

This clears the block for a fresh run from settled state; it does not resume a previous phase.

## Offline checks

From the repository root:

```sh
node --test infrastructure/production/{immutable-plan,rollout-journal,rollout-reconcile,terraform}.test.mjs infrastructure/production/immutable/probe.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s infrastructure/production/immutable
shellcheck infrastructure/production/immutable/{bake,state,verify-boot}.sh
docker compose -f infrastructure/production/immutable/compose.yaml config --quiet
terraform -chdir=infrastructure/production/terraform fmt -check
```

These checks use synthetic plan and publication state. They do not exercise a cloud image, a mounted Hetzner volume, Caddy certificate recovery or a traffic switch.
