terraform {
  required_version = ">= 1.5"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
  }
}

# Provider-specific code lives ONLY in infra/ (spec §3.3). The control plane,
# agent, and dashboard never reference Hetzner.
provider "hcloud" {
  token = var.hcloud_token
}
