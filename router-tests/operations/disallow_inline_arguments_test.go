package integration

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestValidateInlineArguments(t *testing.T) {
	t.Parallel()

	const inlineArgumentQuery = `query GetEmployee { employee(id: 1) { id } }`
	const variableQuery = `query GetEmployee($id: Int!) { employee(id: $id) { id } }`

	t.Run("off (default) executes inline-argument operations normally", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: inlineArgumentQuery})
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
		})
	})

	t.Run("enforcing rejects an inline field argument", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode:                  config.EnforcementModeStrict,
					EnforceHTTPStatusCode: 400,
					ErrorCode:             "INLINE_ARGUMENT_VALUES_NOT_ALLOWED",
					ErrorMessage:          "Inline argument values are not allowed. Use variables instead.",
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: inlineArgumentQuery})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			// The rejection is a generic error: no argument name and no location.
			require.Equal(t, `{"errors":[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED"}}]}`, res.Body)
		})
	})

	t.Run("enforcing stays a generic error even when return_in_response_extensions is set", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode:                       config.EnforcementModeStrict,
					EnforceHTTPStatusCode:      400,
					ErrorCode:                  "INLINE_ARGUMENT_VALUES_NOT_ALLOWED",
					ErrorMessage:               "Inline argument values are not allowed. Use variables instead.",
					ReturnInResponseExtensions: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: inlineArgumentQuery})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			// return_in_response_extensions only affects non-enforcing mode; the
			// enforce rejection stays generic — no argument name, no location.
			require.JSONEq(t, `{"errors":[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED"}}]}`, res.Body)
		})
	})

	t.Run("enforcing passes a compliant operation using variables", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode:                  config.EnforcementModeStrict,
					EnforceHTTPStatusCode: 400,
					ErrorCode:             "INLINE_ARGUMENT_VALUES_NOT_ALLOWED",
					ErrorMessage:          "Inline argument values are not allowed. Use variables instead.",
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     variableQuery,
				Variables: []byte(`{"id":1}`),
			})
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
		})
	})

	t.Run("non-enforcing executes the operation and logs a warning", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode:         config.EnforcementModePermissive,
					ErrorCode:    "INLINE_ARGUMENT_VALUES_NOT_ALLOWED",
					ErrorMessage: "Inline argument values are not allowed. Use variables instead.",
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: inlineArgumentQuery})
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)

			warnings := xEnv.Observer().FilterMessage("Inline argument values found in operation; use variables instead").All()
			require.Len(t, warnings, 1)
			fields := warnings[0].ContextMap()
			assert.EqualValues(t, 1, fields["count"])
			// Enclosing field context comes from the walker.
			assert.Equal(t, []any{"query.employee#id"}, fields["arguments"])
			assert.Equal(t, "GetEmployee", fields["operation_name"])
		})
	})

	t.Run("non-enforcing warns on a normalization cache hit too", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode: config.EnforcementModePermissive,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send the same inline-argument operation twice. The second request
			// hits the normalization cache, but the warning must still fire because
			// the findings are restored from the cache entry.
			for i := 0; i < 2; i++ {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: inlineArgumentQuery})
				require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			}

			warnings := xEnv.Observer().FilterMessage("Inline argument values found in operation; use variables instead").All()
			require.Len(t, warnings, 2, "warning must fire on both the cache-miss and the cache-hit request")
		})
	})

	t.Run("non-enforcing does not warn for compliant operations", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode: config.EnforcementModePermissive,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     variableQuery,
				Variables: []byte(`{"id":1}`),
			})
			require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)

			warnings := xEnv.Observer().FilterMessage("Inline argument values found in operation; use variables instead").All()
			require.Empty(t, warnings)
		})
	})

	// The WebSocket handler runs its own normalization path (core/websocket.go),
	// separate from the HTTP prehandler. Non-enforcing detection must warn there
	// too, so operations sent over WebSockets are not silently exempt.
	t.Run("non-enforcing warns for an operation sent over a WebSocket", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode: config.EnforcementModePermissive,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"` + inlineArgumentQuery + `"}`),
			})
			require.NoError(t, err)

			var res testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, string(res.Payload))

			var complete testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)

			// Normalization (and the warning) runs before the response is produced,
			// so once "complete" arrives the log entry is guaranteed present.
			warnings := xEnv.Observer().FilterMessage("Inline argument values found in operation; use variables instead").All()
			require.Len(t, warnings, 1)
			fields := warnings[0].ContextMap()
			assert.EqualValues(t, 1, fields["count"])
			assert.Equal(t, []any{"query.employee#id"}, fields["arguments"])
			assert.Equal(t, "GetEmployee", fields["operation_name"])
		})
	})

	t.Run("non-enforcing returns inline arguments in response extensions when configured", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode:                       config.EnforcementModePermissive,
					ReturnInResponseExtensions: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send the same inline-argument operation twice. The second request hits
			// the normalization cache; the extension must still surface because the
			// findings are restored from the cache entry (same as the warning log).
			const wantBody = `{"data":{"employee":{"id":1}},"extensions":{"inlineArguments":{"count":1,"arguments":["query.employee#id"]}}}`
			for i := 0; i < 2; i++ {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: inlineArgumentQuery})
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.JSONEq(t, wantBody, res.Body, "extension must surface on both cache-miss and cache-hit")
			}

			// A compliant operation must not carry the extension.
			resOK := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     variableQuery,
				Variables: []byte(`{"id":1}`),
			})
			require.Equal(t, `{"data":{"employee":{"id":1}}}`, resOK.Body)
		})
	})

	t.Run("non-enforcing omits the extension when reporting is disabled", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode: config.EnforcementModePermissive,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: inlineArgumentQuery})
			require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
		})
	})

	t.Run("non-enforcing returns the extension over a WebSocket when configured", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode:                       config.EnforcementModePermissive,
					ReturnInResponseExtensions: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"` + inlineArgumentQuery + `"}`),
			})
			require.NoError(t, err)

			var res testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.JSONEq(t, `{"data":{"employee":{"id":1}},"extensions":{"inlineArguments":{"count":1,"arguments":["query.employee#id"]}}}`, string(res.Payload))
		})
	})
}

// TestValidateInlineArgumentsPersistedOperations covers the persisted-operation
// exemption. The persisted operation 4000...0000 ("MyQuery") contains a single
// inline argument (employee(id: 1)); its `$yes` is a variable-definition default
// (excluded) and its @include uses a variable (compliant).
func TestValidateInlineArgumentsPersistedOperations(t *testing.T) {
	t.Parallel()

	const persistedInlineArgHash = "4000000000000000000000000000000000000000000000000000000000000000"
	const okBody = `{"data":{"employee":{"details":{"forename":"Jens","surname":"Neuse"}}}}`

	persistedInlineArgRequest := func() testenv.GraphQLRequest {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		return testenv.GraphQLRequest{
			OperationName: []byte(`"MyQuery"`),
			Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + persistedInlineArgHash + `"}}`),
			Header:        header,
			Variables:     []byte(`{}`),
		}
	}

	t.Run("enforcing exempts persisted operations by default", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode:                  config.EnforcementModeStrict,
					EnforceHTTPStatusCode: 400,
					ErrorCode:             "INLINE_ARGUMENT_VALUES_NOT_ALLOWED",
					ErrorMessage:          "Inline argument values are not allowed. Use variables instead.",
					// IncludePersistedOperations defaults to false — persisted ops are exempt.
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(persistedInlineArgRequest())
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, okBody, res.Body)
		})
	})

	t.Run("enforcing rejects persisted operations when include_persisted_operations is true", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode:                       config.EnforcementModeStrict,
					EnforceHTTPStatusCode:      400,
					ErrorCode:                  "INLINE_ARGUMENT_VALUES_NOT_ALLOWED",
					ErrorMessage:               "Inline argument values are not allowed. Use variables instead.",
					IncludePersistedOperations: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(persistedInlineArgRequest())
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			// The rejection is a generic error: no argument name and no location.
			require.Equal(t, `{"errors":[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED"}}]}`, res.Body)
		})
	})

	t.Run("non-enforcing exempts persisted operations by default (no warning)", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.WarnLevel},
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode: config.EnforcementModePermissive,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(persistedInlineArgRequest())
			require.NoError(t, err)
			require.Equal(t, okBody, res.Body)

			warnings := xEnv.Observer().FilterMessage("Inline argument values found in operation; use variables instead").All()
			require.Empty(t, warnings)
		})
	})

	t.Run("non-enforcing warns for persisted operations when included", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.WarnLevel},
			ModifyEngineExecutionConfiguration: func(s *config.EngineExecutionConfiguration) {
				s.ValidateInlineArguments = config.ValidateInlineArguments{
					Mode:                       config.EnforcementModePermissive,
					IncludePersistedOperations: true,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(persistedInlineArgRequest())
			require.NoError(t, err)
			require.Equal(t, okBody, res.Body)

			warnings := xEnv.Observer().FilterMessage("Inline argument values found in operation; use variables instead").All()
			require.Len(t, warnings, 1)
			fields := warnings[0].ContextMap()
			assert.EqualValues(t, 1, fields["count"])
			assert.Equal(t, []any{"query.employee#id"}, fields["arguments"])
		})
	})
}
