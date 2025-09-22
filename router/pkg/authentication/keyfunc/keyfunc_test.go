// This is forked from https://github.com/MicahParks/keyfunc/blob/main/keyfunc.go
// Copyrights go to the original author.
package keyfunc

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/MicahParks/jwkset"
	"github.com/golang-jwt/jwt/v5"
)

const (
	keyID = "my-key-id"
)

func TestNew(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate ED25519 key pair. Error: %s", err)
	}
	jwk, err := jwkset.NewJWKFromKey(priv, jwkset.JWKOptions{})
	if err != nil {
		t.Fatalf("Failed to create JWK from ED25519 private key. Error: %s", err)
	}

	serverStore := jwkset.NewMemoryStorage()
	err = serverStore.KeyWrite(ctx, jwk)
	if err != nil {
		t.Fatalf("Failed to write ED25519 public key to server store. Error: %s", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rawJWKS, err := serverStore.JSONPrivate(ctx)
		if err != nil {
			t.Fatalf("Failed to get JWK Set JSON from server store. Error: %s", err)
		}
		_, _ = w.Write(rawJWKS)
	}))
	defer server.Close()

	token := jwt.New(jwt.SigningMethodEdDSA)
	token.Header[jwkset.HeaderKID] = keyID
	signed, err := token.SignedString(priv)
	if err != nil {
		t.Fatalf("Failed to sign JWT. Error: %s", err)
	}

	clientStore, err := jwkset.NewDefaultHTTPClient([]string{server.URL})
	if err != nil {
		t.Fatalf("Failed to create client store. Error: %s", err)
	}
	options := Options{
		Ctx:          ctx,
		Storage:      clientStore,
		UseWhitelist: []jwkset.USE{jwkset.UseSig},
	}
	k, err := New(options)
	if err != nil {
		t.Fatalf("Failed to create keyfunc. Error: %s", err)
	}

	_, err = jwt.Parse(signed, k.Keyfunc)
	if !errors.Is(err, ErrKeyfunc) {
		t.Fatalf("Expected ErrKeyfunc for missing Key ID in header, but got %s.", err)
	}

	metadata := jwkset.JWKMetadataOptions{
		KID: keyID,
		USE: jwkset.UseSig,
	}
	jwkOptions := jwkset.JWKOptions{
		Metadata: metadata,
	}
	jwk, err = jwkset.NewJWKFromKey(priv, jwkOptions)
	if err != nil {
		t.Fatalf("Failed to create JWK from ED25519 private key. Error: %s", err)
	}
	err = serverStore.KeyWrite(ctx, jwk)
	if err != nil {
		t.Fatalf("Failed to write ED25519 public key to server store. Error: %s", err)
	}

	clientStore, err = jwkset.NewDefaultHTTPClient([]string{server.URL})
	if err != nil {
		t.Fatalf("Failed to create client store. Error: %s", err)
	}
	options.Storage = clientStore
	k, err = New(options)
	if err != nil {
		t.Fatalf("Failed to create keyfunc. Error: %s", err)
	}

	_, err = jwt.Parse(signed, k.Keyfunc)
	if err != nil {
		t.Fatalf("Failed to parse JWT. Error: %s", err)
	}

	if !reflect.DeepEqual(k.Storage(), clientStore) {
		t.Fatalf("Expected client store, but got something else.")
	}

	_, err = NewDefault([]string{server.URL})
	if err != nil {
		t.Fatalf("Failed to create keyfunc. Error: %s", err)
	}

	_, err = NewDefaultOverrideCtx(ctx, []string{server.URL}, Override{})
	if err != nil {
		t.Fatalf("Failed to create keyfunc with overrides. Error: %s", err)
	}
}

func TestNewErr(t *testing.T) {
	_, err := New(Options{})
	if !errors.Is(err, ErrKeyfunc) {
		t.Error("Expected ErrKeyfunc, but got nil.")
	}
}

func TestNewJWKJSON(t *testing.T) {
	// Get the JWK as JSON.
	jwksJSON := json.RawMessage(`{"kty": "RSA","e": "AQAB","kid": "ee8d626d","n": "gRda5b0pkgTytDuLrRnNSYhvfMIyM0ASq2ZggY4dVe12JV8N7lyXilyqLKleD-2lziivvzE8O8CdIC2vUf0tBD7VuMyldnZruSEZWCuKJPdgKgy9yPpShmD2NyhbwQIAbievGMJIp_JMwz8MkdY5pzhPECGNgCEtUAmsrrctP5V8HuxaxGt9bb-DdPXkYWXW3MPMSlVpGZ5GiIeTABxqYNG2MSoYeQ9x8O3y488jbassTqxExI_4w9MBQBJR9HIXjWrrrenCcDlMY71rzkbdj3mmcn9xMq2vB5OhfHyHTihbUPLSm83aFWSuW9lE7ogMc93XnrB8evIAk6VfsYlS9Q"}`)

	// Create the keyfunc.Keyfunc.
	k, err := NewJWKJSON(jwksJSON)
	if err != nil {
		t.Fatalf("Failed to create a keyfunc.Keyfunc.\nError: %s", err)
	}

	// Get a JWT to parse.
	jwtB64 := "eyJraWQiOiJlZThkNjI2ZCIsInR5cCI6IkpXVCIsImFsZyI6IlJTMjU2In0.eyJzdWIiOiJXZWlkb25nIiwiYXVkIjoiVGFzaHVhbiIsImlzcyI6Imp3a3Mtc2VydmljZS5hcHBzcG90LmNvbSIsImlhdCI6MTYzMTM2OTk1NSwianRpIjoiNDY2M2E5MTAtZWU2MC00NzcwLTgxNjktY2I3NDdiMDljZjU0In0.LwD65d5h6U_2Xco81EClMa_1WIW4xXZl8o4b7WzY_7OgPD2tNlByxvGDzP7bKYA9Gj--1mi4Q4li4CAnKJkaHRYB17baC0H5P9lKMPuA6AnChTzLafY6yf-YadA7DmakCtIl7FNcFQQL2DXmh6gS9J6TluFoCIXj83MqETbDWpL28o3XAD_05UP8VLQzH2XzyqWKi97mOuvz-GsDp9mhBYQUgN3csNXt2v2l-bUPWe19SftNej0cxddyGu06tXUtaS6K0oe0TTbaqc3hmfEiu5G0J8U6ztTUMwXkBvaknE640NPgMQJqBaey0E4u0txYgyvMvvxfwtcOrDRYqYPBnA"

	// Parse the JWT.
	token, err := jwt.Parse(jwtB64, k.Keyfunc)
	if err != nil {
		t.Fatalf("Failed to parse the JWT.\nError: %s", err)
	}

	// Check if the token is valid.
	if !token.Valid {
		t.Fatalf("The token is not valid.")
	}
}

func TestNewJWKSetJSON(t *testing.T) {
	// Get the JWK Set as JSON.
	jwksJSON := json.RawMessage(`{"keys":[{"kty":"RSA","e":"AQAB","kid":"ee8d626d","n":"gRda5b0pkgTytDuLrRnNSYhvfMIyM0ASq2ZggY4dVe12JV8N7lyXilyqLKleD-2lziivvzE8O8CdIC2vUf0tBD7VuMyldnZruSEZWCuKJPdgKgy9yPpShmD2NyhbwQIAbievGMJIp_JMwz8MkdY5pzhPECGNgCEtUAmsrrctP5V8HuxaxGt9bb-DdPXkYWXW3MPMSlVpGZ5GiIeTABxqYNG2MSoYeQ9x8O3y488jbassTqxExI_4w9MBQBJR9HIXjWrrrenCcDlMY71rzkbdj3mmcn9xMq2vB5OhfHyHTihbUPLSm83aFWSuW9lE7ogMc93XnrB8evIAk6VfsYlS9Q"},{"kty":"EC","crv":"P-256","kid":"711d48d1","x":"tfXCoBU-wXemeQCkME1gMZWK0-UECCHIkedASZR0t-Q","y":"9xzYtnKQdiQJHCtGwpZWF21eP1fy5x4wC822rCilmBw"},{"kty":"EC","crv":"P-384","kid":"d52c9829","x":"tFx6ev6eLs9sNfdyndn4OgbhV6gPFVn7Ul0VD5vwuplJLbIYeFLI6T42tTaE5_Q4","y":"A0gzB8TqxPX7xMzyHH_FXkYG2iROANH_kQxBovSeus6l_QSyqYlipWpBy9BhY9dz"},{"kty":"RSA","e":"AQAB","kid":"ecac72e5","n":"nLbnTvZAUxdmuAbDDUNAfha6mw0fri3UpV2w1PxilflBuSnXJhzo532-YQITogoanMjy_sQ8kHUhZYHVRR6vLZRBBbl-hP8XWiCe4wwioy7Ey3TiIUYfW-SD6I42XbLt5o-47IR0j5YDXxnX2UU7-UgR_kITBeLDfk0rSp4B0GUhPbP5IDItS0MHHDDS3lhvJomxgEfoNrp0K0Fz_s0K33hfOqc2hD1tSkX-3oDTQVRMF4Nxax3NNw8-ahw6HNMlXlwWfXodgRMvj9pcz8xUYa3C5IlPlZkMumeNCFx1qds6K_eYcU0ss91DdbhhE8amRX1FsnBJNMRUkA5i45xkOIx15rQN230zzh0p71jvtx7wYRr5pdMlwxV0T9Ck5PCmx-GzFazA2X6DJ0Xnn1-cXkRoZHFj_8Mba1dUrNz-NWEk83uW5KT-ZEbX7nzGXtayKWmGb873a8aYPqIsp6bQ_-eRBd8TDT2g9HuPyPr5VKa1p33xKaohz4DGy3t1Qpy3UWnbPXUlh5dLWPKz-TcS9FP5gFhWVo-ZhU03Pn6P34OxHmXGWyQao18dQGqzgD4e9vY3rLhfcjVZJYNlWY2InsNwbYS-DnienPf1ws-miLeXxNKG3tFydoQzHwyOxG6Wc-HBfzL_hOvxINKQamvPasaYWl1LWznMps6elKCgKDc"},{"kty":"EC","crv":"P-521","kid":"c570888f","x":"AHNpXq0J7rikNRlwhaMYDD8LGVAVJzNJ-jEPksUIn2LB2LCdNRzfAhgbxdQcWT9ktlc9M1EhmTLccEqfnWdGL9G1","y":"AfHPUW3GYzzqbTczcYR0nYMVMFVrYsUxv4uiuSNV_XRN3Jf8zeYbbOLJv4S3bUytO7qHY8bfZxPxR9nn3BBTf5ol"}]}`)

	// Create the keyfunc.Keyfunc.
	k, err := NewJWKSetJSON(jwksJSON)
	if err != nil {
		t.Fatalf("Failed to create a keyfunc.Keyfunc.\nError: %s", err)
	}

	// Get a JWT to parse.
	jwtB64 := "eyJraWQiOiJlZThkNjI2ZCIsInR5cCI6IkpXVCIsImFsZyI6IlJTMjU2In0.eyJzdWIiOiJXZWlkb25nIiwiYXVkIjoiVGFzaHVhbiIsImlzcyI6Imp3a3Mtc2VydmljZS5hcHBzcG90LmNvbSIsImlhdCI6MTYzMTM2OTk1NSwianRpIjoiNDY2M2E5MTAtZWU2MC00NzcwLTgxNjktY2I3NDdiMDljZjU0In0.LwD65d5h6U_2Xco81EClMa_1WIW4xXZl8o4b7WzY_7OgPD2tNlByxvGDzP7bKYA9Gj--1mi4Q4li4CAnKJkaHRYB17baC0H5P9lKMPuA6AnChTzLafY6yf-YadA7DmakCtIl7FNcFQQL2DXmh6gS9J6TluFoCIXj83MqETbDWpL28o3XAD_05UP8VLQzH2XzyqWKi97mOuvz-GsDp9mhBYQUgN3csNXt2v2l-bUPWe19SftNej0cxddyGu06tXUtaS6K0oe0TTbaqc3hmfEiu5G0J8U6ztTUMwXkBvaknE640NPgMQJqBaey0E4u0txYgyvMvvxfwtcOrDRYqYPBnA"

	// Parse the JWT.
	token, err := jwt.Parse(jwtB64, k.Keyfunc)
	if err != nil {
		t.Fatalf("Failed to parse the JWT.\nError: %s", err)
	}

	// Check if the token is valid.
	if !token.Valid {
		t.Fatalf("The token is not valid.")
	}
}

func TestVerificationKeySet(t *testing.T) {
	ctx := context.Background()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate ED25519 key pair: %v", err)
	}
	jwk, err := jwkset.NewJWKFromKey(priv, jwkset.JWKOptions{})
	if err != nil {
		t.Fatalf("Failed to create JWK: %v", err)
	}
	store := jwkset.NewMemoryStorage()
	err = store.KeyWrite(ctx, jwk)
	if err != nil {
		t.Fatalf("Failed to write JWK: %v", err)
	}
	k, err := New(Options{Ctx: ctx, Storage: store})
	if err != nil {
		t.Fatalf("Failed to create Keyfunc: %v", err)
	}
	vks, err := k.VerificationKeySet(ctx)
	if err != nil {
		t.Fatalf("VerificationKeySet failed: %v", err)
	}
	if len(vks.Keys) != 1 {
		t.Fatalf("Expected 1 key, got %d", len(vks.Keys))
	}
}

func TestNoKIDHeaderCallsVerificationKeySet(t *testing.T) {
	ctx := context.Background()

	// Generate two key pairs.
	_, priv1, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate ED25519 key pair 1: %v", err)
	}
	_, priv2, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate ED25519 key pair 2: %v", err)
	}

	jwk1, err := jwkset.NewJWKFromKey(priv1, jwkset.JWKOptions{})
	if err != nil {
		t.Fatalf("Failed to create JWK 1: %v", err)
	}
	jwk2, err := jwkset.NewJWKFromKey(priv2, jwkset.JWKOptions{})
	if err != nil {
		t.Fatalf("Failed to create JWK 2: %v", err)
	}

	orders := [][]jwkset.JWK{
		{jwk1, jwk2},
		{jwk2, jwk1},
	}
	privs := []ed25519.PrivateKey{priv1, priv2}

	for i, order := range orders {
		store := jwkset.NewMemoryStorage()
		for _, jwk := range order {
			err = store.KeyWrite(ctx, jwk)
			if err != nil {
				t.Fatalf("Failed to write JWK: %v", err)
			}
		}
		k, err := New(Options{Ctx: ctx, Storage: store})
		if err != nil {
			t.Fatalf("Failed to create Keyfunc: %v", err)
		}
		// Sign a token with the corresponding private key (no KID header)
		token := jwt.New(jwt.SigningMethodEdDSA)
		tokenString, err := token.SignedString(privs[i])
		if err != nil {
			t.Fatalf("Failed to sign token: %v", err)
		}
		parsedToken, err := jwt.Parse(tokenString, k.KeyfuncCtx(ctx))
		if err != nil {
			t.Fatalf("Parse failed (order %d): %v", i+1, err)
		}
		if !parsedToken.Valid {
			t.Fatalf("Expected token to be valid (order %d)", i+1)
		}
	}
}

func TestNoKIDHeaderNoMatchingJWK(t *testing.T) {
	ctx := context.Background()

	_, missingFromSet, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate ED25519 key pair: %v", err)
	}

	_, presentInSet, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("Failed to generate other ED25519 key pair: %v", err)
	}
	jwk, err := jwkset.NewJWKFromKey(presentInSet, jwkset.JWKOptions{})
	if err != nil {
		t.Fatalf("Failed to create JWK: %v", err)
	}
	store := jwkset.NewMemoryStorage()
	err = store.KeyWrite(ctx, jwk)
	if err != nil {
		t.Fatalf("Failed to write JWK: %v", err)
	}

	k, err := New(Options{Ctx: ctx, Storage: store})
	if err != nil {
		t.Fatalf("Failed to create Keyfunc: %v", err)
	}

	token := jwt.New(jwt.SigningMethodEdDSA)
	tokenString, err := token.SignedString(missingFromSet)
	if err != nil {
		t.Fatalf("Failed to sign token: %v", err)
	}

	_, err = jwt.Parse(tokenString, k.KeyfuncCtx(ctx))
	if err == nil {
		t.Fatalf("Expected error due to no matching JWK, but got none")
	}
}
