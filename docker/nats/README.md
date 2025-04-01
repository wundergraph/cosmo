# Nats

This image is only used for development and testing purposes. It is not intended for production use.

__Reason:__ We haven't found any docker image that can run NATS with JetStream enabled. This is needed for GitHub Actions. We tried [Bitnami's image](https://hub.docker.com/r/bitnami/nats) and Nats official but it doesn't work.

## Build & Release

Run the following command to build and push the image for `linux/amd64`,`linux/arm64` and push it to the registry:

```bash
./build-push.sh
```