package integration

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	sdktracetest "go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap/zapcore"
)

// requireInlineArgumentsLogEntry asserts the single Warn log emitted for a
// FindEmployee operation with one inline `id` argument, sent by test-client/1.2.3.
func requireInlineArgumentsLogEntry(t *testing.T, xEnv *testenv.Environment) {
	t.Helper()
	logs := xEnv.Observer().FilterMessage("inline arguments found in operation")
	require.Equal(t, 1, logs.Len())
	entry := logs.All()[0]
	require.Equal(t, zapcore.WarnLevel, entry.Level)
	cm := entry.ContextMap()
	require.Equal(t, int64(1), cm["count"])
	require.Equal(t, []interface{}{"id"}, cm["arguments"])
	require.Equal(t, "FindEmployee", cm["operation_name"])
	require.Equal(t, "test-client", cm["client_name"])
	require.Equal(t, "1.2.3", cm["client_version"])
}

// deferMultipartParts splits a multipart/mixed @defer body on the --graphql
// boundary and returns the raw JSON bytes of each part.
func deferMultipartParts(body []byte) [][]byte {
	var result [][]byte
	for _, part := range bytes.Split(body, []byte("--graphql")) {
		if bytes.HasPrefix(part, []byte("--")) {
			continue
		}
		_, jsonBody, found := bytes.Cut(part, []byte("\r\n\r\n"))
		if !found {
			continue
		}
		jsonBody = bytes.TrimSpace(jsonBody)
		if len(jsonBody) == 0 {
			continue
		}
		result = append(result, jsonBody)
	}
	return result
}

// inlineArgumentsSpanCounts returns the wg.operation.inline_arguments.count value
// of every exported span that carries the attribute.
func inlineArgumentsSpanCounts(exporter *sdktracetest.InMemoryExporter) []int64 {
	var counts []int64
	for _, span := range exporter.GetSpans().Snapshots() {
		for _, attr := range span.Attributes() {
			if attr.Key == otel.WgOperationInlineArgumentsCount {
				counts = append(counts, attr.Value.AsInt64())
			}
		}
	}
	return counts
}

// withInlineArgumentsMode returns a testenv security-configuration modifier that
// enables the disallow-inline-arguments policy in the given mode.
func withInlineArgumentsMode(mode config.DisallowInlineArgumentsMode) func(*config.SecurityConfiguration) {
	return func(s *config.SecurityConfiguration) {
		s.DisallowInlineArguments = config.DisallowInlineArguments{Mode: mode}
	}
}

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
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.JSONEq(t, `{"errors":[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","inlineArguments":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","message":"Inline argument values are not allowed. Use variables instead.","arguments":[{"argument":"id","valueKind":"Int"}]}}}]}`, res.Body)
		})
	})

	t.Run("enforce mode allows compliant operation", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
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

	// Normalization resolves @skip/@include directives with a static condition,
	// so their inline boolean is never reported.
	t.Run("enforce mode allows statically resolved include directive", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query($id: Int!) { employee(id: $id) @include(if: true) { id } }`,
				Variables: json.RawMessage(`{"id":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
		})
	})

	t.Run("enforce mode ignores non-executed sibling operation", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query A($id: Int!) { employee(id: $id) { id } } query B { employee(id: 1) { id } }`,
				OperationName: []byte(`"A"`),
				Variables:     json.RawMessage(`{"id":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employee":{"id":1}}}`, res.Body)
		})
	})

	t.Run("enforce mode rejects inline argument inside used fragment", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query { ...F } fragment F on Query { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.JSONEq(t, `{"errors":[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","inlineArguments":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","message":"Inline argument values are not allowed. Use variables instead.","arguments":[{"argument":"id","valueKind":"Int"}]}}}]}`, res.Body)
		})
	})

	// Introspection-field arguments are ordinary arguments; they are not exempt.
	t.Run("enforce mode rejects inline introspection argument", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ __type(name: "Employee") { name } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Contains(t, res.Body, `"INLINE_ARGUMENT_VALUES_NOT_ALLOWED"`)
		})
	})

	// Batch entries are processed independently: one offending entry is rejected
	// without affecting the compliant entries in the same batch.
	t.Run("enforce mode rejects only the offending batch entry", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			BatchingConfig: config.BatchingConfig{
				Enabled:            true,
				MaxConcurrency:     10,
				MaxEntriesPerBatch: 100,
			},
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
				{
					Query:     `query GetEmployee($id: Int!) { employee(id: $id) { id } }`,
					Variables: json.RawMessage(`{"id":1}`),
				},
				{
					Query: `{ employee(id: 1) { id } }`,
				},
			}, nil)
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)

			var entries []json.RawMessage
			require.NoError(t, json.Unmarshal([]byte(res.Body), &entries))
			require.Len(t, entries, 2)
			require.Equal(t, `{"data":{"employee":{"id":1}}}`, string(entries[0]))
			require.Contains(t, string(entries[1]), `"INLINE_ARGUMENT_VALUES_NOT_ALLOWED"`)
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
			require.JSONEq(t, `{"errors":[{"message":"Please use variables.","extensions":{"code":"VARIABLES_REQUIRED","inlineArguments":{"code":"VARIABLES_REQUIRED","message":"Please use variables.","arguments":[{"argument":"id","valueKind":"Int"}]}}}]}`, res.Body)
		})
	})

	t.Run("warn mode returns success with extensions annotation and logs a warning", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeWarn),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "test-client")
			header.Add("graphql-client-version", "1.2.3")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:  `query FindEmployee { employee(id: 1) { id } }`,
				Header: header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"employee":{"id":1}},"extensions":{"inlineArguments":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","message":"Inline argument values are not allowed. Use variables instead.","arguments":[{"argument":"id","valueKind":"Int"}]}}}`, res.Body)

			requireInlineArgumentsLogEntry(t, xEnv)
		})
	})

	// Schema-invalid operations never execute, so the check is skipped for them:
	// its warn log and span count would only skew the migration telemetry that
	// operators use to find non-compliant clients.
	t.Run("warn mode does not log for schema-invalid operations", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeWarn),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ nonExistentField(id: 1) { id } }`,
			})
			require.NoError(t, err)
			require.Contains(t, res.Body, `"errors"`)
			require.NotContains(t, res.Body, `"inlineArguments"`)
			require.Equal(t, 0, xEnv.Observer().FilterMessage("inline arguments found in operation").Len())
		})
	})

	// Pins the cache-consistency property documented on detectInlineArguments.
	t.Run("warn mode reports identically across normalization cache miss and hit", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeWarn),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			query := `query { ...F } fragment F on Query { employee(id: 1) { id } }`
			want := `{"data":{"employee":{"id":1}},"extensions":{"inlineArguments":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","message":"Inline argument values are not allowed. Use variables instead.","arguments":[{"argument":"id","valueKind":"Int"}]}}}`
			for range 2 {
				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: query})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, want, res.Body)
			}
		})
	})

	t.Run("enforce mode logs a warning with client details", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "test-client")
			header.Add("graphql-client-version", "1.2.3")
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:  `query FindEmployee { employee(id: 1) { id } }`,
				Header: header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)

			requireInlineArgumentsLogEntry(t, xEnv)
		})
	})

	// Enforce-mode rejections must attribute their error code like other
	// pre-execution rejections, so operators can dashboard the warn->enforce
	// migration by error code in access logs and metrics.
	t.Run("enforce mode rejection records the error code in access logs", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			AccessLogFields: []config.CustomAttribute{
				{
					Key: "error_codes",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldGraphQLErrorCodes,
					},
				},
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)

			requestLog := xEnv.Observer().FilterMessage("/graphql").All()
			require.Len(t, requestLog, 1)
			require.Equal(t, []interface{}{"INLINE_ARGUMENT_VALUES_NOT_ALLOWED"}, requestLog[0].ContextMap()["error_codes"])
		})
	})

	t.Run("inline arguments count is set on the router span", func(t *testing.T) {
		t.Parallel()
		exporter := tracetest.NewInMemoryExporter(t)
		testenv.Run(t, &testenv.Config{
			TraceExporter:               exporter,
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeWarn),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, []int64{1}, inlineArgumentsSpanCounts(exporter))
		})
	})

	t.Run("inline arguments count is set on the router span on rejection", func(t *testing.T) {
		t.Parallel()
		exporter := tracetest.NewInMemoryExporter(t)
		testenv.Run(t, &testenv.Config{
			TraceExporter:               exporter,
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `{ employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, []int64{1}, inlineArgumentsSpanCounts(exporter))
		})
	})

	t.Run("inline arguments count is absent for compliant operations", func(t *testing.T) {
		t.Parallel()
		exporter := tracetest.NewInMemoryExporter(t)
		testenv.Run(t, &testenv.Config{
			TraceExporter:               exporter,
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeWarn),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query GetEmployee($id: Int!) { employee(id: $id) { id } }`,
				Variables: json.RawMessage(`{"id":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.NotEmpty(t, exporter.GetSpans().Snapshots())
			require.Empty(t, inlineArgumentsSpanCounts(exporter))
		})
	})

	// The stored persisted operation 4000...0 is
	// `query MyQuery($yes: Boolean! = true) { employee(id: 1) { details { forename surname @include(if: $yes) } } }`
	// which carries exactly one inline argument (id: 1); the variable-definition
	// default and the @include(if: $yes) variable are compliant.
	t.Run("enforce mode exempts persisted operations by default", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
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

	// APQ hashes are computed by the client, so an APQ operation carries no operator
	// intent: the persisted-operation exemption must not apply, or any client could
	// bypass enforce mode by attaching a persistedQuery extension to its request.
	t.Run("enforce mode applies to automatic persisted queries", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: true,
				Cache:   config.AutomaticPersistedQueriesCacheConfig{Size: 1024 * 1024},
			},
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			query := `{ employee(id: 1) { id } }`
			hash := sha256.Sum256([]byte(query))
			extensions := []byte(fmt.Sprintf(`{"persistedQuery": {"version": 1, "sha256Hash": "%s"}}`, hex.EncodeToString(hash[:])))
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			// The APQ registration request carries the query body and its client-computed hash.
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:      query,
				Extensions: extensions,
				Header:     header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Contains(t, res.Body, `"INLINE_ARGUMENT_VALUES_NOT_ALLOWED"`)

			// A hash-only request served from the APQ cache is rejected as well.
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Extensions: extensions,
				Header:     header,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Contains(t, res.Body, `"INLINE_ARGUMENT_VALUES_NOT_ALLOWED"`)
		})
	})

	// A REGISTERED persisted operation sent APQ-style (query body + sha256 hash,
	// the shape Apollo clients use to seed APQ) must classify as registered, not
	// APQ: the exemption applies, and the cached entry must not poison subsequent
	// hash-only requests for the same operation.
	t.Run("enforce mode exempts registered operation sent as body plus hash", func(t *testing.T) {
		t.Parallel()

		// The stored operation 49a2f7dd... for my-client; the body matches the
		// fixture byte-for-byte so its sha256 equals the registered hash and the
		// prehandler's hash-body match check passes.
		const registeredOpBody = "mutation updateEmployeeTag {\n  updateEmployeeTag(id: 10, tag: \"dd\") {\n    id\n  }\n}"
		registeredOpExtensions := []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "49a2f7dd56b06f620c7d040dd9d562a1c16eadf7c149be5decdd62cfc92e1b12"}}`)

		apqConfig := config.AutomaticPersistedQueriesConfig{
			Enabled: true,
			Cache:   config.AutomaticPersistedQueriesCacheConfig{Size: 1024 * 1024},
		}

		t.Run("body plus hash is exempt and does not poison hash-only requests", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ApqConfig:                   apqConfig,
				ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")

				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query:      registeredOpBody,
					Extensions: registeredOpExtensions,
					Header:     header,
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":10}}}`, res.Body)

				// The body+hash request above must not have cached the operation as
				// APQ; a hash-only follow-up stays exempt.
				res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Extensions: registeredOpExtensions,
					Header:     header,
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":10}}}`, res.Body)
			})
		})

		t.Run("hash-only first then body plus hash are both exempt", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ApqConfig:                   apqConfig,
				ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")

				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Extensions: registeredOpExtensions,
					Header:     header,
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":10}}}`, res.Body)

				res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query:      registeredOpBody,
					Extensions: registeredOpExtensions,
					Header:     header,
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":10}}}`, res.Body)
			})
		})

		// Registered operations are per-client: the same body+hash from a client
		// the operation is not registered for classifies as APQ and stays subject
		// to the policy.
		t.Run("body plus hash from another client is not exempt", func(t *testing.T) {
			t.Parallel()
			testenv.Run(t, &testenv.Config{
				ApqConfig:                   apqConfig,
				ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "other-client")

				res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query:      registeredOpBody,
					Extensions: registeredOpExtensions,
					Header:     header,
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
				require.Contains(t, res.Body, `"INLINE_ARGUMENT_VALUES_NOT_ALLOWED"`)
			})
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
			require.JSONEq(t, `{"errors":[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","inlineArguments":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","message":"Inline argument values are not allowed. Use variables instead.","arguments":[{"argument":"id","valueKind":"Int"}]}}}]}`, res.Body)
		})
	})

	t.Run("enforce mode rejects inline arguments over websocket", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription($i: Int!) { countEmp(max: 5, intervalMilliseconds: $i) }","variables":{"i":500}}`),
			})
			require.NoError(t, err)
			var res testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "error", res.Type)
			require.Equal(t, "1", res.ID)
			require.JSONEq(t, `[{"message":"Inline argument values are not allowed. Use variables instead.","extensions":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","inlineArguments":{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","message":"Inline argument values are not allowed. Use variables instead.","arguments":[{"argument":"max","valueKind":"Int"}]}}}]`, string(res.Payload))
		})
	})

	t.Run("warn mode logs a warning over websocket", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeWarn),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"subscription { countEmp(max: 1, intervalMilliseconds: 100) }"}`),
			})
			require.NoError(t, err)
			var res testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)

			logs := xEnv.Observer().FilterMessage("inline arguments found in operation")
			require.Equal(t, 1, logs.Len())
			cm := logs.All()[0].ContextMap()
			require.Equal(t, int64(2), cm["count"])
			require.Equal(t, []interface{}{"max", "intervalMilliseconds"}, cm["arguments"])
		})
	})

	// Deferred queries stream a multipart response; the annotation belongs in the
	// initial part's extensions, mirroring the single-body warn-mode behavior.
	t.Run("warn mode annotates the initial part of a deferred response", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			NoRetryClient:               true,
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeWarn),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			payload, err := json.Marshal(map[string]any{
				"query": `query { employee(id: 1) { id ... @defer { isAvailable } } }`,
			})
			require.NoError(t, err)

			req := xEnv.MakeGraphQLDeferRequest(http.MethodPost, bytes.NewReader(payload))
			res, err := xEnv.RouterClient.Do(req)
			require.NoError(t, err)
			defer func() { require.NoError(t, res.Body.Close()) }()

			require.Equal(t, http.StatusOK, res.StatusCode)
			require.True(t, strings.HasPrefix(res.Header.Get("Content-Type"), "multipart/mixed"),
				"expected multipart/mixed, got %q", res.Header.Get("Content-Type"))

			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			parts := deferMultipartParts(body)
			require.NotEmpty(t, parts)

			// The argument appears twice: detection runs on the normalized document
			// (see detectInlineArguments), and defer normalization duplicates the
			// deferred field's parent path -- including its arguments -- into the
			// hoisted deferred selection.
			annotation := `{"code":"INLINE_ARGUMENT_VALUES_NOT_ALLOWED","message":"Inline argument values are not allowed. Use variables instead.","arguments":[{"argument":"id","valueKind":"Int"},{"argument":"id","valueKind":"Int"}]}`
			var initial struct {
				Extensions struct {
					InlineArguments json.RawMessage `json:"inlineArguments"`
				} `json:"extensions"`
			}
			require.NoError(t, json.Unmarshal(parts[0], &initial))
			require.JSONEq(t, annotation, string(initial.Extensions.InlineArguments))

			for _, part := range parts[1:] {
				require.NotContains(t, string(part), `"inlineArguments"`)
			}
		})
	})

	t.Run("enforce mode rejects deferred query with inline arguments", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			NoRetryClient:               true,
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeEnforce),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			payload, err := json.Marshal(map[string]any{
				"query": `query { employee(id: 1) { id ... @defer { isAvailable } } }`,
			})
			require.NoError(t, err)

			req := xEnv.MakeGraphQLDeferRequest(http.MethodPost, bytes.NewReader(payload))
			res, err := xEnv.RouterClient.Do(req)
			require.NoError(t, err)
			defer func() { require.NoError(t, res.Body.Close()) }()

			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Contains(t, string(body), `"INLINE_ARGUMENT_VALUES_NOT_ALLOWED"`)
		})
	})

	t.Run("warn mode compliant operation has no annotation", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: withInlineArgumentsMode(config.DisallowInlineArgumentsModeWarn),
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
