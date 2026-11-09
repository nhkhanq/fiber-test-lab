set -euo pipefail

body='{"jsonrpc":"2.0","method":"get_tip_block_number","params":[],"id":1}'
exec 3<>/dev/tcp/127.0.0.1/8114
printf 'POST / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' "${#body}" "$body" >&3
grep -q '"result"' <&3
