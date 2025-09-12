#!/bin/bash

# Node.js Server Stop Script
# Usage: ./stop-server.sh

PID_FILE="server/server.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if PID file exists
if [ ! -f "$PID_FILE" ]; then
    print_warning "No PID file found. Server may not be running or was started manually."
    exit 1
fi

# Read PID
PID=$(cat "$PID_FILE")

# Check if process is running
if kill -0 "$PID" 2>/dev/null; then
    print_status "Stopping server with PID: $PID"
    kill "$PID"
    
    # Wait for process to stop
    sleep 2
    
    if kill -0 "$PID" 2>/dev/null; then
        print_warning "Process still running, force killing..."
        kill -9 "$PID"
        sleep 1
    fi
    
    if kill -0 "$PID" 2>/dev/null; then
        print_error "Failed to stop server!"
        exit 1
    else
        print_status "✅ Server stopped successfully!"
    fi
else
    print_warning "Process with PID $PID is not running"
fi

# Remove PID file
rm -f "$PID_FILE"
print_status "PID file removed: $PID_FILE"