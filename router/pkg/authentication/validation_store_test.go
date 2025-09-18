package authentication

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"testing"

	"github.com/MicahParks/jwkset"
	requires "github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestValidationStore(t *testing.T) {
	// verify KeyWrite
	t.Run("verify KeyWrite", func(t *testing.T) {
		ctx := context.Background()

		t.Run("accepts supported algorithms without filter", func(t *testing.T) {
			inner := jwkset.NewMemoryStorage()
			store, _ := NewValidationStore(nil, inner, nil, false)
			keys := []jwkset.JWK{
				genRSAJWK(t, "rsa1", jwkset.AlgRS256),
				genHMACJWK(t, "hmac1", jwkset.AlgHS256),
				genEd25519JWK(t, "eddsa1"),
			}
			for _, k := range keys {
				requires.NoError(t, store.KeyWrite(ctx, k))
			}
			allInner, err := inner.KeyReadAll(ctx)
			requires.NoError(t, err)
			requires.Len(t, allInner, len(keys))
		})

		t.Run("skips disallowed algorithms when filtered", func(t *testing.T) {
			inner := jwkset.NewMemoryStorage()
			store, _ := NewValidationStore(zap.NewNop(), inner, []string{"RS256"}, false)
			allowed := genRSAJWK(t, "rsa-allowed", jwkset.AlgRS256)
			disallowed := genHMACJWK(t, "hmac-blocked", jwkset.AlgHS256)
			requires.NoError(t, store.KeyWrite(ctx, allowed))
			requires.NoError(t, store.KeyWrite(ctx, disallowed)) // skipped, not error
			all, err := inner.KeyReadAll(ctx)
			requires.NoError(t, err)
			requires.Len(t, all, 1)
			requires.Equal(t, allowed.Marshal().KID, all[0].Marshal().KID)
		})
	})

	t.Run("verify KeyRead", func(t *testing.T) {
		ctx := context.Background()
		inner := jwkset.NewMemoryStorage()
		allowed := genRSAJWK(t, "rsa-1", jwkset.AlgRS256)
		disallowed := genHMACJWK(t, "hmac-1", jwkset.AlgHS256)
		requires.NoError(t, inner.KeyWrite(ctx, allowed))
		requires.NoError(t, inner.KeyWrite(ctx, disallowed))
		store, _ := NewValidationStore(zap.NewNop(), inner, []string{"RS256"}, false)

		_, err := store.KeyRead(ctx, allowed.Marshal().KID)
		requires.NoError(t, err)
		_, err = store.KeyRead(ctx, disallowed.Marshal().KID)
		requires.ErrorContains(t, err, "unsupported algorithm")
	})

	t.Run("verify KeyReadAll", func(t *testing.T) {
		ctx := context.Background()
		inner := jwkset.NewMemoryStorage()
		allowed := genRSAJWK(t, "rsa-1", jwkset.AlgRS256)
		disallowed := genHMACJWK(t, "hmac-1", jwkset.AlgHS256)
		requires.NoError(t, inner.KeyWrite(ctx, allowed))
		requires.NoError(t, inner.KeyWrite(ctx, disallowed))
		store, _ := NewValidationStore(zap.NewNop(), inner, []string{"RS256"}, false)

		keys, err := store.KeyReadAll(ctx)
		requires.NoError(t, err)
		requires.Len(t, keys, 1)
		m := keys[0].Marshal()
		requires.Equal(t, allowed.Marshal().KID, m.KID)
	})

	t.Run("verify KeyReplaceAll", func(t *testing.T) {
		ctx := context.Background()
		inner := jwkset.NewMemoryStorage()
		store, _ := NewValidationStore(zap.NewNop(), inner, []string{"RS256"}, false)

		allowed := genRSAJWK(t, "rsa-1", jwkset.AlgRS256)
		disallowed := genHMACJWK(t, "hmac-1", jwkset.AlgHS256)

		requires.NoError(t, store.KeyReplaceAll(ctx, []jwkset.JWK{allowed, disallowed}))

		all, err := inner.KeyReadAll(ctx)
		requires.NoError(t, err)
		requires.Len(t, all, 1)
		requires.Equal(t, allowed.Marshal().KID, all[0].Marshal().KID)
	})

	t.Run("verify KeyDelete", func(t *testing.T) {
		ctx := context.Background()
		inner := jwkset.NewMemoryStorage()
		store, _ := NewValidationStore(zap.NewNop(), inner, nil, false)

		key := genRSAJWK(t, "rsa-del", jwkset.AlgRS256)
		requires.NoError(t, store.KeyWrite(ctx, key))
		ok, err := store.KeyDelete(ctx, key.Marshal().KID)
		requires.NoError(t, err)
		requires.True(t, ok)
		_, err = inner.KeyRead(ctx, key.Marshal().KID)
		requires.ErrorContains(t, err, "not found")
	})

	t.Run("verify JSON", func(t *testing.T) {
		ctx := context.Background()
		inner := jwkset.NewMemoryStorage()
		allowed := genRSAJWK(t, "rsa-json", jwkset.AlgRS256)
		disallowed := genHMACJWK(t, "hmac-json", jwkset.AlgHS256)
		requires.NoError(t, inner.KeyWrite(ctx, allowed))
		requires.NoError(t, inner.KeyWrite(ctx, disallowed))
		store, _ := NewValidationStore(zap.NewNop(), inner, []string{"RS256"}, false)

		a, err := store.JSON(ctx)
		requires.NoError(t, err)
		b, err := inner.JSON(ctx)
		requires.NoError(t, err)
		requires.JSONEq(t, string(b), string(a))
	})

	t.Run("verify JSONPublic", func(t *testing.T) {
		ctx := context.Background()
		inner := jwkset.NewMemoryStorage()
		allowed := genRSAJWK(t, "rsa-json", jwkset.AlgRS256)
		disallowed := genHMACJWK(t, "hmac-json", jwkset.AlgHS256)
		requires.NoError(t, inner.KeyWrite(ctx, allowed))
		requires.NoError(t, inner.KeyWrite(ctx, disallowed))
		store, _ := NewValidationStore(zap.NewNop(), inner, []string{"RS256"}, false)

		a, err := store.JSONPublic(ctx)
		requires.NoError(t, err)
		b, err := inner.JSONPublic(ctx)
		requires.NoError(t, err)
		requires.JSONEq(t, string(b), string(a))
	})

	t.Run("verify JSONPrivate", func(t *testing.T) {
		ctx := context.Background()
		inner := jwkset.NewMemoryStorage()
		allowed := genRSAJWK(t, "rsa-json", jwkset.AlgRS256)
		disallowed := genHMACJWK(t, "hmac-json", jwkset.AlgHS256)
		requires.NoError(t, inner.KeyWrite(ctx, allowed))
		requires.NoError(t, inner.KeyWrite(ctx, disallowed))
		store, _ := NewValidationStore(zap.NewNop(), inner, []string{"RS256"}, false)

		a, err := store.JSONPrivate(ctx)
		requires.NoError(t, err)
		b, err := inner.JSONPrivate(ctx)
		requires.NoError(t, err)
		requires.JSONEq(t, string(b), string(a))
	})

	t.Run("verify JSONWithOptions", func(t *testing.T) {
		ctx := context.Background()
		inner := jwkset.NewMemoryStorage()
		allowed := genRSAJWK(t, "rsa-json", jwkset.AlgRS256)
		disallowed := genHMACJWK(t, "hmac-json", jwkset.AlgHS256)
		requires.NoError(t, inner.KeyWrite(ctx, allowed))
		requires.NoError(t, inner.KeyWrite(ctx, disallowed))
		store, _ := NewValidationStore(zap.NewNop(), inner, []string{"RS256"}, false)

		a, err := store.JSONWithOptions(ctx, jwkset.JWKMarshalOptions{}, jwkset.JWKValidateOptions{})
		requires.NoError(t, err)
		b, err := inner.JSONWithOptions(ctx, jwkset.JWKMarshalOptions{}, jwkset.JWKValidateOptions{})
		requires.NoError(t, err)
		requires.JSONEq(t, string(b), string(a))
	})

	t.Run("verify Marshal", func(t *testing.T) {
		ctx := context.Background()
		inner := jwkset.NewMemoryStorage()
		allowed := genRSAJWK(t, "rsa-json", jwkset.AlgRS256)
		disallowed := genHMACJWK(t, "hmac-json", jwkset.AlgHS256)
		requires.NoError(t, inner.KeyWrite(ctx, allowed))
		requires.NoError(t, inner.KeyWrite(ctx, disallowed))
		store, _ := NewValidationStore(zap.NewNop(), inner, []string{"RS256"}, false)

		ma, err := store.Marshal(ctx)
		requires.NoError(t, err)
		mb, err := inner.Marshal(ctx)
		requires.NoError(t, err)
		requires.Equal(t, len(mb.Keys), len(ma.Keys))
	})

	t.Run("verify MarshalWithOptions", func(t *testing.T) {
		ctx := context.Background()
		inner := jwkset.NewMemoryStorage()
		allowed := genRSAJWK(t, "rsa-json", jwkset.AlgRS256)
		disallowed := genHMACJWK(t, "hmac-json", jwkset.AlgHS256)
		requires.NoError(t, inner.KeyWrite(ctx, allowed))
		requires.NoError(t, inner.KeyWrite(ctx, disallowed))
		store, _ := NewValidationStore(zap.NewNop(), inner, []string{"RS256"}, false)

		ma, err := store.MarshalWithOptions(ctx, jwkset.JWKMarshalOptions{}, jwkset.JWKValidateOptions{})
		requires.NoError(t, err)
		mb, err := inner.MarshalWithOptions(ctx, jwkset.JWKMarshalOptions{}, jwkset.JWKValidateOptions{})
		requires.NoError(t, err)
		requires.Equal(t, len(mb.Keys), len(ma.Keys))
	})
}

func genRSAJWK(t *testing.T, kid string, alg jwkset.ALG) jwkset.JWK {
	t.Helper()
	pk, err := rsa.GenerateKey(rand.Reader, 2048)
	requires.NoError(t, err)
	opts := jwkset.JWKOptions{
		Marshal:  jwkset.JWKMarshalOptions{Private: false},
		Metadata: jwkset.JWKMetadataOptions{ALG: alg, KID: kid, USE: jwkset.UseSig},
	}
	j, err := jwkset.NewJWKFromKey(pk, opts)
	requires.NoError(t, err)
	return j
}

func genHMACJWK(t *testing.T, kid string, alg jwkset.ALG) jwkset.JWK {
	t.Helper()
	secret := make([]byte, 64)
	_, err := rand.Read(secret)
	requires.NoError(t, err)
	// Use HMAC to derive a stable-length key material; any []byte works for JWK creation.
	h := hmac.New(sha256.New, secret)
	_, err = h.Write([]byte("test"))
	requires.NoError(t, err)
	key := h.Sum(nil)
	opts := jwkset.JWKOptions{
		Marshal:  jwkset.JWKMarshalOptions{Private: true},
		Metadata: jwkset.JWKMetadataOptions{ALG: alg, KID: kid, USE: jwkset.UseSig},
	}
	j, err := jwkset.NewJWKFromKey(key, opts)
	requires.NoError(t, err)
	return j
}

func genEd25519JWK(t *testing.T, kid string) jwkset.JWK {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	requires.NoError(t, err)
	opts := jwkset.JWKOptions{
		Marshal:  jwkset.JWKMarshalOptions{Private: false},
		Metadata: jwkset.JWKMetadataOptions{ALG: jwkset.AlgEdDSA, KID: kid, USE: jwkset.UseSig},
	}
	j, err := jwkset.NewJWKFromKey(priv, opts)
	requires.NoError(t, err)
	return j
}
