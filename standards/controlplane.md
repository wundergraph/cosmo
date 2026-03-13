---
path: "controlplane/**"
---

# Controlplane Standards

- Use `z.coerce` in Zod schemas for environment variable type conversion instead of manual parsing (#2199)
- Prefer POSIX standard utilities like `rm` over non-standard ones like `del` in package.json scripts for portability (#2199)
- Use both `x` and `**/x` glob variants in package.json for shell compatibility across bash/zsh (#2219)
- Use try/catch blocks with await rather than mixing await and catch for proper TypeScript error handling (#2354)
- Use GraphQL.js library utilities (`parseType`, `getNullableType`, `getNamedType`) for AST handling instead of text parsing (#2380)
- Extract shared constants to common locations when used across multiple files instead of duplicating (#2417)
- Validate port ranges (< 65536) in URL validation utilities (#2473)
- Use batched database operations when deleting multiple records instead of individual calls (#2467)
- Pass complete objects as parameters rather than destructuring into individual properties when the whole object is needed (#2271)
- Add unit tests for new utility functions, especially validation and parsing logic (#2131)
- Log authentication errors for debugging, especially for external services like Keycloak (#2443)
- Validate same-origin requirements for authentication redirects to prevent security issues (#2476)
- Use helper functions consistently once created instead of falling back to manual implementations (#2065)
- Consider using arrays instead of tuples in SQL queries when the database client supports it (#2387)
- Check that generated files are properly ignored by formatters to avoid breaking snapshot tests (#2599)
