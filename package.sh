#!/bin/sh
set -e
cd "$(dirname "$0")"

(cd webapp && npm run build)

VERSION=$(node -p "require('./plugin.json').version")
rm -rf dist && mkdir -p dist/corp.osbren.voicenotes/webapp/dist
cp plugin.json dist/corp.osbren.voicenotes/
cp webapp/dist/main.js dist/corp.osbren.voicenotes/webapp/dist/

# macOS metadata in the tarball breaks Mattermost's manifest detection.
cd dist
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf "corp.osbren.voicenotes-$VERSION.tar.gz" corp.osbren.voicenotes 2>/dev/null ||
    COPYFILE_DISABLE=1 tar --no-xattrs -czf "corp.osbren.voicenotes-$VERSION.tar.gz" corp.osbren.voicenotes
ls -la "corp.osbren.voicenotes-$VERSION.tar.gz"
