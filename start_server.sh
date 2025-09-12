#!/bin/bash

# Node.js Server Startup Script
# Usage: ./start-server.sh

# Configuration
SERVER_FILE="server/server.js"  # Change this to your main server file (app.js, index.js, etc.)
PID_FILE="server/server.pid"
LOG_FILE="server/server.log"
ERROR_LOG_FILE="server/server-error.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if server file exists
if [ ! -f "$SERVER_FILE" ]; then
    print_error "Server file '$SERVER_FILE' not found!"
    print_warning "Please update the SERVER_FILE variable in this script to point to your main server file"
    print_warning "Common names: app.js, index.js, server.js, main.js"
    exit 1
fi

# Function to kill processes using port 9000
kill_port_9000() {
    print_status "Checking for processes using port 9000..."
    
    # Find processes using port 9000
    PIDS=$(netstat -ano | grep ":9000" | awk '{print $5}' | sort -u 2>/dev/null || true)
    
    if [ -n "$PIDS" ]; then
        print_warning "Found processes using port 9000. Killing them..."
        for PID in $PIDS; do
            if [ "$PID" != "0" ] && [ -n "$PID" ]; then
                print_status "Killing process $PID"
                taskkill //PID "$PID" //F 2>/dev/null || kill -9 "$PID" 2>/dev/null || true
            fi
        done
        sleep 2
    fi
}

# Check if server is already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        print_warning "Server is already running with PID: $OLD_PID"
        print_status "Stopping existing server..."
        kill "$OLD_PID" 2>/dev/null || true
        sleep 2
        if kill -0 "$OLD_PID" 2>/dev/null; then
            kill -9 "$OLD_PID" 2>/dev/null || true
        fi
        rm -f "$PID_FILE"
    else
        print_warning "Removing stale PID file"
        rm -f "$PID_FILE"
    fi
fi

# Kill any processes using port 9000
kill_port_9000

# Install dependencies if package.json exists and node_modules doesn't
if [ -f "package.json" ] && [ ! -d "node_modules" ]; then
    print_status "Installing dependencies..."
    npm install
fi

# Start the server in background
print_status "Starting Node.js server..."
print_status "Server file: $SERVER_FILE"
print_status "Log file: $LOG_FILE"
print_status "Error log file: $ERROR_LOG_FILE"

# Use nohup to run in background and survive terminal closure
nohup node "$SERVER_FILE" > "$LOG_FILE" 2> "$ERROR_LOG_FILE" &

# Save the process ID
SERVER_PID=$!
echo $SERVER_PID > "$PID_FILE"

# Wait a moment to check if server started successfully
sleep 2

if kill -0 "$SERVER_PID" 2>/dev/null; then
    print_status "✅ Server started successfully!"
    print_status "PID: $SERVER_PID"
    print_status "Logs: tail -f $LOG_FILE"
    print_status "Errors: tail -f $ERROR_LOG_FILE"
    print_status "Stop server: kill $SERVER_PID or use './stop-server.sh'"
    echo ""
    print_status "Server is running in background and will continue even if you close this terminal."
else
    print_error "❌ Failed to start server!"
    print_error "Check the error log: cat $ERROR_LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
fi