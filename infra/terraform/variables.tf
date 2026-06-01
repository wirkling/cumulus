variable "hcloud_token" {
  description = "Hetzner Cloud API token (dedicated throwaway project)."
  type        = string
  sensitive   = true
}

variable "ssh_public_key" {
  description = "SSH public key registered on all servers for access/debug."
  type        = string
}

variable "repo_clone_url" {
  description = "Git URL to clone. For a private repo, embed a token, e.g. https://x-access-token:GHTOKEN@github.com/wirkling/cumulus.git"
  type        = string
  default     = "https://github.com/wirkling/cumulus.git"
}

variable "repo_branch" {
  description = "Branch to deploy."
  type        = string
  default     = "main"
}

variable "api_server_type" {
  description = "Server type for the always-on API host."
  type        = string
  default     = "cpx22" # 2 vCPU / 4 GB
}

variable "api_location" {
  description = "Hetzner location for the API host."
  type        = string
  default     = "fsn1"
}

variable "node_server_type" {
  description = "Server type for disposable fleet nodes."
  type        = string
  default     = "cpx11" # cheap, disposable
}

variable "node_locations" {
  description = "One fleet node is created per entry; spread across ≥2 regions (spec DoD)."
  type        = list(string)
  default     = ["fsn1", "hel1", "fsn1"]
}

# ── Secrets injected into the API env file (server-side only) ─────────────────
variable "database_url" {
  description = "Supabase Postgres direct connection string."
  type        = string
  sensitive   = true
}

variable "supabase_url" {
  description = "Supabase project URL."
  type        = string
  default     = ""
}

variable "supabase_service_role_key" {
  description = "Supabase service_role key — API VPS only, never client."
  type        = string
  sensitive   = true
  default     = ""
}

variable "agent_bootstrap_token" {
  description = "Token agents present to /api/agent/register to be issued a per-node token."
  type        = string
  sensitive   = true
}

variable "operator_api_key" {
  description = "Guards /api/operator/*; the dashboard holds this server-side."
  type        = string
  sensitive   = true
}
