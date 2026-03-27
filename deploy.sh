#!/bin/bash

# Configuration
PROJECT_ROOT="/root/www/webname"
BACKEND_DIR="$PROJECT_ROOT/backend"
ADMIN_DIR="$PROJECT_ROOT/frontend"
WEBSITE_DIR="$PROJECT_ROOT/webgom"

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
    echo -e "${GREEN}Backend deployment complete.${NC}"
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
    echo -e "${GREEN}Main Website deployment complete.${NC}"
}

function reload_nginx() {
    echo -e "${BLUE}>>> Reloading Nginx...${NC}"
    nginx -t && systemctl reload nginx
    echo -e "${GREEN}Nginx reloaded.${NC}"
}

case "$1" in
    full|rebuild)
        git pull origin master
        deploy_backend
        deploy_admin
        deploy_website
        reload_nginx
        ;;
    backend)
        git pull origin master
        deploy_backend
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
    logs)
        pm2 logs webnam-website
        ;;
    *)
        echo "Usage: $0 {full|rebuild|backend|admin|website|nginx|pm2|logs}"
        exit 1
esac
