# Use JDK 23 as specified in build.gradle.kts
FROM eclipse-temurin:23-jdk-alpine

# Install necessary build tools
RUN apk add --no-cache gradle

# Set working directory
WORKDIR /app

# Copy gradle files first to leverage Docker cache
COPY gradle ./gradle
COPY build.gradle.kts settings.gradle.kts gradlew ./

# Copy source code
COPY src ./src

# Run tests
CMD ["./gradlew", "test"] 