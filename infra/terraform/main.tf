locals {
  # Map Hetzner locations → lat/long + city, so each node self-declares a real
  # location. This is the ONLY place geography is tied to Hetzner; the app sees
  # only generic lat/long (spec §3.2/§3.3).
  geo = {
    fsn1 = { lat = 50.4779, lng = 12.3713, city = "Falkenstein" }
    nbg1 = { lat = 49.4521, lng = 11.0767, city = "Nuremberg" }
    hel1 = { lat = 60.1699, lng = 24.9384, city = "Helsinki" }
  }
}

resource "hcloud_ssh_key" "operator" {
  name       = "cumulus-operator"
  public_key = var.ssh_public_key
}

# ── Always-on API host (control plane + background workers) ───────────────────
resource "hcloud_server" "api" {
  name        = "cumulus-api"
  server_type = var.api_server_type
  location    = var.api_location
  image       = "ubuntu-24.04"
  ssh_keys    = [hcloud_ssh_key.operator.id]
  labels      = { role = "api", project = "cumulus" }

  user_data = templatefile("${path.module}/cloud-init/api.yaml.tftpl", {
    repo_clone_url = var.repo_clone_url
    repo_branch    = var.repo_branch
    api_env_b64 = base64encode(join("\n", [
      "PORT=8080",
      "NODE_ENV=production",
      "DATABASE_URL=${var.database_url}",
      "SUPABASE_URL=${var.supabase_url}",
      "SUPABASE_SERVICE_ROLE_KEY=${var.supabase_service_role_key}",
      "AGENT_BOOTSTRAP_TOKEN=${var.agent_bootstrap_token}",
      "OPERATOR_API_KEY=${var.operator_api_key}",
    ]))
  })
}

# ── Disposable fleet nodes across ≥2 regions ──────────────────────────────────
resource "hcloud_server" "node" {
  # Sleep switch: 0 nodes when the fleet is disabled, keeping the API host up.
  count       = var.fleet_enabled ? length(var.node_locations) : 0
  name        = "cumulus-node-${count.index}-${var.node_locations[count.index]}"
  server_type = var.node_server_type
  location    = var.node_locations[count.index]
  image       = "ubuntu-24.04"
  ssh_keys    = [hcloud_ssh_key.operator.id]
  labels      = { role = "node", project = "cumulus" }

  # Nodes need the API's public address (sslip.io TLS hostname).
  depends_on = [hcloud_server.api]

  user_data = templatefile("${path.module}/cloud-init/node.yaml.tftpl", {
    repo_clone_url = var.repo_clone_url
    repo_branch    = var.repo_branch
    node_env_b64 = base64encode(join("\n", [
      "CONTROL_PLANE_URL=https://${replace(hcloud_server.api.ipv4_address, ".", "-")}.sslip.io",
      "AGENT_BOOTSTRAP_TOKEN=${var.agent_bootstrap_token}",
      "NODE_TYPE=vpc",
      "NODE_NAME=cumulus-node-${count.index}-${var.node_locations[count.index]}",
      "AGENT_REGION=hetzner-${var.node_locations[count.index]}",
      "AGENT_CITY=${local.geo[var.node_locations[count.index]].city}",
      "AGENT_LAT=${local.geo[var.node_locations[count.index]].lat}",
      "AGENT_LNG=${local.geo[var.node_locations[count.index]].lng}",
    ]))
  })
}
