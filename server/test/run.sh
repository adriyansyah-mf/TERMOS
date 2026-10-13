#!/bin/sh
# Starts a throwaway PostgreSQL container, runs the test suite against it, removes it.
set -eu
cd "$(dirname "$0")/.."
PASS=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')
NAME="termos-test-pg-$$"
PORT=$((25000 + $$ % 5000))
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD="$PASS" -e POSTGRES_USER=termos \
  -p "127.0.0.1:$PORT:5432" postgres:17-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null 2>&1 || true' EXIT
i=0
until docker exec "$NAME" pg_isready -U termos -h 127.0.0.1 >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { echo "postgres did not start"; exit 1; }
  sleep 0.5
done
sleep 1
export TERMOS_TEST_DATABASE_URL="postgres://termos:$PASS@127.0.0.1:$PORT/termos"
node --test --test-concurrency=1 test/*.test.mjs
