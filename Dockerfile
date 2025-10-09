# Multi-stage build for optimal image size
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Pre-build server
RUN echo "🚀 Setting up msgpackr with native acceleration..." && \
    npm install msgpackr msgpackr-extract && \
    echo "🔍 Checking native addon status..." && \
    npm install -g node-gyp && \
    npm rebuild  && \
    echo "✅ Setup complete! Native acceleration should be enabled."

# Copy source code
COPY . .

# Build with esbuild
RUN npm run build-server


# Set environment
ENV NODE_ENV=production

# Expose port (adjust to your app)
EXPOSE 9000

# Run the app
CMD ["node", "dist-server/server.js"]