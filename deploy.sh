#!/bin/bash

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$SCRIPT_DIR}"
BACKEND_DIR="$PROJECT_ROOT/backend"
ADMIN_DIR="$PROJECT_ROOT/frontend"
WEBSITE_DIR="$PROJECT_ROOT/webgom"
WORKER_PM2_NAME="webnam-seo-worker"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

function deploy_backend() {
    echo -e "${BLUE}>>> Deploying Backend (api.gomdaithanh.com)...${NC}"
    cd $BACKEND_DIR
    composer install --no-dev --optimize-autoloader
    php artisan migrate --force
    php artisan storage:link
    # Reset permissions for storage & cache
    chown -R www-data:www-data storage bootstrap/cache
    chmod -R 775 storage bootstrap/cache
    php artisan optimize:clear
    php artisan config:clear
    php artisan cache:clear
    restart_php_runtime
    echo -e "${GREEN}Backend deployment complete.${NC}"
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
    pm2 save
    echo -e "${GREEN}Main Website deployment complete.${NC}"
}

function reload_nginx() {
    echo -e "${BLUE}>>> Reloading Nginx...${NC}"
    nginx -t && systemctl reload nginx
    echo -e "${GREEN}Nginx reloaded.${NC}"
}

COMMAND=${1:-full}

case "$COMMAND" in
    full|rebuild)
        git pull origin master
        deploy_backend
        deploy_worker
        deploy_admin
        deploy_website
        reload_nginx
        ;;
    backend)
        git pull origin master
        deploy_backend
        deploy_worker
        ;;
    admin)
        git pull origin master
        deploy_admin
        ;;
    website)
        git pull origin master
        deploy_website
        ;;
    nginx)
        reload_nginx
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
        echo "Usage: $0 {full|rebuild|backend|admin|website|nginx|pm2|worker|logs|worker-logs}"
        exit 1
esac
