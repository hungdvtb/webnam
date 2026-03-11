#!/bin/bash

# Script to run project locally on Windows (using Git Bash or similar)
# Frontend: port 3003
# Backend: port 8003

# Define colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting project...${NC}"

# Find PHP command
PROJECT_ROOT=$(pwd)
PHP_CMD="php"

if [ -f "$PROJECT_ROOT/php84/php.exe" ]; then
    PHP_CMD="$PROJECT_ROOT/php84/php.exe"
    echo -e "${BLUE}Using bundled PHP: $PHP_CMD${NC}"
elif [ -f "$PROJECT_ROOT/php/php.exe" ]; then
    PHP_CMD="$PROJECT_ROOT/php/php.exe"
    echo -e "${BLUE}Using bundled PHP: $PHP_CMD${NC}"
fi

# Function to kill child processes on exit
cleanup() {
    echo -e "\n${BLUE}Stopping services...${NC}"
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    # Kill any dangling php or node processes on these ports just in case
    # on windows, the kill command in bash might not kill child windows processes
    exit
}

trap cleanup SIGINT SIGTERM

# Start Backend
echo -e "${GREEN}Starting Backend on port 8003...${NC}"
cd backend
"$PHP_CMD" artisan serve --port=8003 &
BACKEND_PID=$!
cd ..

# Start Frontend
echo -e "${GREEN}Starting Frontend on port 3003...${NC}"
cd frontend
npm run dev -- --port 3003 &
FRONTEND_PID=$!
cd ..

echo -e "${BLUE}Services are running:${NC}"
echo -e "  - Frontend: http://localhost:3003"
echo -e "  - Backend API: http://localhost:8003/api"
echo -e "${BLUE}Press Ctrl+C to stop both services.${NC}"

# Wait for background processes
wait
