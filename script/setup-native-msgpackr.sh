#!/bin/bash

echo "🚀 Setting up msgpackr with native acceleration..."

# Install msgpackr with native addon
npm install msgpackr
npm install msgpackr-extract

# Verify native addon installation
echo "🔍 Checking native addon status..."
node -e "
const { isNativeAccelerationEnabled } = require('msgpackr');
console.log('Native acceleration:', isNativeAccelerationEnabled ? '✅ ENABLED' : '❌ DISABLED');
if (!isNativeAccelerationEnabled) {
  console.log('Attempting to rebuild native modules...');
  require('child_process').execSync('npm rebuild msgpackr-extract', { stdio: 'inherit' });
}
"

# Optional: Install build tools for native compilation
echo "🔧 Installing build tools (if needed)..."
npm install -g node-gyp

# Rebuild native modules
npm rebuild

echo "✅ Setup complete! Native acceleration should be enabled."