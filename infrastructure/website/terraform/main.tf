terraform {
  required_version = ">= 1.5.0, < 2.0.0"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "1.68.0"
    }
  }
}

provider "hcloud" {}

data "hcloud_zone" "existing" {
  name = "getsituate.com"
}

resource "hcloud_zone_rrset" "reboot" {
  zone = data.hcloud_zone.existing.id
  name = "reboot"
  type = "CNAME"
  ttl  = 300

  records = [{ value = "getsituate.com." }]
}
