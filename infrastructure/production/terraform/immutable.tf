variable "qualified_hosts" {
  description = "Retained immutable generations, keyed by a unique short name. Copy only from a reviewed exact-image qualification receipt."
  type = map(object({
    image_id             = string
    source_revision      = string
    qualification_sha256 = string
    operator_public_key  = string
  }))
  default  = {}
  nullable = false

  validation {
    condition = alltrue([for generation, host in var.qualified_hosts : try(
      !contains(["legacy", "production"], generation) &&
      can(regex("^[a-z][a-z0-9-]{0,19}$", generation)) &&
      can(regex("^[1-9][0-9]{0,14}$", host.image_id)) &&
      can(regex("^[0-9a-f]{40}$", host.source_revision)) &&
      can(regex("^[0-9a-f]{64}$", host.qualification_sha256)) &&
      can(regex("^ssh-ed25519 [A-Za-z0-9+/]{68}$", host.operator_public_key)), false)
    ])
    error_message = "Each generation requires a numeric snapshot ID, full Git revision, qualification receipt digest and uncommented Ed25519 operator public key."
  }
}

variable "enrollment_tokens" {
  description = "Short-lived host identity capabilities for new instances only."
  type        = map(string)
  sensitive   = true
  default     = {}

  validation {
    condition     = alltrue([for token in values(var.enrollment_tokens) : can(regex("^[0-9a-f]{64}$", token))])
    error_message = "Use a 256-bit hexadecimal enrollment capability for each candidate."
  }
}

variable "retiring_generation" {
  description = "Generation named in the accepted rollout for retirement. Leave unset otherwise."
  type        = string
  default     = null
}

variable "publication_volumes" {
  description = "Retained publication volumes. Stage one first; add another only for a separately approved recovery."
  type        = set(string)
  default     = []
  nullable    = false

  validation {
    condition     = alltrue([for name in var.publication_volumes : can(regex("^[a-z][a-z0-9-]{0,19}$", name))])
    error_message = "Use short lowercase generation names for publication volumes."
  }
}

variable "publication_volume" {
  description = "Name of the one volume eligible for attachment. Set with publication_host."
  type        = string
  default     = null
}

variable "publication_host" {
  description = "One immutable generation allowed to attach the publication volume, or null for detached."
  type        = string
  default     = null
}

variable "traffic_host" {
  description = "Immutable generation receiving apex traffic."
  type        = string
  nullable    = false
}

resource "hcloud_server" "immutable" {
  for_each     = var.qualified_hosts
  name         = "getsituate-${each.key}"
  server_type  = "cx23"
  location     = "nbg1"
  image        = each.value.image_id
  firewall_ids = [hcloud_firewall.production.id]
  labels = merge(local.labels, {
    source_revision = each.value.source_revision
    # Hetzner label values are limited to 63 characters.
    qualification_a = substr(each.value.qualification_sha256, 0, 32)
    qualification_b = substr(each.value.qualification_sha256, 32, 32)
  })
  user_data = templatefile("${path.module}/immutable-cloud-init.yaml.tftpl", {
    ssh_public_key      = var.ssh_public_key
    operator_public_key = each.value.operator_public_key
    enrollment_token    = lookup(var.enrollment_tokens, each.key, "")
  })
  delete_protection  = each.key != var.retiring_generation
  rebuild_protection = true

  lifecycle {
    # Instance bootstrap is written only on creation, never refreshed in place.
    ignore_changes = [user_data]
    precondition {
      condition     = each.key != var.retiring_generation || (each.key != var.traffic_host && each.key != var.publication_host)
      error_message = "The serving or attached generation cannot be retired."
    }
    precondition {
      condition     = !strcontains(var.ssh_public_key, split(" ", each.value.operator_public_key)[1])
      error_message = "The privileged operator and unprivileged publisher must use separate keys."
    }
  }
}

resource "hcloud_volume" "publication" {
  for_each          = var.publication_volumes
  name              = "getsituate-publication-${each.key}"
  location          = "nbg1"
  size              = 50
  delete_protection = true
  labels            = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_volume_attachment" "publication" {
  count     = var.publication_host == null ? 0 : 1
  volume_id = hcloud_volume.publication[var.publication_volume].id
  server_id = hcloud_server.immutable[var.publication_host].id
  automount = false
}

locals {
  traffic_ipv4 = hcloud_server.immutable[var.traffic_host].ipv4_address
  traffic_ipv6 = hcloud_server.immutable[var.traffic_host].ipv6_address
}
