terraform {
  required_version = ">= 1.5.0, < 2.0.0"

  cloud {
    hostname = "app.terraform.io"
    workspaces {
      name = "situate-production"
    }
  }

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "1.68.0"
    }
  }
}

provider "hcloud" {}

locals {
  labels = {
    application = "getsituate"
    environment = "production"
    managed_by  = "terraform"
  }
}

resource "hcloud_ssh_key" "production" {
  name       = "getsituate-production"
  public_key = var.ssh_public_key
  labels     = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_firewall" "production" {
  name   = "getsituate-production"
  labels = local.labels

  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  dynamic "rule" {
    for_each = toset(["22", "80", "443"])
    content {
      direction  = "in"
      protocol   = "tcp"
      port       = rule.value
      source_ips = ["0.0.0.0/0", "::/0"]
    }
  }

  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_server" "production" {
  name         = "getsituate-production"
  server_type  = "cx23"
  location     = "nbg1"
  image        = "ubuntu-24.04"
  backups      = true
  firewall_ids = [hcloud_firewall.production.id]
  labels       = local.labels
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    ssh_public_key = var.ssh_public_key
  })

  delete_protection  = true
  rebuild_protection = true

  lifecycle {
    prevent_destroy = true
    # Bootstrap inputs cannot be recovered through the server read API.
    ignore_changes = [user_data, ssh_keys]
  }
}

resource "hcloud_zone" "production" {
  name              = "getsituate.com"
  mode              = "primary"
  ttl               = 900
  delete_protection = true
  labels            = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_zone_rrset" "apex_ipv4" {
  zone    = hcloud_zone.production.id
  name    = "@"
  type    = "A"
  ttl     = 900
  records = [{ value = hcloud_server.production.ipv4_address }]

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_zone_rrset" "apex_ipv6" {
  zone    = hcloud_zone.production.id
  name    = "@"
  type    = "AAAA"
  ttl     = 900
  records = [{ value = hcloud_server.production.ipv6_address }]

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_zone_rrset" "www" {
  zone    = hcloud_zone.production.id
  name    = "www"
  type    = "CNAME"
  ttl     = 900
  records = [{ value = "getsituate.com." }]

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_zone_rrset" "reboot" {
  zone    = hcloud_zone.production.id
  name    = "reboot"
  type    = "CNAME"
  ttl     = 300
  records = [{ value = "getsituate.com." }]

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_zone_rrset" "mail" {
  zone    = hcloud_zone.production.id
  name    = "@"
  type    = "MX"
  ttl     = 60
  records = [{ value = "1 smtp.google.com." }]

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_zone_rrset" "apex_txt" {
  zone    = hcloud_zone.production.id
  name    = "@"
  type    = "TXT"
  ttl     = 60
  records = var.apex_txt_records

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_zone_rrset" "dmarc" {
  zone    = hcloud_zone.production.id
  name    = "_dmarc"
  type    = "TXT"
  ttl     = 300
  records = [{ value = "\"v=DMARC1; p=none\"" }]

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_zone_rrset" "google_dkim" {
  zone    = hcloud_zone.production.id
  name    = "google._domainkey"
  type    = "TXT"
  ttl     = 60
  records = var.google_dkim_records

  lifecycle {
    prevent_destroy = true
  }
}
