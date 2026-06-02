#!/usr/bin/env bash
# Wake mode: recreate the fleet nodes. They boot, install, and re-register with
# the (unchanged) control plane within ~2-3 minutes.
set -euo pipefail
cd "$(dirname "$0")/../terraform"

echo "☀️  Waking Cumulus — recreating fleet nodes…"
terraform apply -auto-approve -var='fleet_enabled=true'
echo
URL="$(terraform output -raw api_url 2>/dev/null || true)"
echo "Awake. Nodes will register in ~2-3 min."
[ -n "$URL" ] && echo "Control plane: $URL"
