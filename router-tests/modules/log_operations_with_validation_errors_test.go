package module_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	logvalidationerrors "github.com/wundergraph/cosmo/router-tests/modules/log-operations-with-validation-errors"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

// TestLogOperationsWithValidationErrorsModule verifies the module that logs a
// warning for every operation rejected with validation errors (Pylon issue
// #3351: collect the operations that stopped working after the router started
// validating operations before variable extraction).
func TestLogOperationsWithValidationErrorsModule(t *testing.T) {
	t.Parallel()

	const (
		logMessage = "Operation rejected with validation errors"

		// The Pylon #3351 shape on the demo schema: a variable declared as
		// [String!]! used in a position expecting [EnumType!]!, see
		// operations/string_variables_for_enums_test.go.
		invalidQuery    = `query Bad($programs: [String!]!) { rootFieldWithListOfEnumArg(arg: $programs) }`
		validationError = `Variable "$programs" of type "[String!]!" used in position expecting type "[EnumType!]!".`

		validQuery = `query Good($programs: [EnumType!]!) { rootFieldWithListOfEnumArg(arg: $programs) }`
	)

	variables := json.RawMessage(`{"programs":["A","B"]}`)

	// requireValidationError asserts the response body carries exactly one
	// error with the given message.
	requireValidationError := func(t *testing.T, body, wantMessage string) {
		t.Helper()

		var resp struct {
			Errors []struct {
				Message string `json:"message"`
			} `json:"errors"`
		}
		require.NoErrorf(t, json.Unmarshal([]byte(body), &resp), "invalid JSON body: %s", body)
		require.Lenf(t, resp.Errors, 1, "expected exactly one error, got body: %s", body)
		require.Equal(t, wantMessage, resp.Errors[0].Message)
	}

	t.Run("disabled by default: rejects the operation without logging", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModules(&logvalidationerrors.LogOperationsWithValidationErrors{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     invalidQuery,
				Variables: variables,
			})
			requireValidationError(t, res.Body, validationError)

			assert.Empty(t, xEnv.Observer().FilterMessage(logMessage).All())
		})
	})

	t.Run("enabled via router config: logs operation name and validation error", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModules(&logvalidationerrors.LogOperationsWithValidationErrors{}),
				core.WithModulesConfig(map[string]any{
					logvalidationerrors.ModuleID: map[string]any{
						"enabled": true,
					},
				}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     invalidQuery,
				Variables: variables,
			})
			requireValidationError(t, res.Body, validationError)

			logs := xEnv.Observer().FilterMessage(logMessage).All()
			require.Len(t, logs, 1)
			require.Equal(t, zapcore.WarnLevel, logs[0].Level)

			fields := logs[0].ContextMap()
			assert.Equal(t, "Bad", fields["operation_name"])
			assert.Equal(t, []any{validationError}, fields["validation_errors"])
		})
	})

	t.Run("enabled via router config: valid operations are not logged", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCustomModules(&logvalidationerrors.LogOperationsWithValidationErrors{}),
				core.WithModulesConfig(map[string]any{
					logvalidationerrors.ModuleID: map[string]any{
						"enabled": true,
					},
				}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     validQuery,
				Variables: variables,
			})
			assert.Equal(t, `{"data":{"rootFieldWithListOfEnumArg":["A","B"]}}`, res.Body)

			assert.Empty(t, xEnv.Observer().FilterMessage(logMessage).All())
		})
	})
}
