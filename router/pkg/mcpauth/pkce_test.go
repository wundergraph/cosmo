package mcpauth

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func TestVerifyPKCEChallenge(t *testing.T) {
	tests := []struct {
		name          string
		codeVerifier  string
		codeChallenge string
		expected      bool
	}{
		{
			name:          "valid PKCE pair",
			codeVerifier:  "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
			codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
			expected:      true,
		},
		{
			name:          "invalid challenge for verifier",
			codeVerifier:  "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
			codeChallenge: "invalid_challenge",
			expected:      false,
		},
		{
			name:          "empty code verifier",
			codeVerifier:  "",
			codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
			expected:      false,
		},
		{
			name:          "empty code challenge",
			codeVerifier:  "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
			codeChallenge: "",
			expected:      false,
		},
		{
			name:          "both empty",
			codeVerifier:  "",
			codeChallenge: "",
			expected:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := verifyPKCEChallenge(tt.codeVerifier, tt.codeChallenge)
			if result != tt.expected {
				t.Errorf("verifyPKCEChallenge(%q, %q) = %v, want %v",
					tt.codeVerifier, tt.codeChallenge, result, tt.expected)
			}
		})
	}
}

func TestPKCEChallengeGeneration(t *testing.T) {
	// Test that we can generate a challenge from a verifier and verify it
	codeVerifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

	// Generate challenge manually to verify our implementation
	hash := sha256.Sum256([]byte(codeVerifier))
	expectedChallenge := base64.RawURLEncoding.EncodeToString(hash[:])

	// This should match the test vector from RFC 7636
	expectedRFC := "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

	if expectedChallenge != expectedRFC {
		t.Errorf("Generated challenge %q doesn't match RFC 7636 example %q",
			expectedChallenge, expectedRFC)
	}

	// Verify our function works with the generated challenge
	if !verifyPKCEChallenge(codeVerifier, expectedChallenge) {
		t.Errorf("verifyPKCEChallenge failed to verify generated challenge")
	}
}
