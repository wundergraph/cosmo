# Contributing to the WunderGraph CLI Repository

Before contributing to the WunderGraph CLI repository, please open an issue to discuss your proposed changes and apply the `cli` label. Alternatively, open a thread in [WunderGraph Discussions](https://github.com/wundergraph/cosmo/discussions) and apply the `cli` label.

## Prerequisites

See the [README](./README.md).

## Folder structure

```text
cli/
|-- src/
|   |-- index.ts                 # Executable entry point
|   |-- commands/
|   |   |-- index.ts             # Registers all top-level commands
|   |   `-- <command-group>/
|   |       |-- index.ts         # Defines and registers a command group
|   |       |-- commands/        # Subcommand implementations
|   |       |-- common/          # Code shared within the group, when needed
|   |       |-- types/           # Group-specific types, when needed
|   |       `-- utils/           # Group-specific utilities, when needed
|   |-- core/                    # API client, configuration, telemetry, and other shared services
|   `-- typedefinitions/         # Type declarations for untyped dependencies
|-- test/
|   |-- fixtures/                # Reusable GraphQL test fixtures
|   |-- testdata/                # Input files used by tests
|   `-- **/*.test.ts             # Unit and integration tests
|-- e2e/                         # End-to-end smoke tests
|-- scripts/                     # Build and maintenance scripts
```

Most command groups use the same layout: export a Commander command from `src/commands/<command-group>/index.ts`, keep each subcommand in its own file under `commands/`, and place code shared only by that group in a nearby `common/`, `types/`, or `utils/` directory. Cross-command infrastructure belongs in `src/core/`; broadly shared presentation and result-handling helpers belong directly in `src/`.

## Patterns

### 1. Provide machine-readable output for commands

Each command or subcommand should provide a `--json` flag. This makes it easy to combine the WunderGraph CLI with other tools and use it in CI environments. When this flag is used, return error states and messages in JSON format as well.

### 2. Avoid throwing; prefer result objects

When representing an invariant violation or a specific application error, do not use `throw` statements. Instead, have your function return a _result_ object with a `success` property and either `data` or `errors`:

```typescript
{
  success: true;
  data: Record<string, unknown>; // <-- provide actual type
} |
{
  success: false;
  errors: Array<Error>;
}
```

This avoids `try/catch` statements because invalid states can be checked with simple `if` blocks. Using `try/catch` leads to unwieldy code, especially when the blocks are nested.

> [!TIP]
> A top-level `try/catch` statement intercepts and formats unexpected runtime errors.

To have the application exit with an error, use one of these options:

1. `program.error()`: Sets the exit code to `1` and accepts an error message.
2. `process.exitCode = 1`: Sets the exit code explicitly for code paths that produce JSON output.
