---
path: "cli/**"
---

# CLI Standards

Looking at the CLI subsystem comments, here are the focused review rules:

- Use `if` statements instead of `switch` statements for single-case language conditionals in plugin commands (#2293)
- Consolidate multiple parameters into typed options objects rather than passing infinite parameters to functions (#2302)
- Store plugin templates and grpc-service templates in separate directories for better organization (#2033)
- Prefix file paths with `@` (e.g., `@path/to/file.json`) when accepting file input via CLI flags (#2302)
- Use arrays with `.includes()` for file extension validation instead of chained `||` conditions (#2302)
- Combine `await` and `.catch()` for cleaner error handling instead of nested try/catch blocks (#2033)
- Use `node:fs` or `node:fs/promises` consistently throughout CLI commands (#2033)
- Chain Command builder methods for better TypeScript typing in action parameters (#2033)
- Avoid inline `require()` statements - move imports to the top of files (#2302)
- Use `const` declarations for magic numbers like recursion depth limits with explanatory comments (#2302)
- Validate GraphQL operation documents to ensure single operation per document (#2302)
- Document hacky workarounds (like patches) with explanatory comments, not just PR descriptions (#2293)
- Use `.PHONY` (with dot prefix) in Makefiles, not `PHONY` (#2293)
- Handle language-specific logic through dedicated functions rather than scattered conditionals (#2293)
- Pre-calculate uppercase values in variables instead of calling `upperCase()` multiple times (#2302)
