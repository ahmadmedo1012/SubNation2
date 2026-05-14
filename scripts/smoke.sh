#!/bin/bash

# Simple smoke test to run post-deployment
URL=${1:-"http://localhost:8080/api/healthz"}
echo "Running smoke tests against $URL..."

STATUS=$(curl -s -o /dev/null -w "%{http_code}" $URL)

if [ "$STATUS" -eq 200 ]; then
  echo "✅ Smoke test passed. Health check returned 200 OK."
  exit 0
else
  echo "❌ Smoke test failed. Health check returned $STATUS"
  exit 1
fi
