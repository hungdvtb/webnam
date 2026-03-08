#!/bin/bash

# Script to run Di Sản Gốm Việt project locally

# Define colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting Di Sản Gốm Việt project...${NC}"

# Function to kill child processes on exit
cleanup() {
    echo -e "\n${BLUE}Stopping services...${NC}"
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

# Start Backend
echo -e "${GREEN}Starting Backend on port 8002...${NC}"
cd backend
php artisan serve --port=8002 &
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
echo -e "  - Backend API: http://localhost:8002/api"
echo -e "${BLUE}Press Ctrl+C to stop both services.${NC}"

# Wait for background processes
wait
