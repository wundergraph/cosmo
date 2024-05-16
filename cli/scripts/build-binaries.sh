#!/bin/bash
set -euo pipefail

echo " 📦  Building wcg binaries..."
del dist/bundle.cjs 
del dist/bin

# vercel/pkg doesnt support es modules so we need to transpile to cjs
# see ../rollup.config.js
rollup -c

pkg dist/bundle.cjs -t node16-macos,node16-linux,node16-win --out-path dist/bin

cd dist/bin

mkdir macos linux win
mv bundle-macos macos/wcg
mv bundle-linux linux/wcg
mv bundle-win.exe win/wcg.exe

echo " 📦  Building wcg binaries... Done"
