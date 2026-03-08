<!-- Generated from standards/router.md - do not edit directly -->
<!-- Edit standards/router.md then run: bun run build:claude-md -->

# Router Standards

---

# Global Standards

## Error Handling

- Always use `%w` to wrap errors when formatting with `fmt.Errorf` instead of `%s` to preserve error chains (#2472)
- Log errors with `zap.Error()` API rather than `zap.Any()` to ensure proper error formatting and structured logging (#2273)
- Check error slices for nil and length before accessing to prevent panics: `if response.Errors == nil || len(response.Errors) < 1` (#2273)
- Avoid internal terminology like "EDFS" in user-facing error messages; use domain-neutral language (#2273)
- Ensure error messages are covered by tests rather than being swallowed silently (#2078)
- Start spans only when operations will proceed to avoid resource waste: check authentication before span creation (#2192)
- Use `logger.Error` level for genuine errors rather than debug/info to ensure visibility in production (#2192)

## Go Code Quality

- Define named zero-value constants for string enums: `const TypeInvalid Type = ""` to handle default cases gracefully (#2192, #2236)
- Use early returns with guard clauses instead of deeply nested if-else blocks for better readability (#2235, #2323)
- Apply consistent patterns for stateful APIs like `keyGen.Reset()` - establish whether reset happens before or after usage (#2318)
- Leverage modern Go 1.25+ features: `range N`, `slices.ContainsFunc`, and `wg.Go()` instead of legacy patterns (#2280, #2288, #2379)
- Use `sync.Map` for read-heavy operations with occasional writes rather than mutex-protected maps (#2379)
- Simplify single-field access: replace struct when only accessing one field like `config.Enabled` (#2288)
- Use `t.TempDir()` in tests instead of manual directory creation and cleanup to avoid boilerplate (#2379)

## Testing

- Separate flaky tests into dedicated functions with retry logic, marking stable tests as non-retryable (#2234)
- Write descriptive test names that explain expectations: `"should succeed with valid token"` instead of generic names (#2067)
- Use explicit field names in test structs rather than positional boolean values: avoid `false, false, false` patterns (#2318)
- Use typed errors and `errors.As/errors.Is` for testable error conditions instead of generic error strings (#2273)
- Test error paths and edge cases, not just happy paths - ensure error messages surface in test coverage (#2078)
- Use testify comparison functions with correct parameter order: `require.Equal(t, expected, actual)` (#2090)

## Configuration

- Support environment variables for all configuration options using `envprefix` tag following the project conventions (#2296, #2379)
- Document configuration option interactions and validate conflicting settings at startup rather than runtime (#2192)
- Use concrete, descriptive names for configuration fields rather than generic terms like "Enable" or "Debug" (#2235)
- Validate configuration in JSON schema with appropriate constraints and default values (#2379)
- Test environment variable configuration for both global and subgraph-specific settings (#2514)

## GraphQL Federation

- Exclude `@requires` fields from entity proto messages since they're resolved by different RPCs (#2439)
- Return composition errors for unresolvable fields involving shared root query fields and unreachable nested entities (#2298)
- Include federation debugging metadata like `fetch_reasons` only for upstream subgraphs, not client responses (#2160)
- Validate federation directives and entity keys during schema composition rather than at runtime (#2439)

## Authentication

- Exclude symmetric algorithms (HS256, HS384, HS512) from JWKS validation to enforce asymmetric key usage (#2067)
- Fail loudly when authentication configuration is ambiguous rather than silently choosing defaults (#2216)
- Use descriptive function names for security operations: prefer domain-specific names over generic utilities (#2431)
- Validate audience claims only when explicitly configured - empty audience list should skip validation (#2074)

## PubSub

- Include `"__typename": "edfs__PublishResult"` prefix in all publish response JSON for proper type identification (#2273)
- Implement nil safety checks before setting event data: `if e == nil` guards to prevent panics (#2304)
- Use configurable timeouts for hook execution rather than hardcoded values, with clear timeout documentation (#2329)
- Perform deep copies of event data when crossing module boundaries to prevent data races (#2087)
- Log hook timeout violations with enough context for debugging: include hook type and subscription details (#2329)

## Database

- Wrap related database operations in transactions to ensure consistency, especially for delete operations (#2553)
- Abstract business logic into repository methods rather than handling it directly in request handlers (#2553)
- Use parameterized queries consistently to prevent SQL injection, even for escaped parameters (#2331)

## Performance

- Process data before caching rather than on every cache retrieval to reduce repeated work (#2318)
- Use early returns and guard clauses to avoid expensive operations: `if condition { return }` pattern (#2323)
- Choose appropriate data structures for access patterns: `sync.Map` for read-heavy scenarios (#2379)
- Optimize hot paths in request processing by avoiding unnecessary allocations and repeated parsing (#2074)

## Proto/gRPC

- Enforce single GraphQL operation per document when generating proto definitions (#2302)
- Use consistent proto message naming conventions: `ResolveUserPostArgs`, `ResolveUserPostContext` patterns (#2290)
- Implement fail-fast validation in proto processing rather than silent fallbacks (#2379)
- Generate proto field numbers deterministically and maintain lock files for stability across builds (#2086)

## Configuration Schema

- Set appropriate default values in JSON schema rather than code to ensure consistency across environments (#2068)
- Document units and limits clearly in schema descriptions: specify bytes vs bits, include examples (#2060)
- Use enum constraints where possible to prevent invalid configuration values (#2379)
