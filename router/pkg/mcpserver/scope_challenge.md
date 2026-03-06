# Smart Scope Challenge Algorithm

## Problem

When an MCP client calls a tool but lacks the required OAuth scopes, the server must return a `403 Forbidden` with a `WWW-Authenticate` header containing a `scope` parameter. The client uses this to request the right scopes during re-authorization.

The `@requiresScopes` directive uses **OR-of-AND** semantics — there may be multiple valid scope combinations that grant access. Rather than dumping all possible scopes, the server should guide the client toward the **closest satisfiable path** based on what scopes the token already has.

## Scope Representation

Scopes are represented as `[][]string` — a list of AND-groups where satisfying **any one** group grants access:

```
[["a", "b"], ["c", "d"]]  →  (a AND b) OR (c AND d)
```

When an operation touches multiple scoped fields, their requirements are combined via Cartesian product (see `scope_extractor.go`), producing a single `[][]string` for the tool.

## Algorithm: `BestScopeChallenge`

**Input:**
- `tokenScopes` — scopes the client's JWT currently has
- `combinedOrScopes` — the tool's OR-of-AND requirements

**Steps:**

1. If `combinedOrScopes` is empty, return `nil` (no requirements).
2. Build a set from `tokenScopes` for O(1) lookup.
3. For each AND-group, count how many scopes the token is **missing**.
4. If any group has **0 missing**, return `nil` — the token already satisfies the requirement.
5. Pick the group with the **fewest missing** scopes. On ties, pick the **first** group (stable ordering).
6. Return the complete AND-group as the challenge.

**Why return the complete group, not just the missing scopes?**

OAuth authorization requests specify the full set of scopes desired. The client needs the complete group to know what to request — not a diff.

## Examples

### Simple OR (single-scope groups)

```
Required: [["read:fact"], ["read:all"]]
```

| Token scopes | Missing per group | Best group | Challenge |
|---|---|---|---|
| `["read:fact"]` | 0, 1 | satisfied | `nil` |
| `["read:all"]` | 1, 0 | satisfied | `nil` |
| `[]` | 1, 1 | first (tie) | `["read:fact"]` |
| `["other"]` | 1, 1 | first (tie) | `["read:fact"]` |

### AND group with shortcut

```
Required: [["read:employee", "read:private"], ["read:all"]]
```

| Token scopes | Missing per group | Best group | Challenge |
|---|---|---|---|
| `["read:employee", "read:private"]` | 0, 1 | satisfied | `nil` |
| `["read:employee"]` | 1, 1 | first (tie) | `["read:employee", "read:private"]` |
| `[]` | 2, 1 | group 2 | `["read:all"]` |

### Cross-subgraph aggregation

```
Required: [
  ["read:fact", "read:employee", "read:private"],
  ["read:fact", "read:all"],
  ["read:all", "read:employee", "read:private"],
  ["read:all"]
]
```

| Token scopes | Missing per group | Best group | Challenge |
|---|---|---|---|
| `["read:all"]` | 2, 1, 2, 0 | satisfied | `nil` |
| `["read:fact"]` | 2, 1, 2, 1 | group 2 (tie→first) | `["read:fact", "read:all"]` |
| `[]` | 3, 2, 3, 1 | group 4 | `["read:all"]` |

## `BestScopeChallengeWithExisting`

Some MCP client SDKs **replace** rather than **accumulate** scopes when re-authorizing. If the challenge only contains the scopes for the failed operation, the client loses its existing scopes.

When `includeExisting` is `true`, the result is the **union** of the token's current scopes and the best AND-group, deduplicated, preserving order (token scopes first).

Example: token has `["init", "mcp:tools:write", "a"]`, best group is `["a", "b", "d"]`
→ result: `["init", "mcp:tools:write", "a", "b", "d"]`

## `SatisfiesAnyGroup`

A simple check: does the token satisfy at least one AND-group? Returns `true` if requirements are empty/nil (no scopes needed). Used as the gate check before computing a challenge.