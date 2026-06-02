#!/usr/bin/env bash
# Sleep mode: destroy the fleet nodes to stop their billing, but keep the
# always-on API host up (stable sslip.io URL, dashboard keeps working, shows 0
# nodes). State lives in Supabase, so nothing is lost. Wake with wake.sh.
set -euo pipefail
cd "$(dirname "$0")/../terraform"

echo "😴 Putting Cumulus to sleep — destroying fleet nodes, keeping the API host…"
terraform apply -auto-approve -var='fleet_enabled=false'
echo
echo "Asleep. The API host is still serving (0 nodes). Run scripts/wake.sh to bring the fleet back."
