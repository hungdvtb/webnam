#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
BACKEND_DIR="${BACKEND_DIR:-$PROJECT_ROOT/backend}"
ADMIN_DIR="${ADMIN_DIR:-$PROJECT_ROOT/frontend}"
WEBSITE_DIR="${WEBSITE_DIR:-$PROJECT_ROOT/webgom}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-master}"
WEBSITE_PM2_NAME="${WEBSITE_PM2_NAME:-webnam-website}"
WEBSITE_PORT="${WEBSITE_PORT:-3003}"
AUTO_START_WEBSITE_PM2="${AUTO_START_WEBSITE_PM2:-0}"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${BLUE}>>> $*${NC}"
}

success() {
    echo -e "${GREEN}>>> $*${NC}"
}

warn() {
    echo -e "${YELLOW}>>> $*${NC}"
}

fail() {
    echo -e "${RED}>>> $*${NC}" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Usage: ./cap_nhat.sh [command]

Commands:
  backend      Pull code + deploy backend + migrate DB + backfill media R2 (default)
  backfill-r2  Only run R2 media backfill on backend
  admin        Pull code + build admin frontend
  website      Pull code + build website frontend
  full         Pull code + backend + admin + website
  pull         Only git pull latest code
  nginx        Reload nginx
  pm2          Restart website PM2 process
  help         Show this help

Optional environment variables:
  PROJECT_ROOT=/path/to/repo
  BACKEND_DIR=/path/to/repo/backend
  ADMIN_DIR=/path/to/repo/frontend
  WEBSITE_DIR=/path/to/repo/webgom
  DEPLOY_BRANCH=master
  WEBSITE_PM2_NAME=webnam-website
  WEBSITE_PORT=3003
  AUTO_START_WEBSITE_PM2=1
EOF
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "Thieu lenh bat buoc: $1"
}

require_dir() {
    [ -d "$1" ] || fail "Khong tim thay thu muc: $1"
}

run_npm_install() {
    if [ -f package-lock.json ]; then
        npm ci
    else
        npm install
    fi
}

pull_latest() {
    require_cmd git
    require_dir "$PROJECT_ROOT"

    log "Pull code moi tu branch $DEPLOY_BRANCH"
    cd "$PROJECT_ROOT"
    git pull origin "$DEPLOY_BRANCH"
    success "Pull code xong"
}

assert_backend_r2_config() {
    require_cmd php
    require_dir "$BACKEND_DIR"

    cd "$BACKEND_DIR"
    php <<'PHP'
<?php
require 'vendor/autoload.php';

$app = require 'bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$required = [
    'APP_URL',
    'MEDIA_DISK',
    'R2_ENDPOINT',
    'R2_BUCKET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
];

$missing = [];
foreach ($required as $key) {
    $value = trim((string) env($key, ''));
    if ($value === '') {
        $missing[] = $key;
    }
}

if (env('MEDIA_DISK') !== 'r2') {
    $missing[] = 'MEDIA_DISK must be r2';
}

if ($missing !== []) {
    fwrite(STDERR, "Thieu cau hinh backend/R2: " . implode(', ', $missing) . PHP_EOL);
    exit(1);
}
PHP
}

fix_backend_permissions() {
    cd "$BACKEND_DIR"

    if [ -d storage ] && [ -d bootstrap/cache ]; then
        chmod -R ug+rwX storage bootstrap/cache || warn "Khong chmod duoc storage/bootstrap/cache"

        if command -v chown >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
            chown -R www-data:www-data storage bootstrap/cache || warn "Khong chown duoc storage/bootstrap/cache"
        fi
    fi
}

deploy_backend() {
    require_cmd composer
    require_cmd php
    require_dir "$BACKEND_DIR"

    log "Deploy backend"
    cd "$BACKEND_DIR"

    composer install --no-dev --optimize-autoloader
    php artisan optimize:clear
    php artisan migrate --force
    php artisan storage:link || true

    assert_backend_r2_config

    log "Chay backfill anh cu len R2"
    php artisan media:migrate-r2

    php artisan config:cache
    php artisan route:cache || warn "route:cache loi, bo qua cache route"
    php artisan view:cache || warn "view:cache loi, bo qua cache view"

    fix_backend_permissions
    success "Backend xong"
}

backfill_r2_only() {
    require_cmd php
    require_dir "$BACKEND_DIR"

    log "Chay lai backfill media R2"
    cd "$BACKEND_DIR"
    php artisan optimize:clear
    assert_backend_r2_config
    php artisan media:migrate-r2
    php artisan config:cache
    success "Backfill R2 xong"
}

deploy_admin() {
    require_cmd npm
    require_dir "$ADMIN_DIR"

    log "Build admin frontend"
    cd "$ADMIN_DIR"
    run_npm_install
    npm run build
    success "Admin frontend xong"
}

deploy_website() {
    require_cmd npm
    require_dir "$WEBSITE_DIR"

    log "Build website frontend"
    cd "$WEBSITE_DIR"
    run_npm_install
    npm run build

    if command -v pm2 >/dev/null 2>&1; then
        if pm2 list | grep -q "$WEBSITE_PM2_NAME"; then
            pm2 restart "$WEBSITE_PM2_NAME"
            success "Restart PM2 process $WEBSITE_PM2_NAME"
        elif [ "$AUTO_START_WEBSITE_PM2" = "1" ]; then
            pm2 start npm --name "$WEBSITE_PM2_NAME" -- start -- -p "$WEBSITE_PORT"
            success "Start moi PM2 process $WEBSITE_PM2_NAME"
        else
            warn "Khong thay PM2 process $WEBSITE_PM2_NAME. Set AUTO_START_WEBSITE_PM2=1 neu muon script tu start."
        fi
    else
        warn "Khong co pm2 tren may nay, chi build website chu khong restart process."
    fi

    success "Website frontend xong"
}

reload_nginx() {
    require_cmd nginx

    log "Reload nginx"
    nginx -t

    if command -v systemctl >/dev/null 2>&1; then
        systemctl reload nginx
    else
        warn "Khong co systemctl, tu reload nginx theo cach rieng cua server."
    fi

    success "Nginx xong"
}

restart_pm2() {
    require_cmd pm2
    log "Restart PM2 process $WEBSITE_PM2_NAME"
    pm2 restart "$WEBSITE_PM2_NAME"
    success "PM2 xong"
}

COMMAND="${1:-backend}"

case "$COMMAND" in
    backend)
        pull_latest
        deploy_backend
        ;;
    backfill-r2)
        backfill_r2_only
        ;;
    admin)
        pull_latest
        deploy_admin
        ;;
    website)
        pull_latest
        deploy_website
        ;;
    full|rebuild)
        pull_latest
        deploy_backend
        deploy_admin
        deploy_website
        ;;
    pull)
        pull_latest
        ;;
    nginx)
        reload_nginx
        ;;
    pm2)
        restart_pm2
        ;;
    help|-h|--help)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
esac
