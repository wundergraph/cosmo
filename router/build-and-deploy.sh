#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
        echo "1 --- BUILD_AS_TEST - 'true' or 'false'"
        exit 1
fi
BUILD_AS_TEST=$1

ECR_REPO=$(basename "$(pwd)")
ECR_URL="836236105554.dkr.ecr.us-west-2.amazonaws.com/$ECR_REPO"

VERSION=$( grep -Eo '\[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md | tr -d '[]' | sort -V | tail -n1 )
VERSION_TAG="$ECR_URL:$VERSION"
LATEST_TAG="$ECR_URL:latest"
LATEST_TEST_TAG="$ECR_URL:latest-test"

GITHUB_ACTIONS="${GITHUB_ACTIONS:-"false"}"
if [[ "$GITHUB_ACTIONS" == "false" ]]; then
        CMD_DESCRIBE_IMAGES="aws ecr describe-images --repository-name $ECR_REPO --image-ids imageTag=$VERSION --profile live"
else
        CMD_DESCRIBE_IMAGES="aws ecr describe-images --repository-name $ECR_REPO --image-ids imageTag=$VERSION"
fi

# Execute the command and capture the error message
echo "running command: $CMD_DESCRIBE_IMAGES"
if output=$(eval "$CMD_DESCRIBE_IMAGES" 2>&1); then
    echo "VERSION $VERSION_TAG already exists. Exiting without building images"
    exit 1
else
    # Check for specific error messages
    if [[ $output == *"ImageNotFoundException"* ]]; then
        echo "Tag for VERSION $VERSION not found, proceeding to build it."
    elif [[ $output == *"InvalidParameterException"* ]]; then
        echo "Error: Invalid parameter when describing ecr images $VERSION."
        exit 1
    else
        echo "An unexpected error occurred: $output"
        exit 1
    fi
fi

if [ "$BUILD_AS_TEST" == "true" ]; then
        TAG_ARGS="-t ${LATEST_TEST_TAG}"
        TAGS_TO_PUSH="${LATEST_TEST_TAG}"
else
        TAG_ARGS="-t ${LATEST_TAG} -t ${VERSION_TAG}"
        TAGS_TO_PUSH="${LATEST_TAG} ${VERSION_TAG}"
fi


IFS=' ' read -r -a TAGS_TO_PUSH_ARRAY <<< "$TAGS_TO_PUSH"
for TAG in "${TAGS_TO_PUSH_ARRAY[@]}"; do
        echo "Set tag to push: $TAG"
done

export ECR_REPO="$ECR_REPO"
export TAG_ARGS="$TAG_ARGS"
export TAGS_TO_PUSH="$TAGS_TO_PUSH"










IFS=' ' read -r -a TAG_ARGS_ARRAY <<< "$TAG_ARGS"

docker buildx create --use --append
docker buildx inspect --bootstrap
docker buildx build \
        --platform linux/amd64,linux/arm64 \
        "${TAG_ARGS_ARRAY[@]}" \
        --push \
        .

