package integration

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestVariableDeclarationRepair covers compatibility_flags.repair_undeclared_variables
// and repair_variable_types: variables nested inside input object or list literals
// with a missing or incompatible declaration are accepted when the flags are on and
// rejected by the validator when they are off.
func TestVariableDeclarationRepair(t *testing.T) {
	t.Parallel()

	t.Run("with repairs disabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Run("rejects undeclared variable nested in input object literal", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing { rootFieldWithInput(arg: { string: $s }) }`,
					Variables: json.RawMessage(`{"s":"hello"}`),
				})
				requireValidationError(t, res.Body, `variable "$s" is not defined on operation`)
			})

			t.Run("rejects undeclared variable used directly as argument", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing { rootFieldWithInput(arg: $arg) }`,
					Variables: json.RawMessage(`{"arg":{"string":"hello"}}`),
				})
				requireValidationError(t, res.Body, `variable: arg not defined on argument: arg`)
			})

			t.Run("rejects nullable variable nested in non-null position", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing($s: String) { rootFieldWithListOfInputArg(arg: [{ arg: $s }]) { arg } }`,
					Variables: json.RawMessage(`{"s":"hello"}`),
				})
				requireValidationError(t, res.Body, `Variable "$s" of type "String" used in position expecting type "String!".`)
			})
		})
	})

	t.Run("with repairs enabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCompatibilityFlags(config.CompatibilityFlags{
					RepairUndeclaredVariables: config.EnableFlag{Enabled: true},
					RepairVariableTypes:       config.EnableFlag{Enabled: true},
				}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Run("accepts undeclared variable nested in input object literal and logs a warning", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing { rootFieldWithInput(arg: { string: $s }) }`,
					Variables: json.RawMessage(`{"s":"hello"}`),
				})
				require.Equal(t, `{"data":{"rootFieldWithInput":"hello"}}`, res.Body)

				logs := xEnv.Observer().FilterMessageSnippet("Operation variable declarations were repaired").All()
				require.Len(t, logs, 1)
				require.Equal(t, "FetchThing", logs[0].ContextMap()["operation_name"])
				require.Equal(t, []any{"s"}, logs[0].ContextMap()["undeclared"])
				require.Equal(t, []any{}, logs[0].ContextMap()["retyped"])
			})

			// Variables used directly as argument values are not repaired.
			t.Run("rejects undeclared variable used directly as argument", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing { rootFieldWithInput(arg: $arg) }`,
					Variables: json.RawMessage(`{"arg":{"string":"hello"}}`),
				})
				requireValidationError(t, res.Body, `variable: arg not defined on argument: arg`)
			})

			t.Run("rejects nullable variable used directly in non-null argument", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing($n: Int) { sharedThings(numOfA: $n, numOfB: 1) { b } }`,
					Variables: json.RawMessage(`{"n":1}`),
				})
				requireValidationError(t, res.Body, `Variable "$n" of type "Int" used in position expecting type "Int!".`)
			})

			t.Run("logs the warning again on a normalization cache hit", func(t *testing.T) {
				for range 2 {
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query:     `query CachedThing { rootFieldWithInput(arg: { string: $s }) }`,
						Variables: json.RawMessage(`{"s":"hello"}`),
					})
					require.Equal(t, `{"data":{"rootFieldWithInput":"hello"}}`, res.Body)
				}

				var hits int
				for _, l := range xEnv.Observer().FilterMessageSnippet("Operation variable declarations were repaired").All() {
					if l.ContextMap()["operation_name"] == "CachedThing" {
						hits++
						require.Equal(t, []any{"s"}, l.ContextMap()["undeclared"])
					}
				}
				require.Equal(t, 2, hits)
			})

			t.Run("accepts undeclared variable nested in list inside input object", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing { rootFieldWithInput(arg: { strings: [$a, $b] }) }`,
					Variables: json.RawMessage(`{"a":"x","b":"y"}`),
				})
				require.Equal(t, `{"data":{"rootFieldWithInput":"x,y"}}`, res.Body)
			})

			t.Run("renders missing undeclared variable as null", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query FetchThing { rootFieldWithInput(arg: { string: $s }) }`,
				})
				require.Equal(t, `{"data":{"rootFieldWithInput":"empty arg"}}`, res.Body)
			})

			t.Run("rejects undeclared variable with wrong value type", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing { rootFieldWithInput(arg: { string: $s }) }`,
					Variables: json.RawMessage(`{"s":123}`),
				})
				requireValidationError(t, res.Body, `Variable "$a" got invalid value 123 at "a.string"; String cannot represent a non string value: 123`)
			})

			// Normalization evaluates skip/include from the request variables when the
			// variable is sent, so only the absent case reaches the validator.
			t.Run("leaves absent undeclared directive variable to the validator", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query FetchThing { rootFieldWithInput(arg: { string: "x" }) @include(if: $flag) }`,
				})
				requireValidationError(t, res.Body, `variable: flag not defined on argument: if`)
			})

			t.Run("retypes nullable variable nested in non-null position and logs a warning", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query RetypeThing($s: String) { rootFieldWithListOfInputArg(arg: [{ arg: $s }]) { arg } }`,
					Variables: json.RawMessage(`{"s":"hello"}`),
				})
				require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"hello"}]}}`, res.Body)

				logs := xEnv.Observer().FilterMessageSnippet("Operation variable declarations were repaired").All()
				require.Equal(t, "RetypeThing", logs[len(logs)-1].ContextMap()["operation_name"])
				require.Equal(t, []any{}, logs[len(logs)-1].ContextMap()["undeclared"])
				require.Equal(t, []any{"s"}, logs[len(logs)-1].ContextMap()["retyped"])
			})

			t.Run("retypes single variable used in list position", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing($s: String) { rootFieldWithInput(arg: { strings: $s }) }`,
					Variables: json.RawMessage(`{"s":"x"}`),
				})
				require.Equal(t, `{"data":{"rootFieldWithInput":"x"}}`, res.Body)
			})

			t.Run("retypes String variable used in enum position", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing($e: String) { rootFieldWithInput(arg: { enum: $e }) }`,
					Variables: json.RawMessage(`{"e":"A"}`),
				})
				require.Equal(t, `{"data":{"rootFieldWithInput":"A"}}`, res.Body)
			})

			// The missing value reaches variable validation as a null inside the
			// extracted input object.
			t.Run("rejects retyped variable with missing value in non-null position", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query FetchThing($s: String) { rootFieldWithListOfInputArg(arg: [{ arg: $s }]) { arg } }`,
				})
				requireValidationError(t, res.Body, `Variable "$a" got invalid value [{}]; Field "arg" of required type "String!" was not provided.`)
			})

			t.Run("rejects retyped enum variable with value outside the enum", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing($e: String) { rootFieldWithInput(arg: { enum: $e }) }`,
					Variables: json.RawMessage(`{"e":"NOPE"}`),
				})
				requireValidationError(t, res.Body, `Variable "$a" got invalid value {"enum":"NOPE"} at "a.enum"; Value "NOPE" does not exist in "EnumType" enum.`)
			})

			t.Run("rejects retyped list variable with wrong item type", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing($s: String) { rootFieldWithInput(arg: { strings: $s }) }`,
					Variables: json.RawMessage(`{"s":1}`),
				})
				requireValidationError(t, res.Body, `Variable "$a" got invalid value 1 at "a.strings.[0]"; String cannot represent a non string value: 1`)
			})

			t.Run("leaves variable with unknown declared type to the validator", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query FetchThing($s: Nope) { rootFieldWithInput(arg: { string: $s }) }`,
					Variables: json.RawMessage(`{"s":"x"}`),
				})
				var resp struct {
					Errors []struct{ Message string }
				}
				require.NoError(t, json.Unmarshal([]byte(res.Body), &resp))
				require.Len(t, resp.Errors, 2)
				require.Equal(t, `Unknown type "Nope".`, resp.Errors[0].Message)
			})

			t.Run("leaves variable with default value to the validator", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query FetchThing($s: String = "d") { rootFieldWithListOfInputArg(arg: [{ arg: $s }]) { arg } }`,
				})
				require.Equal(t, `{"data":{"rootFieldWithListOfInputArg":[{"arg":"d"}]}}`, res.Body)
			})
		})
	})
}
