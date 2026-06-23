package cdn_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	jwt "github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/errs"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig/cdn"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	testGraphID = "871e5543-60f6-4ffc-a302-4f15277de4e7"
	testOrgID   = "5f718753-77d6-4e28-a3a3-52b24c812802"
)

// testToken is a HS256-signed JWT with testGraphID / testOrgID claims.
// NewSplitFetcher calls ParseUnverified internally, so the signing key is irrelevant.
var testToken = func() string {
	claims := jwt.MapClaims{
		"federated_graph_id": testGraphID,
		"organization_id":    testOrgID,
		"features":           []string{"split-config-loading"},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	str, err := tok.SignedString([]byte("test-secret"))
	if err != nil {
		panic("failed to create test token: " + err.Error())
	}
	return str
}()

// newFetcher creates a SplitFetcher pointed at serverURL using testToken.
func newFetcher(t *testing.T, serverURL string, opts *cdn.Options) *cdn.SplitFetcher {
	t.Helper()
	f, err := cdn.NewSplitFetcher(serverURL, testToken, opts)
	require.NoError(t, err)
	return f
}

func marshalActiveGraphs(t *testing.T, configs map[string]string) []byte {
	t.Helper()
	b, err := json.Marshal(configs)
	require.NoError(t, err)
	return b
}

func marshalRouterConfig(t *testing.T, cfg *nodev1.RouterConfig) []byte {
	t.Helper()
	b, err := protojson.Marshal(cfg)
	require.NoError(t, err)
	return b
}

func gzipData(t *testing.T, data []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	_, err := w.Write(data)
	require.NoError(t, err)
	require.NoError(t, w.Close())
	return buf.Bytes()
}

func computeHMAC(key, body []byte) string {
	h := hmac.New(sha256.New, key)
	h.Write(body)
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// ─── NewSplitFetcher ──────────────────────────────────────────────────────────

func TestNewSplitFetcher_EmptyToken(t *testing.T) {
	_, err := cdn.NewSplitFetcher("http://cdn.example.com", "", nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "token is required")
}

func TestNewSplitFetcher_InvalidToken(t *testing.T) {
	_, err := cdn.NewSplitFetcher("http://cdn.example.com", "not-a-jwt", nil)
	require.Error(t, err)
}

func TestNewSplitFetcher_InvalidURL(t *testing.T) {
	_, err := cdn.NewSplitFetcher("://invalid-url", testToken, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid CDN URL")
}

func TestNewSplitFetcher_NilOpts(t *testing.T) {
	f, err := cdn.NewSplitFetcher("http://cdn.example.com", testToken, nil)
	require.NoError(t, err)
	require.NotNil(t, f)
}

func TestNewSplitFetcher_WithSignatureKey(t *testing.T) {
	f, err := cdn.NewSplitFetcher("http://cdn.example.com", testToken, &cdn.Options{SignatureKey: "my-secret"})
	require.NoError(t, err)
	require.NotNil(t, f)
}

// ─── HTTP error status codes ──────────────────────────────────────────────────

func TestFetchMapper_HTTPErrors(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		wantErr    error  // checked with errors.Is when non-nil
		wantErrMsg string // checked with assert.Contains when non-empty
	}{
		{
			name:       "not found",
			statusCode: http.StatusNotFound,
			wantErr:    errs.ErrFileNotFound,
		},
		{
			name:       "unauthorized",
			statusCode: http.StatusUnauthorized,
			wantErrMsg: "could not authenticate against CDN",
		},
		{
			name:       "bad request",
			statusCode: http.StatusBadRequest,
			wantErrMsg: "bad request",
		},
		{
			// Real unexpected CDN codes (5xx) would be retried; 418 exercises the
			// default branch without triggering the retryable client's retry loop.
			name:       "unexpected status",
			statusCode: http.StatusTeapot,
			wantErrMsg: "unexpected status code when loading split config, statusCode: 418",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.statusCode)
			}))
			defer srv.Close()

			_, err := newFetcher(t, srv.URL, nil).FetchMapper(context.Background())
			require.Error(t, err)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
			}
			if tt.wantErrMsg != "" {
				assert.Contains(t, err.Error(), tt.wantErrMsg)
			}
		})
	}
}

// ─── Request details ──────────────────────────────────────────────────────────

func TestFetchMapper_RequestMethodAndBody(t *testing.T) {
	var gotMethod string
	var gotBody []byte
	body := marshalActiveGraphs(t, map[string]string{"": "h1"})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	_, err := newFetcher(t, srv.URL, nil).FetchMapper(context.Background())
	require.NoError(t, err)

	assert.Equal(t, http.MethodPost, gotMethod)
	assert.JSONEq(t, `{"version":""}`, string(gotBody))
}

func TestFetchMapper_RequestHeaders(t *testing.T) {
	body := marshalActiveGraphs(t, map[string]string{"": "h1"})
	var gotAuth, gotCT, gotAE string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		gotAE = r.Header.Get("Accept-Encoding")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	_, err := newFetcher(t, srv.URL, nil).FetchMapper(context.Background())
	require.NoError(t, err)

	assert.Equal(t, "Bearer "+testToken, gotAuth)
	assert.Equal(t, "application/json; charset=UTF-8", gotCT)
	assert.Equal(t, "gzip", gotAE)
}

// ─── Response body handling ───────────────────────────────────────────────────

func TestFetchMapper_EmptyBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		// intentionally write nothing
	}))
	defer srv.Close()

	_, err := newFetcher(t, srv.URL, nil).FetchMapper(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty response body")
}

func TestFetchMapper_GzipEncoded(t *testing.T) {
	// The fetcher sets Accept-Encoding: gzip explicitly, which disables Go's
	// transparent decompression, so the manual gzip path in post() is exercised.
	raw := marshalActiveGraphs(t, map[string]string{"": "hash-base", "ff1": "hash-ff1"})
	compressed := gzipData(t, raw)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Encoding", "gzip")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(compressed)
	}))
	defer srv.Close()

	result, err := newFetcher(t, srv.URL, nil).FetchMapper(context.Background())
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "hash-base", result[""])
	assert.Equal(t, "hash-ff1", result["ff1"])
}

// ─── FetchMapper: parsing & URL path ─────────────────────────────────────────

func TestFetchMapper_Success(t *testing.T) {
	configs := map[string]string{"": "hash-base", "ff1": "hash-ff1"}
	body := marshalActiveGraphs(t, configs)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	result, err := newFetcher(t, srv.URL, nil).FetchMapper(context.Background())
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "hash-base", result[""])
	assert.Equal(t, "hash-ff1", result["ff1"])
}

func TestFetchMapper_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("not-valid-proto-json"))
	}))
	defer srv.Close()

	_, err := newFetcher(t, srv.URL, nil).FetchMapper(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "could not unmarshal mapper")
}

func TestFetchMapper_URLPath(t *testing.T) {
	var gotPath string
	body := marshalActiveGraphs(t, map[string]string{"": "h1"})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	_, err := newFetcher(t, srv.URL, nil).FetchMapper(context.Background())
	require.NoError(t, err)

	assert.Equal(t, "/"+testOrgID+"/"+testGraphID+"/manifest/mapper.json", gotPath)
}

// ─── HMAC signature validation ────────────────────────────────────────────────

func TestFetchMapper_Signature(t *testing.T) {
	const sigKey = "my-secret"
	body := marshalActiveGraphs(t, map[string]string{"": "h1"})
	validSig := computeHMAC([]byte(sigKey), body)
	wrongSig := computeHMAC([]byte("wrong-key"), body)

	tests := []struct {
		name       string
		sigKey     string // empty = no HMAC configured
		respSig    string // value of X-Signature-SHA256 sent by server; empty = omit header
		wantErr    error
		wantErrMsg string
	}{
		{
			name:   "no key – signature header ignored",
			sigKey: "",
			// no header; succeeds because HMAC is disabled
		},
		{
			name:    "valid signature",
			sigKey:  sigKey,
			respSig: validSig,
		},
		{
			name:    "missing signature header",
			sigKey:  sigKey,
			wantErr: errs.ErrMissingSignatureHeader,
		},
		{
			name:       "invalid base64 in signature",
			sigKey:     sigKey,
			respSig:    "!!!not-base64!!!",
			wantErrMsg: "could not decode signature",
		},
		{
			name:    "signature mismatch",
			sigKey:  sigKey,
			respSig: wrongSig,
			wantErr: errs.ErrInvalidSignature,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if tt.respSig != "" {
					w.Header().Set("X-Signature-SHA256", tt.respSig)
				}
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(body)
			}))
			defer srv.Close()

			var opts *cdn.Options
			if tt.sigKey != "" {
				opts = &cdn.Options{SignatureKey: tt.sigKey}
			}
			_, err := newFetcher(t, srv.URL, opts).FetchMapper(context.Background())

			if tt.wantErr == nil && tt.wantErrMsg == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
			}
			if tt.wantErrMsg != "" {
				assert.Contains(t, err.Error(), tt.wantErrMsg)
			}
		})
	}
}

// ─── FetchConfig ──────────────────────────────────────────────────────────────

func TestFetchConfig_URLPaths(t *testing.T) {
	tests := []struct {
		name            string
		featureFlagName string
		wantPath        string
	}{
		{
			name:            "base graph uses latest.json",
			featureFlagName: "",
			wantPath:        "/" + testOrgID + "/" + testGraphID + "/manifest/latest.json",
		},
		{
			name:            "feature flag uses feature-flags sub-path",
			featureFlagName: "my-flag",
			wantPath:        "/" + testOrgID + "/" + testGraphID + "/manifest/feature-flags/my-flag.json",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotPath string
			body := marshalRouterConfig(t, &nodev1.RouterConfig{
				Version:              "v1",
				EngineConfig:         &nodev1.EngineConfiguration{DefaultFlushInterval: 500},
				CompatibilityVersion: "1",
			})

			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(body)
			}))
			defer srv.Close()

			_, err := newFetcher(t, srv.URL, nil).FetchConfig(context.Background(), tt.featureFlagName)
			require.NoError(t, err)
			assert.Equal(t, tt.wantPath, gotPath)
		})
	}
}

func TestFetchConfig_Success(t *testing.T) {
	expected := &nodev1.RouterConfig{
		Version:              "v42",
		EngineConfig:         &nodev1.EngineConfiguration{DefaultFlushInterval: 500},
		CompatibilityVersion: "1",
	}
	body := marshalRouterConfig(t, expected)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	result, err := newFetcher(t, srv.URL, nil).FetchConfig(context.Background(), "")
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "v42", result.Version)
}

func TestFetchConfig_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("not-valid-proto-json"))
	}))
	defer srv.Close()

	_, err := newFetcher(t, srv.URL, nil).FetchConfig(context.Background(), "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "could not unmarshal router config")
}
