package core

import (
	"context"
	"errors"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"

	"github.com/buger/jsonparser"
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/internal/pool"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

func TestOperationParser(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		Definition:      nil,
		Resolver:        nil,
		RenameTypeNames: nil,
		Pool:            pool.New(),
	}
	parser := NewOperationParser(OperationParserOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
	})
	clientInfo := &ClientInfo{
		Name:    "test",
		Version: "1.0.0",
	}
	log := zap.NewNop()
	testCases := []struct {
		ExpectedType  string
		ExpectedError error
		Input         string
		Variables     string
	}{
		/**
		 * Test cases parse simple
		 */
		{
			Input:         `{"query":"query { employees { name } }"`,
			ExpectedType:  "query",
			Variables:     `{}`,
			ExpectedError: nil,
		},
		/**
		 * Test cases parse invalid graphql
		 */
		{
			Input:         `{"query":"invalid", "variables": {"foo": "bar"}}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: errors.New("unexpected literal - got: UNDEFINED want one of: [ENUM TYPE UNION QUERY INPUT EXTEND SCHEMA SCALAR FRAGMENT INTERFACE DIRECTIVE]"),
		},
		/**
		 * Test cases parse operation types
		 */
		{
			ExpectedType:  "subscription",
			Input:         `{"query":"subscription { initialPayload(repeat:3) }", "variables": {"foo": "bar"}}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: nil,
		},
		{
			ExpectedType:  "query",
			Input:         `{"query":"query { initialPayload(repeat:3) }", "variables": {"foo": "bar"}}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: nil,
		},
		{
			ExpectedType:  "mutation",
			Input:         `{"query":"mutation { initialPayload(repeat:3) }", "variables": {"foo": "bar"}}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: nil,
		},
		/**
		 * Test cases parse variables
		 */
		{
			ExpectedType:  "query",
			Input:         `{"query":"query { initialPayload(repeat:3) }", "variables": {"foo": ["bar"]}}`,
			Variables:     `{"foo": ["bar"]}`,
			ExpectedError: nil,
		},
		{
			Input:         `{"query":"query { initialPayload(repeat:3) }", "variables": null}`,
			ExpectedType:  "query",
			Variables:     "{}",
			ExpectedError: nil,
		},
		{
			Input:         `{"query":"query { initialPayload(repeat:3) }", "variables": {"foo": {"bar": "baz"}}`,
			ExpectedType:  "query",
			Variables:     `{"foo": {"bar": "baz"}}`,
			ExpectedError: nil,
		},
		{
			Input:         `{"query":"mutation", "variables": {"foo": "bar"}}`,
			ExpectedError: errors.New("unexpected token - got: EOF want one of: [LBRACE]"),
			ExpectedType:  "",
			Variables:     "",
		},
		/**
		 * Test cases parse operation name
		 */
		{
			Input:         `{"query":"subscription { initialPayload(repeat:3) }", "variables": {"foo": "bar"}, "operationName": "test"}`,
			ExpectedError: errors.New("operation with name 'test' not found"),
			ExpectedType:  "",
			Variables:     "",
		},
		{
			ExpectedType:  "subscription",
			Input:         `{"query":"subscription foo { initialPayload(repeat:3) }", "variables": {"foo": "bar"}, "operationName": "foo"}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: nil,
		},
		/**
		 * Test cases parse multiple operations
		 */
		{
			Input:         `{"query":"query { initialPayload(repeat:3) } mutation { initialPayload(repeat:3) }", "variables": {"foo": "bar"}}`,
			ExpectedError: errors.New("operation name is required when multiple operations are defined"),
			ExpectedType:  "",
			Variables:     "",
		},
		{
			ExpectedType:  "query",
			Input:         `{"query":"query test { initialPayload(repeat:3) } mutation { initialPayload(repeat:3) }", "variables": {"foo": "bar"}, "operationName": "test"}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: nil,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.Input, func(t *testing.T) {
			kit, err := parser.NewParseReader(strings.NewReader(tc.Input))
			assert.NoError(t, err)

			err = kit.Parse(context.Background(), clientInfo, log)

			if err != nil {
				require.EqualError(t, tc.ExpectedError, err.Error())
			} else if kit.parsedOperation != nil {
				require.Equal(t, tc.ExpectedType, kit.parsedOperation.Type)
				require.JSONEq(t, tc.Variables, string(kit.parsedOperation.Variables))
				require.Equal(t, uint64(0), kit.parsedOperation.ID)
				require.Equal(t, "", kit.parsedOperation.NormalizedRepresentation)
			}
		})
	}
}

func TestOperationParserExtensions(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		Definition:      nil,
		Resolver:        nil,
		RenameTypeNames: nil,
		Pool:            pool.New(),
	}
	parser := NewOperationParser(OperationParserOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
	})
	clientInfo := &ClientInfo{
		Name:    "test",
		Version: "1.0.0",
	}
	log := zap.NewNop()
	testCases := []struct {
		Input     string
		ValueType jsonparser.ValueType
		Valid     bool
	}{
		{
			Input:     `{"query":"subscription { initialPayload(repeat:3) }","extensions":"this_is_not_valid"}`,
			ValueType: jsonparser.String,
		},
		{
			Input:     `{"query":"subscription { initialPayload(repeat:3) }","extensions":42}`,
			ValueType: jsonparser.Number,
		},
		{
			Input:     `{"query":"subscription { initialPayload(repeat:3) }","extensions":true}`,
			ValueType: jsonparser.Boolean,
		},
		{
			Input: `{"query":"subscription { initialPayload(repeat:3) }","extensions":{}}`,
			Valid: true,
		},
		{
			Input: `{"query":"subscription { initialPayload(repeat:3) }","extensions":null}`,
			Valid: true,
		},
		{
			Input: `{"query":"subscription { initialPayload(repeat:3) }"}`,
			Valid: true,
		},
	}
	var inputError InputError
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.Input, func(t *testing.T) {
			kit, err := parser.NewParseReader(strings.NewReader(tc.Input))
			assert.NoError(t, err)

			err = kit.Parse(context.Background(), clientInfo, log)
			isInputError := errors.As(err, &inputError)
			if tc.Valid {
				assert.False(t, isInputError, "expected invalid extensions to not return an input error, got %s", err)
			} else {
				assert.True(t, isInputError, "expected invalid extensions to return an input error, got %s", err)
				assert.Contains(t, err.Error(), "extensions", "expected error to contain extensions")
				assert.Contains(t, err.Error(), tc.ValueType.String(), "expected error to contain value type name")
			}
		})
	}
}
