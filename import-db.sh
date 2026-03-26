#!/bin/bash

echo "Waiting for PostgreSQL to be ready..."
until docker exec webnam-db pg_isready -U postgres; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 2
done

echo "PostgreSQL is up - importing database..."
DUMP_FILE="/root/www/webname/database-backups/webnam-20260326-121326.dump"

if [ ! -f "$DUMP_FILE" ]; then
    echo "Dump file not found: $DUMP_FILE"
    exit 1
fi

echo "Restoring database into webnam-db container..."
# Use -i to stream input from host file into docker exec
docker exec -i webnam-db pg_restore -U postgres -d webnam < "$DUMP_FILE"

echo "Import complete."
