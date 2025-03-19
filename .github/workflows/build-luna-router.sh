---
name: Build Luna Router
on:
  push:
    branches: [ main ]
  pull_request:
    types: [opened, synchronize]

jobs:
  build:
    name: Build Luna Router Docker Image
    runs-on:
      group: lunacare-k8s-group
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      - name: Build Docker Image
        run: |-
          export GITHUB_ACTIONS=true

          if [[ "$GITHUB_REF" == "refs/heads/main" ]]; then
            BUILD_AS_TEST=false
          else
            BUILD_AS_TEST=true
          fi

          bash ./router/build-and-deploy.sh "$BUILD_AS_TEST"

