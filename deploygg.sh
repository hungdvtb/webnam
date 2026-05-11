#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
BACKEND_DIR="${BACKEND_DIR:-$PROJECT_ROOT/backend}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-master}"
SYNC_LIMIT="${SYNC_LIMIT:-5}"

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
Usage: ./deploygg.sh [command]

Commands:
  deploy        Pull code, deploy backend, validate Google Merchant config, dry-run 5 products (default)
  check         Validate backend .env and Google Merchant service account file
  register-gcp  Register this Google Cloud project with the Merchant Center account
  sources       List Google Merchant data sources from the configured account
  dry-run       Build product payloads without sending them to Google
  sync          Send products to Google Merchant Center
  env-template  Print required backend/.env variables
  help          Show this help

Optional environment variables:
  PROJECT_ROOT=/path/to/repo
  BACKEND_DIR=/path/to/repo/backend
  DEPLOY_BRANCH=master
  SYNC_LIMIT=5
EOF
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "Thieu lenh bat buoc: $1"
}

require_dir() {
    [ -d "$1" ] || fail "Khong tim thay thu muc: $1"
}

pull_latest() {
    require_cmd git
    require_dir "$PROJECT_ROOT"

    log "Pull code moi tu branch $DEPLOY_BRANCH"
    cd "$PROJECT_ROOT"
    git pull origin "$DEPLOY_BRANCH"
    success "Pull code xong"
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
    php artisan config:clear
    success "Backend xong"
}

print_env_template() {
    cat <<'EOF'
Them vao backend/.env tren server:

GOOGLE_MERCHANT_SYNC_ENABLED=true
GOOGLE_MERCHANT_ACCOUNT_ID=5784047046
GOOGLE_MERCHANT_DATA_SOURCE_ID=10653538725
GOOGLE_MERCHANT_DEVELOPER_EMAIL=vngocnamtb@gmail.com
GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON_PATH=/www/webname/backend/storage/app/google-merchant.json
GOOGLE_MERCHANT_PRODUCT_URL_BASE=https://gomdaithanh.com
GOOGLE_MERCHANT_QUEUE_CONNECTION=sync

Sau do upload file service account JSON dung vao duong dan GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON_PATH.
EOF
}

validate_google_merchant_config() {
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
    require_cmd php
    require_dir "$BACKEND_DIR"

    validate_google_merchant_config
    log "Dry-run $SYNC_LIMIT san pham"
    cd "$BACKEND_DIR"
    php artisan google-merchant:sync-products --dry-run --limit="$SYNC_LIMIT"
}

sync_products() {
    require_cmd php
    require_dir "$BACKEND_DIR"

    validate_google_merchant_config
    log "Dong bo that $SYNC_LIMIT san pham len Google Merchant"
    cd "$BACKEND_DIR"
    php artisan google-merchant:sync-products --limit="$SYNC_LIMIT"
}

list_sources() {
    require_cmd php
    require_dir "$BACKEND_DIR"

    validate_google_merchant_config
    log "Lay danh sach nguon Google Merchant"
    cd "$BACKEND_DIR"
    php artisan google-merchant:list-data-sources
}

register_gcp_project() {
    require_cmd php
    require_dir "$BACKEND_DIR"

    validate_google_merchant_config
    log "Dang ky Google Cloud project voi Merchant Center"
    cd "$BACKEND_DIR"

    if [ -n "${GOOGLE_MERCHANT_DEVELOPER_EMAIL:-}" ]; then
        php artisan google-merchant:register-gcp "$GOOGLE_MERCHANT_DEVELOPER_EMAIL"
    else
        php artisan google-merchant:register-gcp
    fi
}

COMMAND="${1:-deploy}"

case "$COMMAND" in
    deploy)
        pull_latest
        deploy_backend
        validate_google_merchant_config
        dry_run_products
        ;;
    check)
        validate_google_merchant_config
        ;;
    register-gcp)
        register_gcp_project
        ;;
    sources)
        list_sources
        ;;
    dry-run)
        dry_run_products
        ;;
    sync)
        sync_products
        ;;
    env-template)
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
