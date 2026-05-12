#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Paths can be overridden when the production path differs.
PROJECT_ROOT="${PROJECT_ROOT:-$SCRIPT_DIR}"
BACKEND_DIR="${BACKEND_DIR:-$PROJECT_ROOT/backend}"
ADMIN_DIR="${ADMIN_DIR:-$PROJECT_ROOT/frontend}"
WEBSITE_DIR="${WEBSITE_DIR:-$PROJECT_ROOT/webgom}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-master}"

WORKER_PM2_NAME="${WORKER_PM2_NAME:-webnam-seo-worker}"
WEBSITE_PM2_NAME="${WEBSITE_PM2_NAME:-webnam-website}"
WEBSITE_PORT="${WEBSITE_PORT:-3003}"
SYNC_LIMIT="${SYNC_LIMIT:-5}"

# auto = use Docker when the webnam containers are already running.
# host = keep the legacy host/npm/pm2 deploy flow.
# docker = force docker compose deploy.
DOCKER_MODE="${DOCKER_MODE:-auto}"

# Set to 1 when you want full/backend deploy to validate credentials and dry-run Merchant sync.
GOOGLE_MERCHANT_DEPLOY_CHECK="${GOOGLE_MERCHANT_DEPLOY_CHECK:-0}"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
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
Usage: ./deploy.sh [command]

Commands:
  full|rebuild|deploy  Pull code, deploy backend + worker + admin + website + nginx (default)
  backend              Pull code and deploy backend + worker
  admin                Pull code and deploy admin frontend
  website              Pull code and deploy main website frontend
  nginx                Reload nginx
  pm2                  Restart website PM2 process
  worker               Restart/start SEO bulk worker
  logs                 Show website PM2 logs
  worker-logs          Show SEO worker PM2 logs

Google Merchant:
  merchant-check       Validate backend .env and service account JSON
  merchant-dry-run     Build product payloads without sending them to Google
  merchant-sync        Send products to Google Merchant Center
  merchant-sources     List configured Google Merchant data sources
  merchant-register    Register this Google Cloud project with Merchant Center
  merchant-env         Print required backend .env variables

Optional environment variables:
  PROJECT_ROOT=/path/to/repo
  BACKEND_DIR=/path/to/repo/backend
  ADMIN_DIR=/path/to/repo/frontend
  WEBSITE_DIR=/path/to/repo/webgom
  DEPLOY_BRANCH=master
  DOCKER_MODE=auto|host|docker
  GOOGLE_MERCHANT_DEPLOY_CHECK=1
  SYNC_LIMIT=5
EOF
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "Thieu lenh bat buoc: $1"
}

require_dir() {
    [ -d "$1" ] || fail "Khong tim thay thu muc: $1"
}

compose() {
    cd "$PROJECT_ROOT"

    if docker compose version >/dev/null 2>&1; then
        docker compose "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose "$@"
    else
        fail "Docker dang duoc dung nhung khong tim thay docker compose."
    fi
}

docker_stack_running() {
    command -v docker >/dev/null 2>&1 || return 1
    docker ps --format '{{.Names}}' 2>/dev/null | grep -Eq '^(webnam-api|webnam-admin|webnam-website|webnam-proxy)$'
}

use_docker_stack() {
    case "$DOCKER_MODE" in
        docker|1|true|yes)
            return 0
            ;;
        host|0|false|no)
            return 1
            ;;
        auto)
            docker_stack_running
            ;;
        *)
            fail "DOCKER_MODE khong hop le: $DOCKER_MODE"
            ;;
    esac
}

require_docker_stack() {
    require_cmd docker
    require_dir "$PROJECT_ROOT"
    [ -f "$PROJECT_ROOT/docker-compose.yml" ] || fail "Khong tim thay docker-compose.yml trong $PROJECT_ROOT"
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
    git rev-parse --short HEAD | xargs -I{} echo "Current commit: {}"
    success "Pull code xong"
}

backend_artisan() {
    if use_docker_stack; then
        docker exec webnam-api php artisan "$@"
    else
        cd "$BACKEND_DIR"
        php artisan "$@"
    fi
}

backend_php() {
    if use_docker_stack; then
        docker exec -i webnam-api php "$@"
    else
        cd "$BACKEND_DIR"
        php "$@"
    fi
}

backend_composer() {
    if use_docker_stack; then
        docker exec webnam-api composer "$@"
    else
        cd "$BACKEND_DIR"
        composer "$@"
    fi
}

fix_backend_permissions() {
    if use_docker_stack; then
        docker exec webnam-api sh -lc 'chmod -R ug+rwX storage bootstrap/cache || true'
        return
    fi

    cd "$BACKEND_DIR"
    [ -d storage ] && [ -d bootstrap/cache ] || return

    chmod -R ug+rwX storage bootstrap/cache || warn "Khong chmod duoc storage/bootstrap/cache"
    if command -v chown >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
        chown -R www-data:www-data storage bootstrap/cache || warn "Khong chown duoc storage/bootstrap/cache"
    fi
}

deploy_backend() {
    require_dir "$BACKEND_DIR"

    if use_docker_stack; then
        require_docker_stack
        log "Deploy backend qua Docker"
        compose up -d --build backend
    else
        require_cmd composer
        require_cmd php
        log "Deploy backend tren host"
    fi

    backend_composer install --no-dev --optimize-autoloader
    backend_artisan optimize:clear
    backend_artisan migrate --force
    backend_artisan storage:link || true
    backend_artisan config:clear
    fix_backend_permissions

    success "Backend xong"
}

deploy_worker() {
    require_dir "$BACKEND_DIR"

    if ! command -v pm2 >/dev/null 2>&1; then
        warn "Khong co pm2, bo qua worker $WORKER_PM2_NAME"
        return
    fi

    log "Deploy SEO Bulk Worker"
    cd "$BACKEND_DIR"

    if pm2 list | grep -q "$WORKER_PM2_NAME"; then
        pm2 restart "$WORKER_PM2_NAME"
        success "SEO Worker restarted"
    else
        pm2 start php --name "$WORKER_PM2_NAME" -- artisan product-seo-bulk:work
        pm2 save
        success "SEO Worker started and saved"
    fi
}

verify_admin_google_merchant_source() {
    require_dir "$ADMIN_DIR"

    if ! grep -R -q "google-merchant" "$ADMIN_DIR/src"; then
        fail "Source admin khong co Google Merchant. Kiem tra branch/pull truoc khi deploy."
    fi
}

verify_admin_google_merchant_bundle() {
    if use_docker_stack; then
        docker exec webnam-admin sh -lc "grep -R -q 'google-merchant/settings' /usr/share/nginx/html || grep -R -q 'Google Merchant' /usr/share/nginx/html" \
            || fail "Container webnam-admin chua co bundle Google Merchant."
    else
        grep -R -q "google-merchant/settings" "$ADMIN_DIR/dist" \
            || fail "Admin dist chua co Google Merchant. Build co the dang dung source cu."
    fi

    success "Admin bundle co Google Merchant"
}

deploy_admin() {
    verify_admin_google_merchant_source

    if use_docker_stack; then
        require_docker_stack
        log "Deploy admin frontend qua Docker"
        compose up -d --build admin
    else
        require_cmd npm
        require_dir "$ADMIN_DIR"

        log "Build admin frontend tren host"
        cd "$ADMIN_DIR"
        run_npm_install
        npm run build
    fi

    verify_admin_google_merchant_bundle
    success "Admin frontend xong"
}

deploy_website() {
    require_dir "$WEBSITE_DIR"

    if use_docker_stack; then
        require_docker_stack
        log "Deploy main website qua Docker"
        compose up -d --build website
        success "Main website xong"
        return
    fi

    require_cmd npm
    log "Deploy main website tren host"
    cd "$WEBSITE_DIR"
    run_npm_install
    npm run build

    if command -v pm2 >/dev/null 2>&1; then
        if pm2 list | grep -q "$WEBSITE_PM2_NAME"; then
            pm2 restart "$WEBSITE_PM2_NAME"
        else
            pm2 start npm --name "$WEBSITE_PM2_NAME" -- start -- -p "$WEBSITE_PORT"
            pm2 save
        fi
    else
        warn "Khong co pm2, chi build website chu khong restart process."
    fi

    success "Main website xong"
}

reload_nginx() {
    if use_docker_stack; then
        require_docker_stack
        log "Reload nginx trong Docker"
        compose up -d nginx
        docker exec webnam-proxy nginx -t
        docker exec webnam-proxy nginx -s reload || compose restart nginx
        success "Nginx xong"
        return
    fi

    require_cmd nginx
    log "Reload nginx tren host"
    nginx -t
    if command -v systemctl >/dev/null 2>&1; then
        systemctl reload nginx
    else
        nginx -s reload
    fi
    success "Nginx xong"
}

restart_pm2() {
    require_cmd pm2
    log "Restart PM2 process $WEBSITE_PM2_NAME"
    pm2 restart "$WEBSITE_PM2_NAME"
    success "PM2 xong"
}

verify_google_merchant_backend_code() {
    require_dir "$BACKEND_DIR"

    backend_artisan list --raw | grep '^google-merchant:sync-products' >/dev/null \
        || fail "Backend chua nhan command google-merchant:sync-products."

    success "Backend co command Google Merchant"
}

print_env_template() {
    cat <<EOF
Them vao backend/.env tren server:

GOOGLE_MERCHANT_SYNC_ENABLED=true
GOOGLE_MERCHANT_ACCOUNT_ID=5784047046
GOOGLE_MERCHANT_DATA_SOURCE_ID=10653538725
GOOGLE_MERCHANT_DEVELOPER_EMAIL=vngocnamtb@gmail.com
GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON_PATH=$BACKEND_DIR/storage/app/google-merchant.json
GOOGLE_MERCHANT_PRODUCT_URL_BASE=https://gomdaithanh.com
GOOGLE_MERCHANT_QUEUE_CONNECTION=sync

Sau do upload file service account JSON dung vao duong dan GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON_PATH.
EOF
}

validate_google_merchant_config() {
    require_dir "$BACKEND_DIR"

    backend_php <<'PHP'
<?php
require 'vendor/autoload.php';

$app = require 'bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$required = [
    'GOOGLE_MERCHANT_SYNC_ENABLED',
    'GOOGLE_MERCHANT_ACCOUNT_ID',
    'GOOGLE_MERCHANT_DATA_SOURCE_ID',
    'GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON_PATH',
    'GOOGLE_MERCHANT_PRODUCT_URL_BASE',
];

$missing = [];
foreach ($required as $key) {
    $value = trim((string) env($key, ''));
    if ($value === '') {
        $missing[] = $key;
    }
}

$enabled = filter_var(env('GOOGLE_MERCHANT_SYNC_ENABLED'), FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
if ($enabled !== true) {
    $missing[] = 'GOOGLE_MERCHANT_SYNC_ENABLED must be true';
}

$jsonPath = trim((string) env('GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON_PATH', ''));
if ($jsonPath !== '' && (! is_file($jsonPath) || ! is_readable($jsonPath))) {
    $missing[] = 'service account JSON not readable: ' . $jsonPath;
}

if ($missing !== []) {
    fwrite(STDERR, "Thieu cau hinh Google Merchant:\n- " . implode("\n- ", $missing) . "\n");
    exit(1);
}

echo "Google Merchant config OK\n";
PHP
}

dry_run_products() {
    validate_google_merchant_config
    log "Dry-run $SYNC_LIMIT san pham"
    backend_artisan google-merchant:sync-products --dry-run --limit="$SYNC_LIMIT"
}

sync_products() {
    validate_google_merchant_config
    log "Dong bo that $SYNC_LIMIT san pham len Google Merchant"
    backend_artisan google-merchant:sync-products --limit="$SYNC_LIMIT"
}

list_sources() {
    validate_google_merchant_config
    log "Lay danh sach nguon Google Merchant"
    backend_artisan google-merchant:list-data-sources
}

register_gcp_project() {
    validate_google_merchant_config
    log "Dang ky Google Cloud project voi Merchant Center"

    if [ -n "${GOOGLE_MERCHANT_DEVELOPER_EMAIL:-}" ]; then
        backend_artisan google-merchant:register-gcp "$GOOGLE_MERCHANT_DEVELOPER_EMAIL"
    else
        backend_artisan google-merchant:register-gcp
    fi
}

post_google_merchant_deploy_check() {
    verify_google_merchant_backend_code

    if [ "$GOOGLE_MERCHANT_DEPLOY_CHECK" = "1" ]; then
        dry_run_products
    else
        warn "Bo qua dry-run Google Merchant. Set GOOGLE_MERCHANT_DEPLOY_CHECK=1 neu muon deploy fail khi cau hinh Merchant sai."
    fi
}

COMMAND="${1:-full}"

case "$COMMAND" in
    full|rebuild|deploy)
        pull_latest
        deploy_backend
        deploy_worker
        deploy_admin
        deploy_website
        post_google_merchant_deploy_check
        reload_nginx
        ;;
    backend)
        pull_latest
        deploy_backend
        deploy_worker
        post_google_merchant_deploy_check
        ;;
    admin)
        pull_latest
        deploy_admin
        ;;
    website)
        pull_latest
        deploy_website
        ;;
    nginx)
        reload_nginx
        ;;
    pm2)
        restart_pm2
        ;;
    worker)
        deploy_worker
        ;;
    logs)
        require_cmd pm2
        pm2 logs "$WEBSITE_PM2_NAME"
        ;;
    worker-logs)
        require_cmd pm2
        pm2 logs "$WORKER_PM2_NAME"
        ;;
    merchant-check|check)
        validate_google_merchant_config
        ;;
    merchant-dry-run|dry-run)
        dry_run_products
        ;;
    merchant-sync|sync)
        sync_products
        ;;
    merchant-sources|sources)
        list_sources
        ;;
    merchant-register|register-gcp)
        register_gcp_project
        ;;
    merchant-env|env-template)
        print_env_template
        ;;
    help|-h|--help)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
esac
