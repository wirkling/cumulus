output "api_ip" {
  description = "Public IP of the API host."
  value       = hcloud_server.api.ipv4_address
}

output "api_url" {
  description = "HTTPS base URL of the control plane (Caddy TLS via sslip.io)."
  value       = "https://${replace(hcloud_server.api.ipv4_address, ".", "-")}.sslip.io"
}

output "node_ips" {
  description = "Public IPs of the fleet nodes (for SSH/debug; agents are outbound-only)."
  value       = { for s in hcloud_server.node : s.name => s.ipv4_address }
}

output "dashboard_env_hint" {
  description = "Set these in Vercel for the dashboard."
  value       = "API_BASE_URL=https://${replace(hcloud_server.api.ipv4_address, ".", "-")}.sslip.io  (and OPERATOR_API_KEY server-side)"
}
