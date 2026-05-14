#!/bin/bash
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL is not set."
  exit 1
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="backup_$TIMESTAMP.sql"

echo "Creating database backup..."
pg_dump "$DATABASE_URL" -F c -f "$BACKUP_FILE"

echo "Backup created successfully: $BACKUP_FILE"
