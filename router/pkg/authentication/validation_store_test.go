package authentication

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"strings"
	"testing"

	"github.com/MicahParks/jwkset"
	"go.uber.org/zap"
)

func makeEd25519JWK(t *testing.T, kid string, alg string, setAlg bool) jwkset.JWK {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate ed25519 key: %v", err)
	}

	meta := jwkset.JWKMetadataOptions{KID: kid, USE: jwkset.UseSig}
	if setAlg {
		meta.ALG = jwkset.ALG(alg)
	}
	options := jwkset.JWKOptions{Metadata: meta}

	j, err := jwkset.NewJWKFromKey(priv, options)
	if err != nil {
		t.Fatalf("failed to create JWK: %v", err)
	}
	return j
}

func makeES256JWK(t *testing.T, kid string) jwkset.JWK {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate ecdsa p256 key: %v", err)
	}
	meta := jwkset.JWKMetadataOptions{KID: kid, USE: jwkset.UseSig, ALG: jwkset.AlgES256}
	options := jwkset.JWKOptions{Metadata: meta}
	j, err := jwkset.NewJWKFromKey(priv, options)
	if err != nil {
		t.Fatalf("failed to create JWK: %v", err)
	}
	return j
}

func TestKeyWriteAndRead_SupportedAlg(t *testing.T) {
	ctx := context.Background()
	store := NewValidationStore(zap.NewNop(), nil, nil, false)

	good := makeEd25519JWK(t, "good-ed", "EdDSA", true)
	if err := store.KeyWrite(ctx, good); err != nil {
		t.Fatalf("KeyWrite failed: %v", err)
	}

	got, err := store.KeyRead(ctx, "good-ed")
	if err != nil {
		t.Fatalf("KeyRead failed: %v", err)
	}
	if got.Marshal().KID != "good-ed" || got.Marshal().ALG.String() != "EdDSA" {
		t.Fatalf("unexpected key metadata: kid=%q alg=%q", got.Marshal().KID, got.Marshal().ALG.String())
	}
}

func TestKeyWrite_SkipsUnsupportedAlg(t *testing.T) {
	ctx := context.Background()
	store := NewValidationStore(zap.NewNop(), nil, nil, false)

	bad := makeEd25519JWK(t, "bad", "FOO", true)
	if err := store.KeyWrite(ctx, bad); err != nil {
		t.Fatalf("KeyWrite returned error for unsupported alg (should skip without error): %v", err)
	}

	if _, err := store.KeyRead(ctx, "bad"); err == nil {
		t.Fatalf("expected KeyRead to fail for skipped unsupported key")
	}

	all, err := store.KeyReadAll(ctx)
	if err != nil {
		t.Fatalf("KeyReadAll failed: %v", err)
	}
	if len(all) != 0 {
		t.Fatalf("expected 0 keys, got %d", len(all))
	}
}

func TestAllowEmptyAlgorithm(t *testing.T) {
	ctx := context.Background()

	// allowEmptyAlgorithm = true accepts keys without ALG
	storeAllow := NewValidationStore(zap.NewNop(), nil, nil, true)
	noAlg := makeEd25519JWK(t, "noalg", "", false)
	if err := storeAllow.KeyWrite(ctx, noAlg); err != nil {
		t.Fatalf("KeyWrite failed: %v", err)
	}
	if _, err := storeAllow.KeyRead(ctx, "noalg"); err != nil {
		t.Fatalf("expected KeyRead to succeed for empty ALG when allowed, got: %v", err)
	}

	// allowEmptyAlgorithm = false skips keys without ALG
	storeDeny := NewValidationStore(zap.NewNop(), nil, nil, false)
	if err := storeDeny.KeyWrite(ctx, noAlg); err != nil {
		t.Fatalf("KeyWrite returned error for empty ALG (should skip without error): %v", err)
	}
	if _, err := storeDeny.KeyRead(ctx, "noalg"); err == nil {
		t.Fatalf("expected KeyRead to fail for skipped empty-ALG key")
	}
}

func TestRestrictAlgorithmsList(t *testing.T) {
	ctx := context.Background()
	store := NewValidationStore(zap.NewNop(), nil, []string{"ES256"}, false)

	// EdDSA should be rejected when only ES256 is allowed
	ed := makeEd25519JWK(t, "ed", "EdDSA", true)
	if err := store.KeyWrite(ctx, ed); err != nil {
		t.Fatalf("KeyWrite returned error while skipping disallowed alg: %v", err)
	}
	if _, err := store.KeyRead(ctx, "ed"); err == nil {
		t.Fatalf("expected KeyRead to fail for disallowed alg EdDSA")
	}

	// ES256 should be accepted
	es := makeES256JWK(t, "es256")
	if err := store.KeyWrite(ctx, es); err != nil {
		t.Fatalf("KeyWrite failed for ES256: %v", err)
	}
	if _, err := store.KeyRead(ctx, "es256"); err != nil {
		t.Fatalf("expected KeyRead to succeed for ES256, got: %v", err)
	}
}

func TestKeyReplaceAll_Filters(t *testing.T) {
	ctx := context.Background()
	store := NewValidationStore(zap.NewNop(), nil, nil, false)

	good := makeEd25519JWK(t, "good", "EdDSA", true)
	bad := makeEd25519JWK(t, "bad", "FOO", true)
	noAlg := makeEd25519JWK(t, "noalg2", "", false)

	if err := store.KeyReplaceAll(ctx, []jwkset.JWK{good, bad, noAlg}); err != nil {
		t.Fatalf("KeyReplaceAll failed: %v", err)
	}
	keys, err := store.KeyReadAll(ctx)
	if err != nil {
		t.Fatalf("KeyReadAll failed: %v", err)
	}
	if len(keys) != 1 || keys[0].Marshal().KID != "good" {
		t.Fatalf("expected only the supported key to remain, got %d keys (first kid=%q)", len(keys), func() string {
			if len(keys) > 0 {
				return keys[0].Marshal().KID
			}
			return ""
		}())
	}
}

func TestKeyRead_ErrorsWhenInnerHasUnsupportedKey(t *testing.T) {
	ctx := context.Background()
	inner := jwkset.NewMemoryStorage()
	bad := makeEd25519JWK(t, "bad-inner", "FOO", true)
	if err := inner.KeyWrite(ctx, bad); err != nil {
		t.Fatalf("failed to write to inner storage: %v", err)
	}

	store := NewValidationStore(zap.NewNop(), inner, nil, false)
	_, err := store.KeyRead(ctx, "bad-inner")
	if err == nil {
		t.Fatalf("expected error for unsupported algorithm in inner storage")
	}
	if !strings.Contains(err.Error(), "unsupported algorithm") {
		t.Fatalf("expected error to mention unsupported algorithm, got: %v", err)
	}
}
