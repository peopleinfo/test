# Snake Zone Server

This file (`server.js`) contains the backend server for the Snake Zone game.

## Technologies Used

- Node.js
- Express
- Socket.IO

## Running the Server

To start the server, run:

```bash
node server.js
```

The server will typically listen on port 9000 (or as configured within `server.js`).

## Deployment for development

Setup Instructions:

Make the scripts executable:
bashchmod +x start-server.sh
chmod +x stop-server.sh

Update the server file name:
Edit start-server.sh and change SERVER_FILE="server.js" to match your actual server file (like app.js, index.js, etc.)
Start your server:
bash./start-server.sh

Key Features:

Background execution: Uses nohup to run the server in background
Persistent: Server continues running even when you close the terminal
Process tracking: Saves PID to server.pid file
Logging: Outputs to server.log and errors to server-error.log
Auto dependency install: Installs npm packages if needed
Safety checks: Prevents starting multiple instances
Easy stopping: Use ./stop-server.sh to stop the server

Usage Commands:
bash# Start server
./start-server.sh

# Stop server
./stop-server.sh

# View logs
tail -f server.log

# View errors
tail -f server-error.log
The script will automatically handle everything - just run ./start-server.sh and your Node.js server will run in the background, surviving terminal closures and system reboots (until manually stopped).