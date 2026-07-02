package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap/zapcore"
)

func TestDisallowInlineArguments(t *testing.T) {
	t.Parallel()

	t.Run("off by default, inline query succeeds normally", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
		})
	})

	t.Run("enforce mode rejects inline field argument", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(s *config.SecurityConfiguration) {
				s.DisallowInlineArguments = config.DisallowInlineArguments{
					Mode: config.DisallowInlineArgumentsModeEnforce,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","inlineArguments":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","message":"Inline argument values are not allowed. Use variables instead.","arguments":[{"argument":"id","valueKind":"Int","line":1,"column":12}]}}}]}`, res.Body)
		})
	})

	t.Run("enforce mode allows compliant operation", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(s *config.SecurityConfiguration) {
				s.DisallowInlineArguments = config.DisallowInlineArguments{
					Mode: config.DisallowInlineArgumentsModeEnforce,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query GetEmployee($id: Int!) { employee(id: $id) { id } }`,
				Variables: json.RawMessage(`{"id":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Contains(t, res.Body, `"data"`)
			require.NotContains(t, res.Body, `"errors"`)
		})
	})

	t.Run("enforce mode rejects inline directive argument", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(s *config.SecurityConfiguration) {
				s.DisallowInlineArguments = config.DisallowInlineArguments{
					Mode: config.DisallowInlineArgumentsModeEnforce,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query($id: Int!) { employee(id: $id) @include(if: true) { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","inlineArguments":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","message":"Inline argument values are not allowed. Use variables instead.","arguments":[{"argument":"if","valueKind":"Boolean","line":1,"column":47}]}}}]}`, res.Body)
		})
	})

	t.Run("enforce mode custom status code and message", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(s *config.SecurityConfiguration) {
				s.DisallowInlineArguments = config.DisallowInlineArguments{
					Mode:                  config.DisallowInlineArgumentsModeEnforce,
					EnforceHTTPStatusCode: http.StatusUnprocessableEntity,
					ErrorCode:             "VARIABLES_REQUIRED",
					ErrorMessage:          "Please use variables.",
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusUnprocessableEntity, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Please use variables.","extensions":{"code":"VARIABLES_REQUIRED","inlineArguments":{"code":"VARIABLES_REQUIRED","message":"Please use variables.","arguments":[{"argument":"id","valueKind":"Int","line":1,"column":12}]}}}]}`, res.Body)
		})
	})

	t.Run("warn mode returns success with extensions annotation and logs a warning", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			ModifySecurityConfiguration: func(s *config.SecurityConfiguration) {
				s.DisallowInlineArguments = config.DisallowInlineArguments{
					Mode: config.DisallowInlineArgumentsModeWarn,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employee":{"id":1}},"extensions":{"inlineArguments":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","message":"Inline argument values are not allowed. Use variables instead.","arguments":[{"argument":"id","valueKind":"Int","line":1,"column":12}]}}}`, res.Body)

			logs := xEnv.Observer().FilterMessage("inline arguments found in operation")
			require.Equal(t, 1, logs.Len())
			require.Equal(t, zapcore.WarnLevel, logs.All()[0].Level)
			require.Equal(t, int64(1), logs.All()[0].ContextMap()["count"])
		})
	})

	// The stored persisted operation 4000...0 is
	// `query MyQuery($yes: Boolean! = true) { employee(id: 1) { details { forename surname @include(if: $yes) } } }`
	// which carries exactly one inline argument (id: 1); the variable-definition
	// default and the @include(if: $yes) variable are compliant.
	t.Run("enforce mode exempts persisted operations by default", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(s *config.SecurityConfiguration) {
				s.DisallowInlineArguments = config.DisallowInlineArguments{
					Mode: config.DisallowInlineArgumentsModeEnforce,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"MyQuery"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "4000000000000000000000000000000000000000000000000000000000000000"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		})
	})

	t.Run("enforce mode rejects persisted operations when included", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(s *config.SecurityConfiguration) {
				s.DisallowInlineArguments = config.DisallowInlineArguments{
					Mode:                       config.DisallowInlineArgumentsModeEnforce,
					IncludePersistedOperations: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				OperationName: []byte(`"MyQuery"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "4000000000000000000000000000000000000000000000000000000000000000"}}`),
				Header:        header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","inlineArguments":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","message":"Inline argument values are not allowed. Use variables instead.","arguments":[{"argument":"id","valueKind":"Int","line":1,"column":49}]}}}]}`, res.Body)
		})
	})

	t.Run("warn mode compliant operation has no annotation", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(s *config.SecurityConfiguration) {
				s.DisallowInlineArguments = config.DisallowInlineArguments{
					Mode: config.DisallowInlineArgumentsModeWarn,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query GetEmployee($id: Int!) { employee(id: $id) { id } }`,
				Variables: json.RawMessage(`{"id":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.NotContains(t, res.Body, `"inlineArguments"`)
		})
	})
}
