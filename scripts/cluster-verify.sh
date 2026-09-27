#!/bin/sh
set -e

fail() {
  echo "verify failed: $1"
  exit 1
}

LEADER1=$(curl -sf http://localhost:3000/cluster | grep -o '"leader_id":[0-9]*')
LEADER2=$(curl -sf http://localhost:3001/cluster | grep -o '"leader_id":[0-9]*')
LEADER3=$(curl -sf http://localhost:3002/cluster | grep -o '"leader_id":[0-9]*')
[ "$LEADER1" = "$LEADER2" ] && [ "$LEADER2" = "$LEADER3" ] || fail "no single leader ($LEADER1 $LEADER2 $LEADER3)"
echo "single leader: $LEADER1"

case "$LEADER1" in
  *1) LEADER_URL=http://localhost:3000 ;;
  *2) LEADER_URL=http://localhost:3001 ;;
  *3) LEADER_URL=http://localhost:3002 ;;
esac

SID=$(curl -sf -X POST "$LEADER_URL/sessions" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)
[ -n "$SID" ] || fail "session create failed"
echo "session: $SID"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$LEADER_URL/sessions/$SID/messages" \
  -H "content-type: application/json" \
  -d '{"role":"user","content":"verify replication"}')
[ "$CODE" = "204" ] || fail "write failed ($CODE)"
sleep 2

for port in 3000 3001 3002; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${port}/sessions/$SID/context")
  [ "$CODE" = "200" ] || fail "node on $port missing data ($CODE)"
done
echo "replicated on all nodes"

echo "cluster verify passed"
