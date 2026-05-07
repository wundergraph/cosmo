package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// shortSHALen is the number of hex characters from the SHA-256 prefix used to
// derive a stable per-operation identifier. With 8 hex chars (32 bits) the
// birthday-collision probability across a 1k-op session is ~0.012%, which is
// fine for the session-scoped use we have.
const shortSHALen = 8

// ShortSHA returns a stable identifier derived from the operation body. The
// result is a valid JavaScript identifier ("o" prefix + lowercase hex), so
// the model can call `tools.<ShortSHA>(...)` directly without bracket access.
//
// The hash is computed over CanonicalBody(body) so identical operations that
// differ only in whitespace map to the same identifier. This is the key
// invariant: operation identity = operation content. Two operations that
// happen to share a name from yoko but have different bodies get different
// identifiers; two prompts that produce the same body share an identifier.
func ShortSHA(body string) string {
	sum := sha256.Sum256([]byte(CanonicalBody(body)))
	return "o" + hex.EncodeToString(sum[:])[:shortSHALen]
}

// CanonicalBody returns a whitespace-normalized form of a GraphQL operation
// body for equality comparison. Two bodies that differ only in formatting
// (newlines, indentation, repeated spaces) compare equal. It does NOT
// canonicalize alias names, argument order, or fragment expansion.
func CanonicalBody(body string) string {
	return strings.Join(strings.Fields(body), " ")
}
