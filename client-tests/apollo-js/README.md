# Apollo JS Tests

This project contains tests for Apollo Client in TypeScript, testing GraphQL queries against a GraphQL server.

## Prerequisites

- Node.js (v14 or higher)
- pnpm
- A running GraphQL server at `http://localhost:3002/graphql`

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Run tests:
```bash
pnpm test
```

## Test Commands

- `pnpm test`: Run tests once
- `pnpm test:watch`: Run tests in watch mode
- `pnpm test:coverage`: Run tests with coverage report

## Tests

The project includes the following tests:

1. `testFailingQuery`: Tests error handling for an invalid query
2. `testSuccessQuery`: Tests successful query execution

## Project Structure

- `src/__tests__/ClientTest.ts`: Main test file containing the test cases
- `src/graphql/`: Directory containing GraphQL query files
  - `QuerySuccess.graphql`: Query for successful employee data retrieval
  - `QueryFailure.graphql`: Query that should fail due to invalid field

## Dependencies

- `@apollo/client`: Apollo Client for GraphQL operations
- `typescript`: TypeScript support
- `vitest`: Testing framework 