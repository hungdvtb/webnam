#!/bin/bash

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$SCRIPT_DIR}"
BACKEND_DIR="$PROJECT_ROOT/backend"
ADMIN_DIR="$PROJECT_ROOT/frontend"
WEBSITE_DIR="$PROJECT_ROOT/webgom"
WORKER_PM2_NAME="webnam-seo-worker"
WEB_USER="${WEB_USER:-www-data}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

function deploy_backend() {
    echo -e "${BLUE}>>> Deploying Backend (api.gomdaithanh.com)...${NC}"
    cd $BACKEND_DIR
    composer install --no-dev --optimize-autoloader
    php artisan migrate --force
    php artisan orders:repair-placeholder-product-snapshots --no-interaction
    php artisan storage:link
    php artisan optimize:clear
    php artisan config:clear
    php artisan cache:clear
    # After the artisan commands: they run as root and create cache/log files that PHP-FPM must write to.
    fix_backend_permissions
    restart_php_runtime
    echo -e "${GREEN}Backend deployment complete.${NC}"
}

# The project lives under /root, so NGINX/PHP-FPM ($WEB_USER) needs to be able to pass through each parent folder.
# Only "x" (traverse) is granted to $WEB_USER through an ACL: it cannot list /root.
function grant_web_user_traverse() {
    if ! id "$WEB_USER" >/dev/null 2>&1; then
        return
    fi

    local dir="$PROJECT_ROOT"
    local dirs=()
    while [ -n "$dir" ] && [ "$dir" != "/" ]; do
        dirs+=("$dir")
        dir="$(dirname "$dir")"
    done

    for dir in "${dirs[@]}"; do
        if command -v setfacl >/dev/null 2>&1; then
            setfacl -m "u:$WEB_USER:x" "$dir" || true
        else
            chmod o+x "$dir" || true
        fi
    done
    for dir in "$BACKEND_DIR" "$ADMIN_DIR"; do
        [ -d "$dir" ] && chmod o+x "$dir"
    done
}

function fix_backend_permissions() {
    echo -e "${BLUE}>>> Fixing backend permissions...${NC}"
    grant_web_user_traverse
    cd "$BACKEND_DIR" || return
    chown -R "$WEB_USER:$WEB_USER" storage bootstrap/cache
    find storage bootstrap/cache -type d -exec chmod 775 {} +
    find storage bootstrap/cache -type f -exec chmod 664 {} +
    if [ -f .env ]; then
        chown "root:$WEB_USER" .env
        chmod 640 .env
    fi
    chmod -R a+rX public
}

function fix_admin_permissions() {
    echo -e "${BLUE}>>> Fixing admin build permissions...${NC}"
    grant_web_user_traverse
    if [ -d "$ADMIN_DIR/dist" ]; then
        chmod -R a+rX "$ADMIN_DIR/dist"
    fi
}

function restart_php_runtime() {
    if ! command -v systemctl >/dev/null 2>&1; then
        return
    fi

    for service in php8.4-fpm php8.3-fpm php8.2-fpm php8.1-fpm php8.0-fpm php-fpm; do
        if systemctl list-unit-files "$service.service" >/dev/null 2>&1 || systemctl status "$service" >/dev/null 2>&1; then
            systemctl reload-or-restart "$service" || true
            echo -e "${GREEN}PHP runtime refreshed: $service.${NC}"
            return
        fi
    done
}

function deploy_worker() {
    echo -e "${BLUE}>>> Deploying SEO Bulk Worker...${NC}"
    cd $BACKEND_DIR

    if pm2 list | grep -q "$WORKER_PM2_NAME"; then
        pm2 restart $WORKER_PM2_NAME
        echo -e "${GREEN}SEO Worker restarted.${NC}"
    else
        pm2 start php --name "$WORKER_PM2_NAME" -- artisan product-seo-bulk:work
        pm2 save
        echo -e "${GREEN}SEO Worker started and saved.${NC}"
    fi
}

function deploy_admin() {
    echo -e "${BLUE}>>> Deploying Admin Frontend (admin.gomdaithanh.com)...${NC}"
    cd $ADMIN_DIR
    npm install
    npm run build
    fix_admin_permissions
    echo -e "${GREEN}Admin Frontend built.${NC}"
}

function deploy_website() {
    echo -e "${BLUE}>>> Deploying Main Website (gomdaithanh.com)...${NC}"
    cd $WEBSITE_DIR
    npm install
    npm run build
    # Check if PM2 process exists
    if pm2 list | grep -q "webnam-website"; then
        pm2 restart webnam-website
    else
        pm2 start npm --name "webnam-website" -- start -- -p 3003
    fi
    echo -e "${GREEN}Main Website deployment complete.${NC}"
}

# Bring the server checkout up to date with origin/master.
# Changes made directly on the server (or files rewritten by a build) would make `git pull` refuse to merge,
# so they are put aside in a git stash first; nothing is lost (`git stash list` to see them).
function sync_code() {
    cd "$PROJECT_ROOT" || exit 1
    # chmod on the server (e.g. 755 on source files) must not count as a code change.
    git config core.fileMode false
    git fetch origin master || exit 1

    if ! git diff --quiet || ! git diff --cached --quiet; then
        local stash_name="deploy-autostash-$(date +%Y%m%d-%H%M%S)"
        echo -e "${BLUE}>>> Local changes found on server, saving them as stash: $stash_name${NC}"
        git status --short
        git stash push -m "$stash_name" || exit 1
    fi

    git pull --ff-only origin master || exit 1
}

function reload_nginx() {
    echo -e "${BLUE}>>> Reloading Nginx...${NC}"
    nginx -t && systemctl reload nginx
    echo -e "${GREEN}Nginx reloaded.${NC}"
}

COMMAND=${1:-full}

case "$COMMAND" in
    full|rebuild)
        sync_code
        deploy_backend
        deploy_worker
        deploy_admin
        deploy_website
        fix_backend_permissions
        reload_nginx
        ;;
    backend)
        sync_code
        deploy_backend
        deploy_worker
        fix_backend_permissions
        ;;
    admin)
        sync_code
        deploy_admin
        ;;
    website)
        sync_code
        deploy_website
        ;;
    nginx)
        reload_nginx
        ;;
    permissions)
        fix_backend_permissions
        fix_admin_permissions
        ;;
    pm2)
        pm2 restart webnam-website
        ;;
    worker)
        deploy_worker
        ;;
    logs)
        pm2 logs webnam-website
        ;;
    worker-logs)
        pm2 logs $WORKER_PM2_NAME
        ;;
    *)
        echo "Usage: $0 {full|rebuild|backend|admin|website|nginx|permissions|pm2|worker|logs|worker-logs}"
        exit 1
esac
