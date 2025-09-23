package integration

import (
	"bytes"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const (
	employeesQuery                = `{"query":"{ employees { id } }"}`
	employeesQueryRequiringClaims = `{"query":"{ employees { id startDate } }"}`
	employeesExpectedData         = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`
	unauthorizedExpectedData      = `{"errors":[{"message":"unauthorized"}]}`
	xAuthenticatedByHeader        = "X-Authenticated-By"
)

func TestAuthentication(t *testing.T) {
	t.Parallel()

	t.Run("no token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := ConfigureAuth(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations without token should succeed
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})

	t.Run("unknown kid refresh blocks when burst exceeded", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: 10 * time.Second,
				RefreshUnknownKID: authentication.RefreshUnknownKIDConfig{
					Enabled:  true,
					Interval: 1 * time.Second,
					Burst:    1,
				},
			},
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.TokenForKID("unknown_kid", nil, true)
			require.NoError(t, err)

			header := http.Header{"Authorization": []string{"Bearer " + token}}

			res1, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer func() { _ = res1.Body.Close() }()
			require.Equal(t, http.StatusUnauthorized, res1.StatusCode)
			_, err = io.ReadAll(res1.Body)
			require.NoError(t, err)

			start := time.Now()
			res2, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer func() { _ = res2.Body.Close() }()
			elapsed := time.Since(start)

			require.True(t, elapsed >= 700*time.Millisecond)
			require.Equal(t, http.StatusUnauthorized, res2.StatusCode)
			data, err := io.ReadAll(res2.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})

	t.Run("unknown kid refresh does not block when burst not exceeded", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: 10 * time.Second,
				RefreshUnknownKID: authentication.RefreshUnknownKIDConfig{
					Enabled:  true,
					Interval: 1 * time.Second,
					Burst:    1,
				},
			},
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.TokenForKID("unknown_kid", nil, true)
			require.NoError(t, err)
			header := http.Header{"Authorization": []string{"Bearer " + token}}

			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer func() { _ = res.Body.Close() }()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			_, err = io.ReadAll(res.Body)
			require.NoError(t, err)

			// Wait for interval so next refresh is within burst budget
			time.Sleep(1200 * time.Millisecond)

			start := time.Now()
			res2, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer func() { _ = res2.Body.Close() }()
			elapsed := time.Since(start)
			require.True(t, elapsed < 100*time.Millisecond)
			require.Equal(t, http.StatusUnauthorized, res2.StatusCode)
			data, err := io.ReadAll(res2.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})

	// Since the rate limiter knows that the limit will definitely be exceeded it exits
	// immediately without waiting
	t.Run("unknown kid refresh interval exceeding max wait returns immediately", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: 10 * time.Second,
				RefreshUnknownKID: authentication.RefreshUnknownKIDConfig{
					Enabled:  true,
					Interval: 1 * time.Second, // next token available in ~1s
					Burst:    1,
					MaxWait:  700 * time.Millisecond, // cap wait well below interval
				},
			},
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.TokenForKID("unknown_kid", nil, true)
			require.NoError(t, err)

			header := http.Header{"Authorization": []string{"Bearer " + token}}

			res1, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer func() { _ = res1.Body.Close() }()
			require.Equal(t, http.StatusUnauthorized, res1.StatusCode)
			_, err = io.ReadAll(res1.Body)
			require.NoError(t, err)

			// Next call should exceed max wait so should return immediately
			start := time.Now()
			res2, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer func() { _ = res2.Body.Close() }()
			elapsed := time.Since(start)
			require.True(t, elapsed < 100*time.Millisecond)
			require.Equal(t, http.StatusUnauthorized, res2.StatusCode)
			data, err := io.ReadAll(res2.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})

	t.Run("unknown kid refresh exceeding burst waits until interval when max wait larger", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: 10 * time.Second,
				RefreshUnknownKID: authentication.RefreshUnknownKIDConfig{
					Enabled:  true,
					Interval: 1 * time.Second,
					Burst:    1,
					MaxWait:  2 * time.Second, // larger than interval, so it can wait until next token
				},
			},
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.TokenForKID("unknown_kid", nil, true)
			require.NoError(t, err)

			header := http.Header{"Authorization": []string{"Bearer " + token}}

			res1, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer func() { _ = res1.Body.Close() }()
			require.Equal(t, http.StatusUnauthorized, res1.StatusCode)
			_, err = io.ReadAll(res1.Body)
			require.NoError(t, err)

			start := time.Now()
			res2, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer func() { _ = res2.Body.Close() }()
			elapsed := time.Since(start)

			require.True(t, elapsed >= 600*time.Millisecond)
			require.Equal(t, http.StatusUnauthorized, res2.StatusCode)
			data, err := io.ReadAll(res2.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})

	// After consuming the single burst token, launch multiple requests in parallel.
	// Each should block if the max limit has not been accumulated
	t.Run("unknown kid refresh parallel exceeding burst waits up to max wait", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		const waitEntries = 4

		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: 10 * time.Second,
				RefreshUnknownKID: authentication.RefreshUnknownKIDConfig{
					Enabled:  true,
					Interval: 1 * time.Second,
					Burst:    1,
					MaxWait:  waitEntries * time.Second,
				},
			},
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.TokenForKID("unknown_kid", nil, true)
			require.NoError(t, err)

			header := http.Header{"Authorization": []string{"Bearer " + token}}

			// Send initial request to use up the burst token
			res1, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer func() { _ = res1.Body.Close() }()
			require.Equal(t, http.StatusUnauthorized, res1.StatusCode)
			_, err = io.ReadAll(res1.Body)
			require.NoError(t, err)

			var elapsedFastCounter atomic.Int64
			var wg sync.WaitGroup

			for range waitEntries + 1 {
				wg.Add(1)

				go func() {
					defer wg.Done()

					start := time.Now()
					res2, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer func() { _ = res2.Body.Close() }()

					elapsed := time.Since(start)

					if elapsed < 100*time.Millisecond {
						elapsedFastCounter.Add(1)
					}

					require.True(t, elapsed < 50*time.Millisecond || elapsed >= 700*time.Millisecond)
					require.Equal(t, http.StatusUnauthorized, res2.StatusCode)
					data, err := io.ReadAll(res2.Body)
					require.NoError(t, err)
					require.JSONEq(t, unauthorizedExpectedData, string(data))
				}()
			}

			wg.Wait()

			// We only exit early on the 5th request as by the 5th request we have accumulated
			// enough tokens to exceed the max wait duration
			require.Equal(t, 1, int(elapsedFastCounter.Load()))
		})
	})

	t.Run("authentication should not block with unknown kid when refresh is disabled", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: 100 * time.Millisecond,
			},
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Create a token signed with a valid key but with an unknown kid header
			token, err := authServer.TokenForKID("unknown_kid", nil, true)
			require.NoError(t, err)

			maxDuration := 4 * time.Second
			testenv.AwaitFunc(t, maxDuration, func() {
				for range 5 {
					func() {
						header := http.Header{
							"Authorization": []string{"Bearer " + token},
						}
						res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
						require.NoError(t, err)
						defer func() { _ = res.Body.Close() }()
						require.Equal(t, http.StatusUnauthorized, res.StatusCode)
						require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
						data, err := io.ReadAll(res.Body)
						require.NoError(t, err)
						require.JSONEq(t, unauthorizedExpectedData, string(data))
					}()
				}
			})
		})
	})

	t.Run("invalid token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with an invalid token should fail
			header := http.Header{
				"Authorization": []string{"Bearer invalid"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, unauthorizedExpectedData, string(data))
		})
	})

	t.Run("valid token", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})

	t.Run("scopes required no token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",0,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",1,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",2,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",3,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",4,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",5,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",6,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",7,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",8,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: not authenticated.","path":["employees",9,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"employees":[null,null,null,null,null,null,null,null,null,null]}}`, string(data))
		})
	})
	t.Run("scopes required valid token no scopes", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",0,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",1,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",2,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",3,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",4,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",5,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",6,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",7,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",8,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",9,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"employees":[null,null,null,null,null,null,null,null,null,null]},"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Employee","fieldName":"startDate"},"required":[["read:employee","read:private"],["read:all"]]}],"actualScopes":[]}}}`, string(data))
		})
	})
	t.Run("scopes required valid token AND scopes present", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee read:private",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1,"startDate":"January 2020"},{"id":2,"startDate":"July 2022"},{"id":3,"startDate":"June 2021"},{"id":4,"startDate":"July 2022"},{"id":5,"startDate":"July 2022"},{"id":7,"startDate":"September 2022"},{"id":8,"startDate":"September 2022"},{"id":10,"startDate":"November 2022"},{"id":11,"startDate":"November 2022"},{"id":12,"startDate":"December 2022"}]}}`, string(data))
		})
	})
	t.Run("scopes required valid token AND scopes present with alias", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`{"query":"{ alias: secret { value } }"}`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.alias', Reason: missing required scopes.","path":["alias"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"alias":null},"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Query","fieldName":"secret"},"required":[["read:secret"]]}],"actualScopes":["read:employee"]}}}`, string(data))
		})
	})
	t.Run("scopes required valid token AND scopes partially present", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with an token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",0,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",1,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",2,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",3,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",4,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",5,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",6,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",7,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",8,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Query.employees.startDate', Reason: missing required scopes.","path":["employees",9,"startDate"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"employees":[null,null,null,null,null,null,null,null,null,null]},"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Employee","fieldName":"startDate"},"required":[["read:employee","read:private"],["read:all"]]}],"actualScopes":["read:employee"]}}}`, string(data))
		})
	})
	t.Run("reject unauthorized missing scope", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			data = bytes.TrimSpace(data)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Employee","fieldName":"startDate"},"required":[["read:employee","read:private"],["read:all"]]}],"actualScopes":["read:employee"]}}}`, string(data))
		})
	})
	t.Run("reject unauthorized no scope", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			data = bytes.TrimSpace(data)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Employee","fieldName":"startDate"},"required":[["read:employee","read:private"],["read:all"]]}],"actualScopes":[]}}}`, string(data))
		})
	})
	t.Run("reject unauthorized invalid token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			header := http.Header{
				"Authorization": []string{"Bearer token"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"unauthorized"}]}`, string(data))
		})
	})
	t.Run("reject unauthorized no token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			data = bytes.TrimSpace(data)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":null}`, string(data))
		})
	})
	t.Run("scopes required valid token OR scopes present", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:all",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1,"startDate":"January 2020"},{"id":2,"startDate":"July 2022"},{"id":3,"startDate":"June 2021"},{"id":4,"startDate":"July 2022"},{"id":5,"startDate":"July 2022"},{"id":7,"startDate":"September 2022"},{"id":8,"startDate":"September 2022"},{"id":10,"startDate":"November 2022"},{"id":11,"startDate":"November 2022"},{"id":12,"startDate":"December 2022"}]}}`, string(data))
		})
	})
	t.Run("scopes required valid token AND and OR scopes present", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:employee read:private read:all",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQueryRequiringClaims))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"employees":[{"id":1,"startDate":"January 2020"},{"id":2,"startDate":"July 2022"},{"id":3,"startDate":"June 2021"},{"id":4,"startDate":"July 2022"},{"id":5,"startDate":"July 2022"},{"id":7,"startDate":"September 2022"},{"id":8,"startDate":"September 2022"},{"id":10,"startDate":"November 2022"},{"id":11,"startDate":"November 2022"},{"id":12,"startDate":"December 2022"}]}}`, string(data))
		})
	})
	t.Run("non-nullable, unauthorized data returns no data even if some is authorized", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			token, err := authServer.Token(map[string]any{
				"scope": "read:fact read:miscellaneous",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"{ topSecretFederationFacts { ... on EntityFact { description } ... on MiscellaneousFact { title description } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.topSecretFederationFacts.description', Reason: missing required scopes.","path":["topSecretFederationFacts",2,"description"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"EntityFact","fieldName":"description"},"required":[["read:scalar"],["read:all"]]}],"actualScopes":["read:fact","read:miscellaneous"]}}}`, string(data))
		})
	})
	t.Run("return unauthenticated error if a field requiring authentication is queried", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(`
				{"query":"{ factTypes }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.factTypes', Reason: not authenticated.","path":["factTypes"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"factTypes":null}}`, string(data))
		})
	})
	t.Run("nullable, unauthenticated data returns an error but partial data that does not require authentication is returned", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(`
				{"query":"{ factTypes productTypes { ... on Cosmo { upc } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.factTypes', Reason: not authenticated.","path":["factTypes"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"factTypes":null,"productTypes":[{"upc":"cosmo"},{},{}]}}`, string(data))
		})
	})
	t.Run("nullable, unauthenticated data returns an error but partial data that does not require authentication is returned (reordered fields)", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(`
				{"query":"{ productTypes { ... on Cosmo { upc } } factTypes }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Query.factTypes', Reason: not authenticated.","path":["factTypes"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":{"productTypes":[{"upc":"cosmo"},{},{}],"factTypes":null}}`, string(data))
		})
	})
	t.Run("data requiring authentication is returned when authenticated", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"{ factTypes productTypes { ... on Cosmo { upc } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"factTypes":["DIRECTIVE","ENTITY","MISCELLANEOUS"],"productTypes":[{"upc":"cosmo"},{},{}]}}`, string(data))
		})
	})
	t.Run("mutation with valid scopes", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "write:fact read:miscellaneous read:all",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"addFact":{"title":"title","description":"description"}}}`, string(data))
		})
	})
	t.Run("mutation with scope missing for response field", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "write:fact read:miscellaneous",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized to load field 'Mutation.addFact.description', Reason: missing required scopes.","path":["addFact","description"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"MiscellaneousFact","fieldName":"description"},"required":[["read:scalar","read:miscellaneous"],["read:all","read:miscellaneous"]]}],"actualScopes":["write:fact","read:miscellaneous"]}}}`, string(data))
		})
	})
	t.Run("mutation with scope missing for mutation root field", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "read:miscellaneous read:all",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized request to Subgraph 'products', Reason: missing required scopes.","extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}},{"message":"Unauthorized to load field 'Mutation.addFact', Reason: missing required scopes.","path":["addFact"],"extensions":{"code":"UNAUTHORIZED_FIELD_OR_TYPE"}}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Mutation","fieldName":"addFact"},"required":[["write:fact"],["write:all"]]}],"actualScopes":["read:miscellaneous","read:all"]}}}`, string(data))
		})
	})
	t.Run("mutation with scope missing for mutation root field (with reject)", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithAuthorizationConfig(&config.AuthorizationConfiguration{
					RejectOperationIfUnauthorized: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"scope": "read:miscellaneous read:all",
			})
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(`
				{"query":"mutation { addFact(fact: { title: \"title\", description: \"description\", factType: MISCELLANEOUS }) { ... on MiscellaneousFact { title description } } }"}
			`))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			data = bytes.TrimSpace(data)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Unauthorized"}],"data":null,"extensions":{"authorization":{"missingScopes":[{"coordinate":{"typeName":"Mutation","fieldName":"addFact"},"required":[["write:fact"],["write:all"]]}],"actualScopes":["read:miscellaneous","read:all"]}}}`, string(data))
		})
	})
}

func TestAuthenticationWithCustomHeaders(t *testing.T) {
	t.Parallel()

	const (
		headerName        = "X-My-Header"
		headerValuePrefix = "Token"
	)

	authServer, err := jwks.NewServer(t)
	require.NoError(t, err)
	t.Cleanup(authServer.Close)

	tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
	authOptions := authentication.HttpHeaderAuthenticatorOptions{
		Name: JwksName,
		HeaderSourcePrefixes: map[string][]string{
			headerName: {headerValuePrefix},
		},
		TokenDecoder: tokenDecoder,
	}
	authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator}

	token, err := authServer.Token(nil)
	require.NoError(t, err)

	runTest := func(t *testing.T, headerValue string) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			header := http.Header{
				headerName: []string{headerValue},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	}

	t.Run("with space", func(t *testing.T) {
		t.Parallel()

		runTest(t, headerValuePrefix+" "+token)
	})

	t.Run("without space", func(t *testing.T) {
		t.Parallel()

		runTest(t, headerValuePrefix+token)
	})
}

func TestHttpJwksAuthorization(t *testing.T) {
	t.Parallel()

	t.Run("startup should fail when duplicate URLs are specified", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		_, err = authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: 2 * time.Second,
			},
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: 2 * time.Second,
			},
		})

		require.ErrorContains(t, err, "duplicate JWK URL found")
	})

	t.Run("authentication should fail with no token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations without token should fail
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})

	t.Run("authentication should fail with an invalid token", func(t *testing.T) {
		t.Parallel()

		authenticators, _ := ConfigureAuth(t)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with an invalid token should fail
			header := http.Header{
				"Authorization": []string{"Bearer invalid"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})

	t.Run("authentication should succeed with a valid token", func(t *testing.T) {
		t.Parallel()

		authenticators, authServer := ConfigureAuth(t)
		token, err := authServer.Token(nil)
		require.NoError(t, err)
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})

	t.Run("authentication should succeed with valid token when multiple JWK configurations are specified", func(t *testing.T) {
		t.Parallel()

		authServer1, err := jwks.NewServer(t)
		t.Cleanup(authServer1.Close)
		require.NoError(t, err)

		authServer2, err := jwks.NewServer(t)
		t.Cleanup(authServer2.Close)
		require.NoError(t, err)

		// aud claim
		token, err := authServer2.Token(map[string]any{
			"aud": "https://example.com",
		})
		require.NoError(t, err)

		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				Secret:    "example secret",
				Algorithm: string(jwkset.AlgHS256),
				KeyId:     "givenKID",
			},
			{
				URL:             authServer1.JWKSURL(),
				RefreshInterval: time.Second * 5,
			},
			{
				URL:             authServer2.JWKSURL(),
				RefreshInterval: time.Second * 5,
			},
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})

}

func TestNonHttpAuthorization(t *testing.T) {
	t.Run("startup should fail when duplicate key ids are manually specified", func(t *testing.T) {
		t.Parallel()

		secret := "example secret"
		kid := "givenKID"

		_, err := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{
			{
				Secret:    secret,
				Algorithm: string(jwkset.AlgHS256),
				KeyId:     kid,
			},
			{
				Secret:    secret,
				Algorithm: string(jwkset.AlgHS256),
				KeyId:     kid,
			},
		})

		require.ErrorContains(t, err, "duplicate JWK keyid specified found")
	})

	t.Run("authentication should succeed with a valid HS256 token", func(t *testing.T) {
		t.Parallel()

		secret := "example secret"
		kid := "givenKID"
		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				Secret:    secret,
				Algorithm: string(jwkset.AlgHS256),
				KeyId:     kid,
			},
		})

		token := generateToken(t, kid, secret, jwt.SigningMethodHS256, nil)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})

	t.Run("authentication should succeed with valid token when multiple JWK configurations are specified", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		t.Cleanup(authServer.Close)
		require.NoError(t, err)

		secret := "example secret"
		kid := "givenKID"
		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: time.Second * 5,
			},
			{
				Secret:    secret,
				Algorithm: string(jwkset.AlgHS256),
				KeyId:     kid,
			},
		})

		token := generateToken(t, kid, secret, jwt.SigningMethodHS256, nil)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})

	t.Run("authentication should fail when the secret is correct but they key id does not match", func(t *testing.T) {
		t.Parallel()

		secret := "example secret"
		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				Secret:    secret,
				Algorithm: string(jwkset.AlgHS256),
				KeyId:     "givenKID1",
			},
			{
				Secret:    secret,
				Algorithm: string(jwkset.AlgHS256),
				KeyId:     "givenKID2",
			},
		})

		token := generateToken(t, "differentKID", secret, jwt.SigningMethodHS256, nil)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})
}

func TestAuthenticationValuePrefixes(t *testing.T) {
	t.Parallel()

	authServer, err := jwks.NewServer(t)
	require.NoError(t, err)
	t.Cleanup(authServer.Close)

	tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
	authenticatorHeaderValuePrefixes := []string{"Bearer", "Custom1", "Custom2"}
	authenticator1, err := authentication.NewHttpHeaderAuthenticator(authentication.HttpHeaderAuthenticatorOptions{
		Name: JwksName,
		HeaderSourcePrefixes: map[string][]string{
			"Authorization": authenticatorHeaderValuePrefixes,
		},
		TokenDecoder: tokenDecoder,
	})
	require.NoError(t, err)

	authenticators := []authentication.Authenticator{authenticator1}
	accessController := core.NewAccessController(authenticators, false)

	t.Run("no prefix", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(nil)
			require.NoError(t, err)
			header := http.Header{
				"Authorization": []string{token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})
	t.Run("matching prefix", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, prefix := range authenticatorHeaderValuePrefixes {
				prefix := prefix
				t.Run("prefix "+prefix, func(t *testing.T) {
					token, err := authServer.Token(nil)
					require.NoError(t, err)
					header := http.Header{
						"Authorization": []string{prefix + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.Equal(t, employeesExpectedData, string(data))
				})
			}
		})
	})

}

func TestAuthenticationMultipleProviders(t *testing.T) {
	t.Parallel()

	authServer1, err := jwks.NewServer(t)
	require.NoError(t, err)
	t.Cleanup(authServer1.Close)

	authServer2, err := jwks.NewServer(t)
	require.NoError(t, err)
	t.Cleanup(authServer2.Close)

	tokenDecoder1, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer1.JWKSURL(), time.Second*5)})
	authenticator1HeaderValuePrefixes := []string{"Provider1"}
	authenticator1, err := authentication.NewHttpHeaderAuthenticator(authentication.HttpHeaderAuthenticatorOptions{
		Name: "1",
		HeaderSourcePrefixes: map[string][]string{
			"Authorization": authenticator1HeaderValuePrefixes,
		},
		TokenDecoder: tokenDecoder1,
	})
	require.NoError(t, err)

	tokenDecoder2, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer2.JWKSURL(), time.Second*5)})
	authenticator2HeaderValuePrefixes := []string{"", "Provider2"}
	authenticator2, err := authentication.NewHttpHeaderAuthenticator(authentication.HttpHeaderAuthenticatorOptions{
		Name: "2",
		HeaderSourcePrefixes: map[string][]string{
			"Authorization": authenticator2HeaderValuePrefixes,
		},
		TokenDecoder: tokenDecoder2,
	})
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator1, authenticator2}
	accessController := core.NewAccessController(authenticators, false)

	t.Run("authenticate with first provider due to matching prefix", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, prefix := range authenticator1HeaderValuePrefixes {
				prefix := prefix
				t.Run("prefix "+prefix, func(t *testing.T) {
					token, err := authServer1.Token(nil)
					require.NoError(t, err)
					header := http.Header{
						"Authorization": []string{prefix + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.Equal(t, "1", res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.Equal(t, employeesExpectedData, string(data))
				})
			}
		})
	})

	t.Run("authenticate with second provider due to matching prefix", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, prefix := range authenticator2HeaderValuePrefixes {
				prefix := prefix
				t.Run("prefix "+prefix, func(t *testing.T) {
					token, err := authServer2.Token(nil)
					require.NoError(t, err)
					header := http.Header{
						"Authorization": []string{prefix + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.Equal(t, "2", res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.Equal(t, employeesExpectedData, string(data))
				})
			}
		})
	})

	t.Run("invalid token", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := http.Header{
				"Authorization": []string{"Bearer invalid"},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})
	})

}

func TestAlgorithmMismatch(t *testing.T) {
	t.Parallel()

	testSetup := func(t *testing.T, crypto jwks.Crypto) (string, []authentication.Authenticator) {
		t.Helper()

		authServer, err := jwks.NewServerWithCrypto(t, crypto)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		tokenDecoder, err := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		require.NoError(t, err)

		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         JwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
		require.NoError(t, err)

		authenticators := []authentication.Authenticator{authenticator}

		token, err := authServer.TokenForKID(crypto.KID(), nil, false)
		require.NoError(t, err)

		return token, authenticators
	}

	t.Run("should prevent access with invalid algorithm", func(t *testing.T) {
		// create a crypto for RSA
		rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
		require.NoError(t, err)

		// We are not using the provided token here as we want to test the algorithm mismatch
		_, authenticators := testSetup(t, rsaCrypto)

		// sign a token with an HMAC algorithm using the RSA key in PEM format
		// Unlike RSA, HMAC is a symmetric algorithm and the key is the same for signing and verifying
		// Therefore we can try to use the public key as the HMAC key to sign a token.
		signer := jwt.New(jwt.SigningMethodHS256)

		signer.Header[jwkset.HeaderKID] = rsaCrypto.KID()

		publicKey := rsaCrypto.PrivateKey().(*rsa.PrivateKey).PublicKey
		publicKeyPEM := &pem.Block{
			Type:  "RSA PUBLIC KEY",
			Bytes: x509.MarshalPKCS1PublicKey(&publicKey),
		}

		token, err := signer.SignedString(pem.EncodeToMemory(publicKeyPEM))
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operation with forged token should fail
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}

			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
		})
	})

	t.Run("Should not allow none algorithm", func(t *testing.T) {
		t.Parallel()

		rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
		require.NoError(t, err)

		// We will create a token with none algorithm
		_, authenticators := testSetup(t, rsaCrypto)

		token, err := jwt.New(jwt.SigningMethodNone).SignedString(jwt.UnsafeAllowNoneSignatureType)
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}

			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
		})
	})
}

func TestOidcDiscovery(t *testing.T) {
	t.Parallel()

	testAuthentication := func(t *testing.T, xEnv *testenv.Environment, token string) {
		t.Helper()

		// Operations with a token should succeed
		header := http.Header{
			"Authorization": []string{"Bearer " + token},
		}
		res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
		require.NoError(t, err)
		defer res.Body.Close()
		require.Equal(t, http.StatusOK, res.StatusCode)
		require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
		data, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		require.Equal(t, employeesExpectedData, string(data))

		// Operation without a token should fail
		res, err = xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQuery))
		require.NoError(t, err)
		require.Equal(t, http.StatusUnauthorized, res.StatusCode)
	}

	testSetup := func(t *testing.T, crypto ...jwks.Crypto) (map[string]string, []authentication.Authenticator) {
		t.Helper()

		authServer, err := jwks.NewServerWithCrypto(t, crypto...)
		require.NoError(t, err)

		t.Cleanup(authServer.Close)

		tokenDecoder, err := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(),
			[]authentication.JWKSConfig{
				toJWKSConfig(authServer.OIDCURL(), time.Second*5)})
		require.NoError(t, err)

		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         JwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
		require.NoError(t, err)

		authenticators := []authentication.Authenticator{authenticator}

		tokens := make(map[string]string)

		for _, c := range crypto {
			token, err := authServer.TokenForKID(c.KID(), nil, false)
			require.NoError(t, err)

			tokens[c.KID()] = token
		}

		return tokens, authenticators
	}

	t.Run("Should fail to create token decoder when server is not running", func(t *testing.T) {
		t.Parallel()

		rsa, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
		require.NoError(t, err)

		authServer, err := jwks.NewServerWithCrypto(t, rsa)
		require.NoError(t, err)

		authServer.Close()

		tokenDecoder, err := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(),
			[]authentication.JWKSConfig{
				toJWKSConfig(authServer.OIDCURL(), time.Second*5)})
		require.Error(t, err)
		require.Nil(t, tokenDecoder)
	})

	t.Run("Should fail to create token decoder when server is slow", func(t *testing.T) {
		t.Parallel()

		rsa, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
		require.NoError(t, err)

		authServer, err := jwks.NewServerWithCrypto(t, rsa)
		require.NoError(t, err)

		// Simulate long-running operation
		authServer.SetRespondTime(time.Minute)

		tokenDecoder, err := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(),
			[]authentication.JWKSConfig{
				toJWKSConfig(authServer.OIDCURL(), time.Second*5)})
		require.Error(t, err)
		require.Nil(t, tokenDecoder)
	})

	t.Run("Should discover JWKs from OIDC discovery endpoint", func(t *testing.T) {
		t.Parallel()

		rsa, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
		require.NoError(t, err)

		tokens, authenticators := testSetup(t, rsa)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			for _, token := range tokens {
				testAuthentication(t, xEnv, token)
			}
		})
	})
}

func TestMultipleKeys(t *testing.T) {
	t.Parallel()

	testAuthentication := func(t *testing.T, xEnv *testenv.Environment, token string) {
		t.Helper()

		// Operations with a token should succeed
		header := http.Header{
			"Authorization": []string{"Bearer " + token},
		}
		res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
		require.NoError(t, err)
		defer res.Body.Close()
		require.Equal(t, http.StatusOK, res.StatusCode)
		require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
		data, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		require.Equal(t, employeesExpectedData, string(data))

		// Operation without a token should fail
		res, err = xEnv.MakeRequest(http.MethodPost, "/graphql", nil, strings.NewReader(employeesQuery))
		require.NoError(t, err)
		require.Equal(t, http.StatusUnauthorized, res.StatusCode)
	}

	testSetup := func(t *testing.T, crypto ...jwks.Crypto) (map[string]string, []authentication.Authenticator) {
		t.Helper()

		authServer, err := jwks.NewServerWithCrypto(t, crypto...)
		require.NoError(t, err)

		t.Cleanup(authServer.Close)

		tokenDecoder, err := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
		require.NoError(t, err)

		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         JwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
		require.NoError(t, err)

		authenticators := []authentication.Authenticator{authenticator}

		tokens := make(map[string]string)

		for _, c := range crypto {
			token, err := authServer.TokenForKID(c.KID(), nil, false)
			require.NoError(t, err)

			tokens[c.KID()] = token
		}

		return tokens, authenticators
	}

	t.Run("Test with multiple asymmetric keys", func(t *testing.T) {
		t.Parallel()

		t.Run("Should succeed with multiple RSA keys", func(t *testing.T) {
			t.Parallel()

			rsa1, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
			require.NoError(t, err)

			rsa2, err := jwks.NewRSACrypto("", jwkset.AlgRS512, 2048)
			require.NoError(t, err)

			tokens, authenticators := testSetup(t, rsa1, rsa2)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for _, token := range tokens {
					testAuthentication(t, xEnv, token)
				}
			})
		})

		t.Run("Should succeed with multiple ECDSA keys", func(t *testing.T) {
			t.Parallel()

			ec1, err := jwks.NewES256Crypto("")
			require.NoError(t, err)

			ec2, err := jwks.NewES384Crypto("")
			require.NoError(t, err)

			tokens, authenticators := testSetup(t, ec1, ec2)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for _, token := range tokens {
					testAuthentication(t, xEnv, token)
				}
			})
		})

		t.Run("Should succeed with RSA and ECDSA keys", func(t *testing.T) {
			t.Parallel()

			rsa, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
			require.NoError(t, err)

			ec, err := jwks.NewES256Crypto("")
			require.NoError(t, err)

			tokens, authenticators := testSetup(t, rsa, ec)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for _, token := range tokens {
					testAuthentication(t, xEnv, token)
				}
			})
		})
	})

	t.Run("Test with multiple symmetric keys", func(t *testing.T) {
		t.Parallel()

		t.Run("Should succeed with multiple HS256 keys", func(t *testing.T) {
			t.Parallel()

			hs1, err := jwks.NewHMACCrypto("", jwkset.AlgHS256)
			require.NoError(t, err)

			hs2, err := jwks.NewHMACCrypto("", jwkset.AlgHS256)
			require.NoError(t, err)

			tokens, authenticators := testSetup(t, hs1, hs2)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for _, token := range tokens {
					testAuthentication(t, xEnv, token)
				}
			})
		})
	})

	t.Run("Test with symmetric and asymmetric keys", func(t *testing.T) {
		t.Parallel()

		t.Run("Should succeed with RSA and HS256 keys", func(t *testing.T) {
			t.Parallel()

			rsa, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
			require.NoError(t, err)

			hs, err := jwks.NewHMACCrypto("", jwkset.AlgHS256)
			require.NoError(t, err)

			tokens, authenticators := testSetup(t, rsa, hs)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				for _, token := range tokens {
					testAuthentication(t, xEnv, token)
				}
			})
		})
	})
}

func TestSupportedAlgorithms(t *testing.T) {
	t.Parallel()

	authHeader := func(token string) http.Header {
		return http.Header{
			"Authorization": []string{"Bearer " + token},
		}
	}

	testRequest := func(t *testing.T, xEnv *testenv.Environment, header http.Header, expectSuccess bool) string {
		t.Helper()

		res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
		require.NoError(t, err)
		defer res.Body.Close()

		if expectSuccess {
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
		} else {
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
		}

		data, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		return string(data)
	}

	testSetup := func(t *testing.T, crypto jwks.Crypto, allowedAlgorithms ...string) (string, []authentication.Authenticator) {
		t.Helper()

		authServer, err := jwks.NewServerWithCrypto(t, crypto)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		tokenDecoder, err := authentication.NewJwksTokenDecoder(
			NewContextWithCancel(t),
			zap.NewNop(),
			[]authentication.JWKSConfig{
				toJWKSConfig(authServer.JWKSURL(), time.Second*5, allowedAlgorithms...)})
		require.NoError(t, err)

		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         JwksName,
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
		require.NoError(t, err)

		authenticators := []authentication.Authenticator{authenticator}

		token, err := authServer.TokenForKID(crypto.KID(), nil, false)
		require.NoError(t, err)

		return token, authenticators
	}

	t.Run("RSA Tests", func(t *testing.T) {
		t.Parallel()

		t.Run("Test authentication with RSA 256", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})

		t.Run("Test authentication with RSA 384", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgRS384, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})

		t.Run("Test authentication with RSA 512", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgRS512, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})

		t.Run("Test authentication with RSA 256 PSS", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgPS256, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})

		t.Run("Test authentication with RSA 384 PSS", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgPS384, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})

		t.Run("Test authentication with RSA 512 PSS", func(t *testing.T) {
			t.Parallel()

			rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgPS512, 2048)
			require.NoError(t, err)

			token, authenticators := testSetup(t, rsaCrypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})
	})

	t.Run("HMAC Tests", func(t *testing.T) {
		t.Parallel()

		t.Run("Test authentication with HMAC 256", func(t *testing.T) {
			t.Parallel()

			hmac, err := jwks.NewHMACCrypto("", jwkset.AlgHS256)
			require.NoError(t, err)

			token, authenticators := testSetup(t, hmac)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})

		t.Run("Test authentication with HMAC 384", func(t *testing.T) {
			t.Parallel()

			hmac, err := jwks.NewHMACCrypto("", jwkset.AlgHS384)
			require.NoError(t, err)

			token, authenticators := testSetup(t, hmac)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})

		t.Run("Test authentication with HMAC 512", func(t *testing.T) {
			t.Parallel()

			hmac, err := jwks.NewHMACCrypto("", jwkset.AlgHS512)
			require.NoError(t, err)

			token, authenticators := testSetup(t, hmac)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})
	})

	t.Run("ED25519 Tests", func(t *testing.T) {
		t.Parallel()

		t.Run("Test authentication with ED25519", func(t *testing.T) {
			t.Parallel()

			ed25519Crypto, err := jwks.NewED25519Crypto("")
			require.NoError(t, err)

			token, authenticators := testSetup(t, ed25519Crypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})
	})

	t.Run("ECDSA Tests", func(t *testing.T) {
		t.Parallel()

		t.Run("Test authentication with ES256", func(t *testing.T) {
			t.Parallel()

			es256Crypto, err := jwks.NewES256Crypto("")
			require.NoError(t, err)

			token, authenticators := testSetup(t, es256Crypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})

		t.Run("Test authentication with ES384", func(t *testing.T) {
			t.Parallel()

			es384Crypto, err := jwks.NewES384Crypto("")
			require.NoError(t, err)

			token, authenticators := testSetup(t, es384Crypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})

		t.Run("Test authentication with ES512", func(t *testing.T) {
			t.Parallel()

			es512Crypto, err := jwks.NewES512Crypto("")
			require.NoError(t, err)

			token, authenticators := testSetup(t, es512Crypto)

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithAccessController(core.NewAccessController(authenticators, true)),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				t.Run("Should succeed when providing token", func(t *testing.T) {
					t.Parallel()
					body := testRequest(t, xEnv, authHeader(token), true)
					require.Equal(t, employeesExpectedData, string(body))

				})

				t.Run("Should fail when providing no Token", func(t *testing.T) {
					t.Parallel()

					body := testRequest(t, xEnv, nil, false)
					require.JSONEq(t, unauthorizedExpectedData, body)
				})
			})
		})
	})

	t.Run("Should not be able to add JWKS with an algorithm that was not allowed", func(t *testing.T) {
		t.Parallel()

		rsaCrypto, err := jwks.NewRSACrypto("", jwkset.AlgRS256, 2048)
		require.NoError(t, err)

		// We are adding an RSA key but only allow HMAC
		token, authenticators := testSetup(t, rsaCrypto, jwkset.AlgHS256.String())

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should fail
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}

			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer func() { _ = res.Body.Close() }()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
		})
	})
}

func TestAuthenticationOverWebsocket(t *testing.T) {
	t.Parallel()

	authServer, err := jwks.NewServer(t)
	require.NoError(t, err)
	defer authServer.Close()

	tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{toJWKSConfig(authServer.JWKSURL(), time.Second*5)})
	jwksOpts := authentication.HttpHeaderAuthenticatorOptions{
		Name:         JwksName,
		TokenDecoder: tokenDecoder,
	}

	authenticator, err := authentication.NewHttpHeaderAuthenticator(jwksOpts)
	require.NoError(t, err)
	authenticators := []authentication.Authenticator{authenticator}

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithAccessController(core.NewAccessController(authenticators, true)),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {

		conn, res, err := xEnv.GraphQLWebsocketDialWithRetry(nil, nil)
		require.Nil(t, conn)
		require.Error(t, err)
		require.Equal(t, http.StatusUnauthorized, res.StatusCode)

		token, err := authServer.Token(nil)
		require.NoError(t, err)

		headers := http.Header{
			"Authorization": []string{"Bearer " + token},
		}
		conn, res, err = xEnv.GraphQLWebsocketDialWithRetry(headers, nil)
		defer func() {
			require.NoError(t, conn.Close())
		}()

		require.NoError(t, err)
		require.Equal(t, http.StatusSwitchingProtocols, res.StatusCode)
	})
}

func TestAudienceValidation(t *testing.T) {
	t.Parallel()

	t.Run("authentication fails when there is no audience match", func(t *testing.T) {
		t.Parallel()

		t.Run("with slice of string audiences in the token", func(t *testing.T) {
			t.Parallel()

			t.Run("with http based configuration", func(t *testing.T) {
				t.Parallel()

				tokenAudiences := []string{"aud1", "aud2"}

				authServer, err := jwks.NewServer(t)
				require.NoError(t, err)
				t.Cleanup(authServer.Close)

				token, err := authServer.Token(map[string]any{"aud": tokenAudiences})
				require.NoError(t, err)

				authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
					{
						URL:             authServer.JWKSURL(),
						RefreshInterval: time.Second * 5,
						Audiences:       []string{"aud3", "aud5"},
					},
				})

				testenv.Run(t, &testenv.Config{
					RouterOptions: []core.Option{
						core.WithAccessController(core.NewAccessController(authenticators, true)),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					// Operations with a token should succeed
					header := http.Header{
						"Authorization": []string{"Bearer " + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusUnauthorized, res.StatusCode)
					require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.JSONEq(t, unauthorizedExpectedData, string(data))
				})
			})

			t.Run("with secret based configuration", func(t *testing.T) {
				t.Parallel()

				tokenAudiences := []string{"aud1", "aud2"}

				secret := "example secret"
				kid := "givenKID"
				authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
					{
						Secret:    secret,
						Algorithm: string(jwkset.AlgHS256),
						KeyId:     kid,
						Audiences: []string{"aud3", "aud5"},
					},
				})

				token := generateToken(t, kid, secret, jwt.SigningMethodHS256, jwt.MapClaims{
					"aud": tokenAudiences,
				})

				testenv.Run(t, &testenv.Config{
					RouterOptions: []core.Option{
						core.WithAccessController(core.NewAccessController(authenticators, true)),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					// Operations with a token should succeed
					header := http.Header{
						"Authorization": []string{"Bearer " + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusUnauthorized, res.StatusCode)
					require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.JSONEq(t, unauthorizedExpectedData, string(data))
				})
			})
		})

		t.Run("with single string audience in the token", func(t *testing.T) {
			t.Parallel()

			t.Run("with http based configuration", func(t *testing.T) {
				t.Parallel()

				tokenAudiences := "aud1"

				authServer, err := jwks.NewServer(t)
				require.NoError(t, err)
				t.Cleanup(authServer.Close)

				token, err := authServer.Token(map[string]any{"aud": tokenAudiences})
				require.NoError(t, err)

				authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
					{
						URL:             authServer.JWKSURL(),
						RefreshInterval: time.Second * 5,
						Audiences:       []string{"aud3", "aud5"},
					},
				})

				testenv.Run(t, &testenv.Config{
					RouterOptions: []core.Option{
						core.WithAccessController(core.NewAccessController(authenticators, true)),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					// Operations with a token should succeed
					header := http.Header{
						"Authorization": []string{"Bearer " + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusUnauthorized, res.StatusCode)
					require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.JSONEq(t, unauthorizedExpectedData, string(data))
				})
			})

			t.Run("with secret based configuration", func(t *testing.T) {
				t.Parallel()

				tokenAudience := "aud1"

				secret := "example secret"
				kid := "givenKID"
				authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
					{
						Secret:    secret,
						Algorithm: string(jwkset.AlgHS256),
						KeyId:     kid,
						Audiences: []string{"aud3", "aud5"},
					},
				})

				token := generateToken(t, kid, secret, jwt.SigningMethodHS256, jwt.MapClaims{
					"aud": tokenAudience,
				})

				testenv.Run(t, &testenv.Config{
					RouterOptions: []core.Option{
						core.WithAccessController(core.NewAccessController(authenticators, true)),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					// Operations with a token should succeed
					header := http.Header{
						"Authorization": []string{"Bearer " + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusUnauthorized, res.StatusCode)
					require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.JSONEq(t, unauthorizedExpectedData, string(data))
				})
			})
		})
	})

	t.Run("authentication succeeds when there is an audience match", func(t *testing.T) {
		t.Parallel()

		t.Run("with slice of string audiences in the token", func(t *testing.T) {
			t.Parallel()

			t.Run("with http based configuration", func(t *testing.T) {
				t.Parallel()

				matchingAudience := "matchingAudience"
				tokenAudiences := []string{matchingAudience, "aud5"}

				authServer, err := jwks.NewServer(t)
				require.NoError(t, err)
				t.Cleanup(authServer.Close)

				token, err := authServer.Token(map[string]any{"aud": tokenAudiences})
				require.NoError(t, err)

				authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
					{
						URL:             authServer.JWKSURL(),
						RefreshInterval: time.Second * 5,
						Audiences:       []string{matchingAudience, "aud5"},
					},
				})

				testenv.Run(t, &testenv.Config{
					RouterOptions: []core.Option{
						core.WithAccessController(core.NewAccessController(authenticators, true)),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					// Operations with a token should succeed
					header := http.Header{
						"Authorization": []string{"Bearer " + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.Equal(t, employeesExpectedData, string(data))
				})
			})

			t.Run("with secret based configuration", func(t *testing.T) {
				t.Parallel()

				matchingAud := "matchingAud"
				tokenAudiences := []string{matchingAud, "aud2"}

				secret := "example secret"
				kid := "givenKID"
				authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
					{
						Secret:    secret,
						Algorithm: string(jwkset.AlgHS256),
						KeyId:     kid,
						Audiences: []string{matchingAud, "aud5"},
					},
				})

				token := generateToken(t, kid, secret, jwt.SigningMethodHS256, jwt.MapClaims{
					"aud": tokenAudiences,
				})

				testenv.Run(t, &testenv.Config{
					RouterOptions: []core.Option{
						core.WithAccessController(core.NewAccessController(authenticators, true)),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					// Operations with a token should succeed
					header := http.Header{
						"Authorization": []string{"Bearer " + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.Equal(t, employeesExpectedData, string(data))
				})
			})
		})

		t.Run("with single string audience in the token", func(t *testing.T) {
			t.Parallel()

			t.Run("with http based configuration", func(t *testing.T) {
				t.Parallel()

				matchingAudience := "matchingAudience"

				authServer, err := jwks.NewServer(t)
				require.NoError(t, err)
				t.Cleanup(authServer.Close)

				token, err := authServer.Token(map[string]any{"aud": matchingAudience})
				require.NoError(t, err)

				authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
					{
						URL:             authServer.JWKSURL(),
						RefreshInterval: time.Second * 5,
						Audiences:       []string{matchingAudience, "aud5"},
					},
				})

				testenv.Run(t, &testenv.Config{
					RouterOptions: []core.Option{
						core.WithAccessController(core.NewAccessController(authenticators, true)),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					// Operations with a token should succeed
					header := http.Header{
						"Authorization": []string{"Bearer " + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.Equal(t, employeesExpectedData, string(data))
				})
			})

			t.Run("with secret based configuration", func(t *testing.T) {
				t.Parallel()

				matchingAud := "matchingAudience"

				secret := "example secret"
				kid := "givenKID"
				authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
					{
						Secret:    secret,
						Algorithm: string(jwkset.AlgHS256),
						KeyId:     kid,
						Audiences: []string{matchingAud, "aud5"},
					},
				})

				token := generateToken(t, kid, secret, jwt.SigningMethodHS256, jwt.MapClaims{
					"aud": matchingAud,
				})

				testenv.Run(t, &testenv.Config{
					RouterOptions: []core.Option{
						core.WithAccessController(core.NewAccessController(authenticators, true)),
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {
					// Operations with a token should succeed
					header := http.Header{
						"Authorization": []string{"Bearer " + token},
					}
					res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
					require.NoError(t, err)
					defer res.Body.Close()
					require.Equal(t, http.StatusOK, res.StatusCode)
					require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
					data, err := io.ReadAll(res.Body)
					require.NoError(t, err)
					require.Equal(t, employeesExpectedData, string(data))
				})
			})
		})
	})

	t.Run("authentication fails when audience is invalid format", func(t *testing.T) {
		t.Parallel()

		tokenAudiences := []bool{true, true}

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		token, err := authServer.Token(map[string]any{"aud": tokenAudiences})
		require.NoError(t, err)

		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: time.Second * 5,
				Audiences:       []string{"aud3", "aud5"},
			},
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnauthorized, res.StatusCode)
			require.Equal(t, "", res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, unauthorizedExpectedData, string(data))
		})

	})

	t.Run("audience validation is ignored when expected aud is not provided", func(t *testing.T) {
		t.Parallel()

		tokenAudiences := []bool{true, true}

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)

		token, err := authServer.Token(map[string]any{"aud": tokenAudiences})
		require.NoError(t, err)

		authenticators := ConfigureAuthWithJwksConfig(t, []authentication.JWKSConfig{
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: time.Second * 5,
			},
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Operations with a token should succeed
			header := http.Header{
				"Authorization": []string{"Bearer " + token},
			}
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", header, strings.NewReader(employeesQuery))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, JwksName, res.Header.Get(xAuthenticatedByHeader))
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, employeesExpectedData, string(data))
		})
	})
}

func toJWKSConfig(url string, refresh time.Duration, allowedAlgorithms ...string) authentication.JWKSConfig {
	return authentication.JWKSConfig{
		URL:               url,
		RefreshInterval:   refresh,
		AllowedAlgorithms: allowedAlgorithms,
	}
}

func generateToken(t *testing.T, kid string, secret string, signingMethod *jwt.SigningMethodHMAC, claims jwt.MapClaims) string {
	if claims == nil {
		claims = jwt.MapClaims{}
	}
	token := jwt.NewWithClaims(signingMethod, claims)
	token.Header[jwkset.HeaderKID] = kid
	jwtValue, err := token.SignedString([]byte(secret))
	require.NoError(t, err)
	return jwtValue
}
