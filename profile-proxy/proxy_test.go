package main

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
)

func signToken(t *testing.T, secret string, claims jwt.MapClaims) string {
	t.Helper()
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	require.NoError(t, err)
	return s
}

func graphClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"iss":                "6acdcf9a-90a8-4f96-8984-7da50cbc3380",
		"aud":                AudienceGraphKey,
		"federated_graph_id": "78923534-3de5-4261-a85e-036aec9f1387",
		"organization_id":    "d79f8437-209b-4743-9042-d7107a0b747c",
		"iat":                time.Now().Unix(),
	}
}

func TestIngest(t *testing.T) {
	const secret = "test-secret"

	type captured struct {
		name   string
		auth   string
		tenant string
		body   string
		gotReq bool
	}
	var got captured
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(body)
		got = captured{
			name:   r.URL.Query().Get("name"),
			auth:   r.Header.Get("Authorization"),
			tenant: r.Header.Get("X-Scope-OrgID"),
			body:   string(body),
			gotReq: true,
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	upstreamURL, err := url.Parse(upstream.URL)
	require.NoError(t, err)
	cfg := Config{
		UpstreamURL:      *upstreamURL,
		UpstreamUser:     "up-user",
		UpstreamPassword: "up-pass",
		JWTSecret:        secret,
		TenantFromOrgID:  true,
	}
	e := newServer(cfg, slog.New(slog.DiscardHandler))

	t.Run("attaches organization and graph labels and swaps auth for a valid token", func(t *testing.T) {
		got = captured{}
		req := httptest.NewRequest(http.MethodPost, "/ingest?name=router{env=prod}", strings.NewReader("profile-bytes"))
		req.Header.Set("Authorization", "Bearer "+signToken(t, secret, graphClaims()))
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(t, captured{
			name:   "router{env=prod,federated_graph_id=78923534-3de5-4261-a85e-036aec9f1387,organization_id=d79f8437-209b-4743-9042-d7107a0b747c}",
			auth:   "Basic " + basicAuth("up-user", "up-pass"),
			tenant: "d79f8437-209b-4743-9042-d7107a0b747c",
			body:   "profile-bytes",
			gotReq: true,
		}, got)
	})

	t.Run("overrides client-supplied values for claim labels", func(t *testing.T) {
		got = captured{}
		req := httptest.NewRequest(http.MethodPost, "/ingest?name=router{organization_id=spoofed,federated_graph_id=spoofed}", nil)
		req.Header.Set("Authorization", "Bearer "+signToken(t, secret, graphClaims()))
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(t, "router{federated_graph_id=78923534-3de5-4261-a85e-036aec9f1387,organization_id=d79f8437-209b-4743-9042-d7107a0b747c}", got.name)
	})

	t.Run("is rejected with 401 when the token is missing", func(t *testing.T) {
		got = captured{}
		req := httptest.NewRequest(http.MethodPost, "/ingest?name=router", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		require.Equal(t, http.StatusUnauthorized, rec.Code)
		require.False(t, got.gotReq)
	})

	t.Run("is rejected with 401 when the audience is not the graph key audience", func(t *testing.T) {
		got = captured{}
		claims := graphClaims()
		claims["aud"] = "cosmo:cdn-admission"
		req := httptest.NewRequest(http.MethodPost, "/ingest?name=router", nil)
		req.Header.Set("Authorization", "Bearer "+signToken(t, secret, claims))
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		require.Equal(t, http.StatusUnauthorized, rec.Code)
		require.False(t, got.gotReq)
	})

	t.Run("is rejected with 401 when the token is signed with a different secret", func(t *testing.T) {
		got = captured{}
		req := httptest.NewRequest(http.MethodPost, "/ingest?name=router", nil)
		req.Header.Set("Authorization", "Bearer "+signToken(t, "wrong-secret", graphClaims()))
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		require.Equal(t, http.StatusUnauthorized, rec.Code)
		require.False(t, got.gotReq)
	})

	t.Run("is rejected with 401 when organization_id is missing", func(t *testing.T) {
		got = captured{}
		claims := graphClaims()
		delete(claims, "organization_id")
		req := httptest.NewRequest(http.MethodPost, "/ingest?name=router", nil)
		req.Header.Set("Authorization", "Bearer "+signToken(t, secret, claims))
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		require.Equal(t, http.StatusUnauthorized, rec.Code)
		require.False(t, got.gotReq)
	})
}

func basicAuth(user, pass string) string {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.SetBasicAuth(user, pass)
	return strings.TrimPrefix(req.Header.Get("Authorization"), "Basic ")
}
