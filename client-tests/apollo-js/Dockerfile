# Use Node.js LTS version
FROM node:20-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package.json pnpm-lock.yaml ./

# Install dependencies --frozen-lockfile
RUN pnpm install

# Copy source code and configuration files
COPY . .

# Run tests
CMD ["pnpm", "test"] 