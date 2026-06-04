#!/usr/bin/env bash
# Join ANY GPU box (RunPod / Scaleway / Vast / Lambda / dedicated) to the Cumulus
# pool. The agent is outbound-only + provider-neutral, so no Terraform: run this
# on a fresh Ubuntu GPU instance (NVIDIA driver + CUDA already present, which the
# GPU cloud images ship) and it registers itself, advertising the `gpu` executor.
#
# Required env:
#   CONTROL_PLANE_URL      e.g. https://167-233-49-8.sslip.io
#   AGENT_BOOTSTRAP_TOKEN  the same bootstrap token the fleet uses
# Optional env:
#   NODE_NAME, AGENT_REGION, AGENT_CITY, AGENT_LAT, AGENT_LNG
#   LLM_GGUF_URL_GPU       override the GPU model (default Qwen2.5-7B-Instruct Q4)
#
# Usage:
#   export CONTROL_PLANE_URL=https://<host> AGENT_BOOTSTRAP_TOKEN=<token>
#   curl -fsSL https://raw.githubusercontent.com/wirkling/cumulus/main/infra/scripts/join-gpu-node.sh | bash
set -euo pipefail

: "${CONTROL_PLANE_URL:?set CONTROL_PLANE_URL}"
: "${AGENT_BOOTSTRAP_TOKEN:?set AGENT_BOOTSTRAP_TOKEN}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates

# Node 20 + pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
corepack enable
corepack prepare pnpm@9.12.0 --activate

# Clone + install (node-llama-cpp auto-detects CUDA and offloads to the GPU)
rm -rf /opt/cumulus
git clone --depth 1 https://github.com/wirkling/cumulus.git /opt/cumulus
cd /opt/cumulus
pnpm install --prod=false

mkdir -p /etc/cumulus /var/lib/cumulus
{
  echo "CONTROL_PLANE_URL=$CONTROL_PLANE_URL"
  echo "AGENT_BOOTSTRAP_TOKEN=$AGENT_BOOTSTRAP_TOKEN"
  echo "NODE_TYPE=gpu_server"
  echo "NODE_NAME=${NODE_NAME:-cumulus-gpu-$(hostname)}"
  echo "MODEL_CACHE_DIR=/var/lib/cumulus/models"
  [ -n "${AGENT_REGION:-}" ] && echo "AGENT_REGION=$AGENT_REGION"
  [ -n "${AGENT_CITY:-}" ]   && echo "AGENT_CITY=$AGENT_CITY"
  [ -n "${AGENT_LAT:-}" ]    && echo "AGENT_LAT=$AGENT_LAT"
  [ -n "${AGENT_LNG:-}" ]    && echo "AGENT_LNG=$AGENT_LNG"
  [ -n "${LLM_GGUF_URL_GPU:-}" ] && echo "LLM_GGUF_URL_GPU=$LLM_GGUF_URL_GPU"
} > /etc/cumulus/agent.env

cat > /etc/systemd/system/cumulus-agent.service <<'UNIT'
[Unit]
Description=Cumulus GPU node agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/cumulus
EnvironmentFile=/etc/cumulus/agent.env
Environment=AGENT_STATE_FILE=/var/lib/cumulus/agent-state.json
ExecStart=/bin/bash -lc 'pnpm --filter @cumulus/node-agent start'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now cumulus-agent
echo "GPU agent started. nvidia-smi: $(command -v nvidia-smi >/dev/null && echo present || echo MISSING)"
echo "Check the dashboard Nodes tab — it should appear with executors including 'gpu'."
