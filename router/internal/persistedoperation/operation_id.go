package persistedoperation

import (
	"crypto/sha256"
	"encoding/hex"
)

// OperationIDMatchesBody reports whether a persisted operation ID is consistent
// with its body. The router looks up query-only requests by the SHA256 of their
// query, so an ID that looks like a SHA256 hash (64 lowercase hex characters)
// must be the hash of its body. Other IDs are custom IDs and always match.
func OperationIDMatchesBody(id, body string) bool {
	if !IsSHA256ID(id) {
		return true
	}
	sum := sha256.Sum256([]byte(body))
	return hex.EncodeToString(sum[:]) == id
}

// IsSHA256ID reports whether id looks like a SHA256 hash: 64 lowercase hex characters.
func IsSHA256ID(id string) bool {
	if len(id) != sha256.Size*2 {
		return false
	}
	for i := 0; i < len(id); i++ {
		if !isLowerHex(id[i]) {
			return false
		}
	}
	return true
}

func isLowerHex(c byte) bool {
	return c >= '0' && c <= '9' || c >= 'a' && c <= 'f'
}
