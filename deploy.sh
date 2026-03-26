#!/bin/bash

case "$1" in
  start)
    docker compose up -d
    ;;
  stop)
    docker compose down
    ;;
  restart)
    docker compose restart
    ;;
  rebuild)
    docker compose up -d --build
    ;;
  import-db)
    ./import-db.sh
    ;;
  logs)
    docker compose logs -f
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|rebuild|import-db|logs}"
    exit 1
esac
