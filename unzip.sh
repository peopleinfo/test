#!/bin/bash

# Script to unzip worm-zone-main.zip
# This script extracts the contents of worm-zone-main.zip to the current directory

echo "Starting extraction of worm-zone-main.zip..."

# Check if the zip file exists
if [ ! -f "worm-zone-main.zip" ]; then
    echo "Error: worm-zone-main.zip not found in the current directory"
    exit 1
fi

# Extract the zip file
unzip worm-zone-main.zip

# Check if extraction was successful
if [ $? -eq 0 ]; then
    echo "Successfully extracted worm-zone-main.zip"
    echo "Contents have been extracted to the current directory"
else
    echo "Error: Failed to extract worm-zone-main.zip"
    exit 1
fi
