# Retired preview hosting

`https://reboot.getsituate.com` redirects permanently (301) to `https://getsituate.com`, preserving the path and query string. HTTP requests first upgrade to HTTPS. The [production Caddyfile](../production/docker/Caddyfile) owns the redirect; no preview container is needed.

The separate `situate-reboot` website, its updater-test feed and `/opt/situate-reboot` storage have been removed. Preview releases and test artifacts are no longer available. Production app releases under `/opt/situate`, the shared Docker network, Caddy volumes and TLS certificates remain separate. External waitlist services are unaffected.

Use the [production deployment guide](../production/README.md#production-services-and-traffic-activation) for website updates, SSH configuration and recovery. `deploy.mjs deploy`, `proxy` and `rollback` in this directory reject operations before loading credentials or connecting to the host. The development console's old landing-page deployment action also fails with this retirement message; it does not deploy production.

`deploy.mjs check` remains a local build and Compose check. Shared configuration and archive helpers are still used by production tooling. The remaining preview shell scripts and Compose definition are legacy fixtures, not an active deployment path; do not recreate `/opt/situate-reboot` or restore `/config/sites/reboot.caddy` from an old backup. A restored preview snippet would conflict with the canonical redirect.

The `reboot` CNAME remains managed by the [production Terraform root](../production/terraform/). No DNS change is needed for the redirect. The former `dns.mjs` command rejects operations without loading credentials, and the old Terraform configuration blocks initialization with released Terraform versions. Reconcile any recovered state with the production workspace rather than applying it.

After edge recovery or website activation, verify the reboot HTTPS response is 301 with the expected production `Location`, including a path and query string. Check that the production home page and both `/releases/current/{download,update}.json` endpoints still respond successfully.
