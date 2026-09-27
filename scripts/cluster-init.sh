#!/bin/sh
set -e

echo "waiting for nodes..."
for port in 3000 3001 3002; do
  for i in $(seq 1 30); do
    if curl -sf "http://localhost:${port}/health" > /dev/null; then
      echo "node on ${port} up"
      break
    fi
    if [ "$i" = "30" ]; then
      echo "node on ${port} never came up"
      exit 1
    fi
    sleep 1
  done
done

echo "init cluster..."
curl -sf -X POST http://localhost:3000/cluster/init
curl -sf http://localhost:3000/cluster
echo "cluster ready"
