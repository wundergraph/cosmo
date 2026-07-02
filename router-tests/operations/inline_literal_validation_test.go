package integration

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/wundergraph/cosmo/router-tests/testenv"
)

// TestInlineLiteralValidation covers ENG-9820.
//
// A syntactically valid but type-incorrect *inline* argument literal (most
// notably an unquoted single-word enum value used for a String argument, e.g.
// `headerValue(name: hello)`) must be rejected by schema validation.
//
// The regression is a stage-ordering bug: the router extracts inline argument
// values into variables *before* running full operation validation. During
// extraction the enum literal `hello` is serialized to the JSON string
// "hello", which then satisfies the String type, so both the ValuesOfCorrectType
// rule (which only sees `$a: String!`) and variable validation (which sees the
// valid string "hello") pass. Apollo rejects this with
// `String cannot represent a non string value: hello`, and so must Cosmo.
//
// These tests encode the desired behaviour. Until the fix lands, the "rejects"
// sub-tests are expected to FAIL (the buggy router currently forwards the value
// as a string and returns data, or returns a variable-scoped error message
// instead of the clean validation message).
func TestInlineLiteralValidation(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		// -------------------------------------------------------------------
		// Rejected: invalid inline literals must fail schema validation with
		// the exact ValuesOfCorrectType message, before extraction.
		// -------------------------------------------------------------------

		// The core ENG-9820 reproduction: unquoted enum literal for String!.
		// Currently BUGGY: forwarded to the subgraph as "hello" -> returns data.
		t.Run("rejects unquoted enum literal for String argument", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { headerValue(name: hello) }`,
			})
			requireValidationError(t, res.Body, `String cannot represent a non string value: hello`)
		})

		// Integer literal for String!. Currently caught, but with a
		// variable-scoped message; after the fix it must be the clean message.
		t.Run("rejects integer literal for String argument", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { headerValue(name: 123) }`,
			})
			requireValidationError(t, res.Body, `String cannot represent a non string value: 123`)
		})

		// Boolean literal for String!.
		t.Run("rejects boolean literal for String argument", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { headerValue(name: true) }`,
			})
			requireValidationError(t, res.Body, `String cannot represent a non string value: true`)
		})

		// Same bug, but the invalid literal is nested inside an input object's
		// String field. Currently BUGGY: returns data "hello".
		t.Run("rejects unquoted enum literal for String field of input object", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { rootFieldWithInput(arg: {string: hello}) }`,
			})
			requireValidationError(t, res.Body, `String cannot represent a non string value: hello`)
		})

		// Same bug, but the invalid literal is an element of a [String!]! list.
		// Currently BUGGY: returns data ["hello"].
		t.Run("rejects unquoted enum literal in list of String", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { rootFieldWithListArg(arg: [hello]) }`,
			})
			requireValidationError(t, res.Body, `String cannot represent a non string value: hello`)
		})

		// A different scalar type, to prove the fix is not String-specific and
		// that the clean (non variable-scoped) message is produced for inline
		// literals of any scalar type.
		t.Run("rejects unquoted enum literal for Float argument", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { floatField(arg: FOO) }`,
			})
			requireValidationError(t, res.Body, `Float cannot represent non numeric value: FOO`)
		})

		// An enum literal that is not a member of the enum must still be
		// rejected (regression guard for enum validation itself).
		t.Run("rejects unknown enum value for enum argument", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { rootFieldWithListOfEnumArg(arg: [NOPE]) }`,
			})
			requireValidationError(t, res.Body, `Value "NOPE" does not exist in "EnumType" enum.`)
		})

		// -------------------------------------------------------------------
		// Accepted: valid inputs must keep working. These are the regression
		// guards ensuring the fix does not over-reject legitimate literals.
		// -------------------------------------------------------------------

		// A properly quoted String literal must still work.
		t.Run("accepts quoted string literal for String argument", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { headerValue(name: "foo") }`,
			})
			assert.Equal(t, `{"data":{"headerValue":""}}`, res.Body)
		})

		// A legitimate inline enum literal for an enum-typed argument must
		// still validate and be extracted correctly.
		t.Run("accepts inline enum literal for enum argument", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { rootFieldWithListOfEnumArg(arg: [A]) }`,
			})
			assert.Equal(t, `{"data":{"rootFieldWithListOfEnumArg":["A"]}}`, res.Body)
		})

		// An inline enum literal for an enum field inside an input object must
		// still validate and extract.
		t.Run("accepts inline enum literal for enum field of input object", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { rootFieldWithInput(arg: {enum: A}) }`,
			})
			assert.Equal(t, `{"data":{"rootFieldWithInput":"A"}}`, res.Body)
		})

		// A quoted String literal inside an input object must still work.
		t.Run("accepts quoted string literal for String field of input object", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { rootFieldWithInput(arg: {string: "hi"}) }`,
			})
			assert.Equal(t, `{"data":{"rootFieldWithInput":"hi"}}`, res.Body)
		})

		// -------------------------------------------------------------------
		// Variables path: JSON variable validation stays *after* extraction and
		// must be unaffected. These already pass today; they guard against a
		// regression where the reordering breaks variable validation.
		// -------------------------------------------------------------------

		t.Run("accepts a valid string variable", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query Q($x: String!) { headerValue(name: $x) }`,
				Variables: json.RawMessage(`{"x":"foo"}`),
			})
			assert.Equal(t, `{"data":{"headerValue":""}}`, res.Body)
		})

		// A type-incorrect *variable value* (not an inline literal) must still
		// produce the variable-scoped error from variable validation.
		t.Run("rejects an invalid string variable with a variable-scoped error", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query Q($x: String!) { headerValue(name: $x) }`,
				Variables: json.RawMessage(`{"x":123}`),
			})
			requireValidationError(t, res.Body, `Variable "$x" got invalid value 123; String cannot represent a non string value: 123`)
		})
	})
}

// TestInlineLiteralValidationWithPersistedOperations guards the persisted-
// operation / APQ path called out in the ticket: validation must still run
// (and reject) when the invalid operation is supplied via APQ registration,
// not just on the normal request path.
func TestInlineLiteralValidationWithPersistedOperations(t *testing.T) {
	t.Parallel()

	const badQuery = `query { headerValue(name: hello) }`

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			// No CDN client for persistent operations; exercise APQ alone.
			core.WithGraphApiToken(""),
		},
		ApqConfig: config.AutomaticPersistedQueriesConfig{
			Enabled: true,
			Cache: config.AutomaticPersistedQueriesCacheConfig{
				Size: 1024 * 1024,
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		sum := sha256.Sum256([]byte(badQuery))
		hash := hex.EncodeToString(sum[:])

		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:      badQuery,
			Extensions: fmt.Appendf(nil, `{"persistedQuery": {"version": 1, "sha256Hash": %q}}`, hash),
		})
		requireValidationError(t, res.Body, `String cannot represent a non string value: hello`)
	})
}

// requireValidationError asserts the GraphQL response body carries exactly one
// error with the given message and no data payload.
//
// It decodes the body instead of asserting the full raw string because
// operation-validation errors also carry source "locations" whose line/column
// depend on the operation text; the message is the stable behavioural contract
// this test pins. Once the fix lands and the exact locations are observable,
// these can be tightened to full-body assertions if desired.
func requireValidationError(t *testing.T, body, wantMessage string) {
	t.Helper()

	var resp struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	require.NoErrorf(t, json.Unmarshal([]byte(body), &resp), "invalid JSON body: %s", body)
	require.Lenf(t, resp.Errors, 1, "expected exactly one error, got body: %s", body)
	assert.Equal(t, wantMessage, resp.Errors[0].Message)
	require.Truef(t, len(resp.Data) == 0 || string(resp.Data) == "null",
		"expected no data payload, got body: %s", body)
}
