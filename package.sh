#!/bin/sh
set -e
cd "$(dirname "$0")"

(cd webapp && npm run build)

rm -rf server/dist && mkdir -p server/dist
for target in linux-amd64 linux-arm64 darwin-amd64 darwin-arm64 windows-amd64; do
    GOOS=${target%-*}
    GOARCH=${target#*-}
    output="server/dist/plugin-$target"
    if [ "$GOOS" = windows ]; then
        output="$output.exe"
    fi
    echo "Building $target server..."
    CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build -trimpath -ldflags='-s -w' -o "$output" ./server
done

VERSION=$(node -p "require('./plugin.json').version")
rm -rf dist && mkdir -p dist/corp.osbren.voicenotes/webapp/dist dist/corp.osbren.voicenotes/server dist/corp.osbren.voicenotes/LICENSES
cp plugin.json dist/corp.osbren.voicenotes/
cp LICENSE THIRD_PARTY_NOTICES.md dist/corp.osbren.voicenotes/
cp LICENSES/LGPL-3.0.txt dist/corp.osbren.voicenotes/LICENSES/
cp webapp/dist/main.js dist/corp.osbren.voicenotes/webapp/dist/
cp -R server/dist dist/corp.osbren.voicenotes/server/

# macOS metadata in the tarball breaks Mattermost's manifest detection.
cd dist
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf "corp.osbren.voicenotes-$VERSION.tar.gz" corp.osbren.voicenotes 2>/dev/null ||
    COPYFILE_DISABLE=1 tar --no-xattrs -czf "corp.osbren.voicenotes-$VERSION.tar.gz" corp.osbren.voicenotes
ls -la "corp.osbren.voicenotes-$VERSION.tar.gz"
