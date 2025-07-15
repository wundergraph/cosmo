# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Build Commands
- `pnpm build` - Build all packages in the monorepo
- `pnpm test` - Run all tests across packages
- `pnpm lint:fix` - Fix linting issues across all packages
- `pnpm generate` - Generate Protocol Buffer code for TypeScript/Go
- `pnpm clean` - Clean all build artifacts and node_modules

### Local Development Setup
- `make` - Bootstrap the repository and build all packages
- `make migrate && make seed` - Run database migrations and seed data
- `make start-cp` - Start the control plane server
- `make start-router` - Start the GraphQL router
- `make start-studio` - Start the Studio web interface
- `make create-demo` - Create demo federated graph with subgraphs

### Docker Commands
- `make infra-up` - Start development infrastructure (PostgreSQL, Redis, etc.)
- `make infra-down-v` - Stop and remove all infrastructure containers and volumes
- `make dc-subgraphs-demo` - Start demo subgraph services

### Testing
- Individual package tests: `pnpm test` (in package directory)
- Router tests: `cd router && go test ./...`
- Integration tests: `cd router-tests && go test ./...`

## High-Level Architecture

WunderGraph Cosmo is a complete GraphQL Federation platform with the following core components:

### Router (`/router/`) - Go
High-performance GraphQL router that handles federation query planning and execution. Key features:
- GraphQL federation query planning with `graphql-go-tools`
- WebSocket subscriptions and realtime updates
- OpenTelemetry tracing and Prometheus metrics
- Plugin system for custom middleware
- Circuit breaker and rate limiting
- Authentication and CORS handling

### Control Plane (`/controlplane/`) - TypeScript/Node.js
Central management API built with Fastify that orchestrates the federation platform:
- Schema registry and composition management
- Federated graph lifecycle management
- Authentication via Keycloak integration
- PostgreSQL for application data, ClickHouse for analytics
- Background job processing with BullMQ
- Webhook and audit logging systems

### Studio (`/studio/`) - Next.js/React
Web-based management UI providing:
- Graph visualization and schema explorer
- Analytics dashboard with metrics and traces
- GraphQL playground for query testing
- Team management and RBAC
- Real-time composition error reporting

### CLI (`/cli/`) - TypeScript
Command-line interface (`wgc`) for developers and CI/CD:
- Schema publishing and validation
- Composition checks and router config generation
- Local development workflow support
- Integration with CI/CD pipelines

### Composition Engine (`/composition/`) - TypeScript
Core GraphQL federation composition logic:
- Subgraph federation and validation
- Schema composition and merging
- Router configuration generation
- Apollo Federation directive compatibility

### GraphQL Metrics (`/graphqlmetrics/`) - Go
Specialized analytics service with ClickHouse integration:
- Schema usage tracking and operation metrics
- Performance analytics and time-series data
- High-performance metrics collection

## Key Architectural Patterns

### Federation Flow
1. Subgraphs register schemas via CLI or API
2. Control plane composes schemas into unified federated graph
3. Router receives generated configuration with routing rules
4. Router plans and executes federated queries across subgraphs
5. Metrics and traces collected for observability

### Technology Stack
- **Go**: High-performance components (Router, GraphQL Metrics)
- **TypeScript**: Management and composition logic (Control Plane, Studio, CLI)
- **Protocol Buffers**: Type-safe inter-service communication
- **PostgreSQL**: Primary application database
- **ClickHouse**: Analytics and time-series data
- **Redis**: Caching and rate limiting
- **Keycloak**: Authentication and authorization

### Development Environment
- **Monorepo**: pnpm workspaces for TypeScript packages
- **Docker Compose**: Local development infrastructure
- **Make**: Build and development orchestration
- **Protocol Buffer code generation**: Shared types across Go/TypeScript

## Working with Specific Components

### Router Development
- Entry point: `/router/cmd/main.go`
- Configuration: `config.yaml` files in router directory
- Plugin development: Implement interfaces in `/router/core/`
- Testing: Use `/router-tests/` for integration tests

### Control Plane Development
- Entry point: `/controlplane/src/index.ts`
- Database: Use Drizzle ORM with PostgreSQL
- API: Fastify server with Connect RPC
- Testing: Vitest for unit tests

### Studio Development
- Entry point: `/studio/src/`
- Framework: Next.js 15 with React 18
- Styling: Tailwind CSS with Radix UI components
- State: TanStack Query for server state

### CLI Development
- Entry point: `/cli/src/index.ts`
- Commands: Add new commands in `/cli/src/commands/`
- Testing: Use test fixtures in `/cli/test/`

## Configuration Files

### Router Configuration
- `config.yaml` - Main router configuration
- Environment variables for runtime configuration
- Graph-specific routing rules generated by composition

### Control Plane Configuration
- Environment variables in `.env` file
- Database configuration via Drizzle
- Keycloak integration settings

### Docker Configuration
- `docker-compose.yml` - Development infrastructure
- `docker-compose.full.yml` - Complete platform deployment
- Individual Dockerfiles for each component

## Dependencies and Package Management

### Node.js/TypeScript
- **Package Manager**: pnpm (version 9+)
- **Node Version**: 22.11.0+
- **Workspace**: Configured in `pnpm-workspace.yaml`
- **Overrides**: React 18.3.1, GraphQL 16.9.0 (see root package.json)

### Go
- **Go Version**: 1.23+
- **Modules**: Each Go component has its own go.mod
- **Workspace**: Create personal `go.work` file if needed

### Protocol Buffers
- **Buf**: Used for code generation
- **Templates**: `buf.ts.gen.yaml` for TypeScript, `buf.*.go.gen.yaml` for Go
- **Generation**: `pnpm generate` command

## Testing Strategy

### Unit Tests
- TypeScript: Vitest framework
- Go: Standard Go testing with testify
- Location: `test/` or `*_test.go` files

### Integration Tests
- Router: `/router-tests/` directory with comprehensive test suite
- Control Plane: Database-backed tests with test utilities
- End-to-end: Via demo environment setup

### Test Database
- PostgreSQL with test-specific configurations
- ClickHouse for analytics testing
- Docker containers for isolated testing

## Deployment

### Local Development
- Use `make` commands for orchestrated setup
- Docker Compose for infrastructure dependencies
- Individual component development servers

### Production Deployment
- Kubernetes via Helm chart in `/helm/cosmo/`
- Docker images for each component
- Configurable external dependencies (managed PostgreSQL, Redis, etc.)

## Important Notes

- Always run `pnpm generate` after Protocol Buffer changes
- Use conventional commits for changelog generation
- Run `pnpm lint:fix` before committing
- Database migrations are managed via Drizzle in control plane
- Router configuration is generated by composition engine
- Studio connects to control plane via Connect RPC over HTTP