#!/usr/bin/env bash
# Show what's running: Terraform-tracked servers, the API URL, and a live health
# + node-count check.
set -euo pipefail
cd "$(dirname "$0")/../terraform"

echo "── Terraform-managed servers ──────────────────────────────"
terraform state list 2>/dev/null | grep 'hcloud_server' || echo "(none — not deployed)"

URL="$(terraform output -raw api_url 2>/dev/null || true)"
if [ -z "$URL" ]; then
  echo
  echo "API not deployed yet. Run 'terraform apply' in infra/terraform."
  exit 0
fi

echo
echo "── Control plane ──────────────────────────────────────────"
echo "URL: $URL"
printf "health: "
curl -s -m 8 "$URL/health" 2>/dev/null || echo "(unreachable — Caddy may still be issuing the TLS cert)"
echo

# Node count via the operator API (key comes from terraform.tfvars).
KEY="$(grep -E '^operator_api_key' terraform.tfvars 2>/dev/null | sed -E 's/.*"(.*)".*/\1/' || true)"
if [ -n "$KEY" ]; then
  printf "nodes registered: "
  curl -s -m 8 -H "x-operator-key: $KEY" "$URL/api/operator/nodes" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d), '('+', '.join(sorted(n['status'] for n in d))+')' if d else '(asleep / none)')" 2>/dev/null \
    || echo "(could not query)"
fi
