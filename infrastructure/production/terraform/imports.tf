import {
  to = hcloud_server.production
  id = "163944733"
}

import {
  to = hcloud_firewall.production
  id = "11538639"
}

import {
  to = hcloud_ssh_key.production
  id = "118079158"
}

import {
  to = hcloud_zone.production
  id = "1500768"
}

import {
  to = hcloud_zone_rrset.apex_ipv4
  id = "1500768/@/A"
}

import {
  to = hcloud_zone_rrset.apex_ipv6
  id = "1500768/@/AAAA"
}

import {
  to = hcloud_zone_rrset.www
  id = "1500768/www/CNAME"
}

import {
  to = hcloud_zone_rrset.reboot
  id = "1500768/reboot/CNAME"
}

import {
  to = hcloud_zone_rrset.mail
  id = "1500768/@/MX"
}

import {
  to = hcloud_zone_rrset.apex_txt
  id = "1500768/@/TXT"
}

import {
  to = hcloud_zone_rrset.google_dkim
  id = "1500768/google._domainkey/TXT"
}

moved {
  from = hcloud_zone_rrset.null_mx
  to   = hcloud_zone_rrset.mail
}

moved {
  from = hcloud_zone_rrset.spf
  to   = hcloud_zone_rrset.apex_txt
}
