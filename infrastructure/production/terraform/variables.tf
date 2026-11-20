variable "ssh_public_key" {
  description = "Public key of the existing production SSH key. Never supply a private key."
  type        = string
}

variable "apex_txt_records" {
  description = "Complete existing apex TXT RRSet, including SPF and domain verification. Values retain Hetzner's quoted TXT format."
  type = set(object({
    value   = string
    comment = optional(string)
  }))
}

variable "google_dkim_records" {
  description = "Complete existing Google DKIM RRSet in Hetzner's quoted TXT format."
  type = set(object({
    value   = string
    comment = optional(string)
  }))
}
