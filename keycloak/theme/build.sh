#!/bin/bash

set -euo pipefail

rm -rf target

# install dependencies
npm install

# compile theme
npm run build

# package theme and wrap it in a .jar file
mvn package
