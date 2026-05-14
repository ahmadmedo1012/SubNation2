#!/bin/bash
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL is not set."
  exit 1
fi

if [ -z "$1" ]; then
  echo "Usage: ./db-restore.sh <backup_file>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file $BACKUP_FILE does not exist."
  exit 1
fi

echo "Restoring database from $BACKUP_FILE..."
pg_restore -c -d "$DATABASE_URL" "$BACKUP_FILE"

echo "Restore completed successfully."
