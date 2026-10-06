#!/bin/bash
# host-side starter: triggered when panel drops DATA/start-requested
FLAG=/opt/admin-panel/data/start-requested
rm -f "$FLAG"
if su - nenquen -c 'tmux has-session -t kairox' 2>/dev/null; then
  echo "already running"
else
  su - nenquen -c 'cd /home/nenquen/kairox && ./start.sh'
  echo "started"
fi
