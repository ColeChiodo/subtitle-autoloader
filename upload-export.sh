#!/bin/bash

# Exit immediately if a command fails
set -e

# ====== CONFIGURE THESE ======
EXT_NAME="kuraji"   # Change this to your extension name
VERSION="0.4.0"           # Change this to your version
DEST=~/Downloads
# ============================

# Function to zip a folder without nesting the folder itself
zip_folder() {
    local folder="$1"
    local output="$2"
    (cd "$folder" && zip -r "$output" .)
}

# 1️⃣ Build Chrome extension
echo "Building Chrome extension..."
npm run build:chrome

CHROME_ZIP="$DEST/${EXT_NAME}-chrome-v${VERSION}.zip"
echo "Zipping Chrome extension to $CHROME_ZIP..."
zip_folder dist "$CHROME_ZIP"

# 2️⃣ Build Firefox extension
echo "Building Firefox extension..."
npm run build:firefox

FIREFOX_ZIP="$DEST/${EXT_NAME}-firefox-v${VERSION}.zip"
echo "Zipping Firefox extension to $FIREFOX_ZIP..."
zip_folder dist "$FIREFOX_ZIP"

# 3️⃣ Prepare full source zip for Firefox submission
echo "Preparing source code zip for Firefox..."
# Temporarily remove node_modules and dist
rm -rf node_modules dist

SOURCE_ZIP="$DEST/${EXT_NAME}-firefox-source-v${VERSION}.zip"
echo "Zipping project source to $SOURCE_ZIP..."
zip -r "$SOURCE_ZIP" . -x "*.git*" "*.DS_Store"

echo "Done! All zips are in $DEST"
