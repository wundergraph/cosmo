package mcpauth

import (
	"crypto/sha256"
	"encoding/base64"
)

// verifyPKCEChallenge verifies that a code_verifier matches the given code_challenge using the S256 method.
// This implements RFC 7636 Section 4.6 for PKCE verification.
//
// Parameters:
//   - codeVerifier: The code verifier sent by the client during token exchange
//   - codeChallenge: The code challenge that was sent during authorization
//
// Returns true if the code_verifier generates the expected code_challenge when hashed with SHA256 and base64url-encoded.
func verifyPKCEChallenge(codeVerifier, codeChallenge string) bool {
	if codeVerifier == "" || codeChallenge == "" {
		return false
	}

	// Calculate SHA256 hash of the code verifier
	hash := sha256.Sum256([]byte(codeVerifier))

	// Base64url-encode the hash (RFC 7636 Section 4.2)
	expectedChallenge := base64.RawURLEncoding.EncodeToString(hash[:])

	// Compare with the provided challenge
	return expectedChallenge == codeChallenge
}
