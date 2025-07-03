#!/bin/bash
# Exit immediately if a command fails.
set -e

echo "--- Starting Node.js installation via build_options ---"
# Update the package list and install nodejs & npm. The -y flag auto-confirms.
apt-get update -y
apt-get install -y nodejs npm
# Verify the installation and print versions to the build log
echo "--- Node.js version ---"
node -v
echo "--- npm version ---"
npm -v
echo "-- Installing npx globally ---"
npm install -g npx
npx -v
echo "--- Node.js installation complete ---"
