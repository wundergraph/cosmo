package core

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func TestOperationProcessorPersistentOperations(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		RouterSchema:    nil,
		Resolver:        nil,
		RenameTypeNames: nil,
	}
	parser := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        4,
	})
	clientInfo := &ClientInfo{
		Name:    "test",
		Version: "1.0.0",
	}
	testCases := []struct {
		ExpectedType  string
		ExpectedError error
		Input         string
		Variables     string
	}{
		/**
		 * Test cases persist operation
		 */
		{
			Input:         `{"operationName": "test", "variables": {"foo": "bar"}, "extensions": {"persistedQuery": {"version": 1, "sha256Hash": "does-not-exist"}}}`,
			Variables:     `{"foo": "bar"}`,
			ExpectedError: errors.New("could not resolve persisted query, feature is not configured"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.Input, func(t *testing.T) {
			kit, err := parser.NewKitFromReader(strings.NewReader(tc.Input))
			require.NoError(t, err)
			defer kit.Free()

			err = kit.UnmarshalOperation()
			require.NoError(t, err)

			_, err = kit.FetchPersistedOperation(context.Background(), clientInfo, nil)

			if err != nil {
				require.EqualError(t, tc.ExpectedError, err.Error())
			} else if kit.parsedOperation != nil {
				require.Equal(t, tc.ExpectedType, kit.parsedOperation.Type)
				require.JSONEq(t, tc.Variables, string(kit.parsedOperation.Request.Variables))
				require.Equal(t, uint64(0), kit.parsedOperation.ID)
				require.Equal(t, "", kit.parsedOperation.NormalizedRepresentation)
			}
		})
	}
}

func TestOperationProcessor(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		RouterSchema:    nil,
		Resolver:        nil,
		RenameTypeNames: nil,
	}
	parser := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        4,
	})
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
			Input:         `{"query":"query { initialPayload(repeat:3) }", "variables": {"foo": "bar"}}`,
			ExpectedType:  "query",
			Variables:     `{"foo": "bar"}`,
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
			Input:         `{"query":"query { initialPayload(repeat:3) }", "variables": {"foo": {"bar": "baz"}}}`,
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
			kit, err := parser.NewKitFromReader(strings.NewReader(tc.Input))
			require.NoError(t, err)
			defer kit.Free()

			err = kit.UnmarshalOperation()
			require.NoError(t, err)

			err = kit.Parse()

			if err != nil {
				require.EqualError(t, tc.ExpectedError, err.Error())
			} else if kit.parsedOperation != nil {
				require.Equal(t, tc.ExpectedType, kit.parsedOperation.Type)
				require.JSONEq(t, tc.Variables, string(kit.parsedOperation.Request.Variables))
				require.Equal(t, uint64(0), kit.parsedOperation.ID)
				require.Equal(t, "", kit.parsedOperation.NormalizedRepresentation)
			}
		})
	}
}

func TestOperationProcessorUnmarshalExtensions(t *testing.T) {
	executor := &Executor{
		PlanConfig:      plan.Configuration{},
		RouterSchema:    nil,
		Resolver:        nil,
		RenameTypeNames: nil,
	}
	parser := NewOperationProcessor(OperationProcessorOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: 10 << 20,
		ParseKitPoolSize:        4,
	})
	testCases := []struct {
		Input string
		Valid bool
	}{
		{
			Input: `{"query":"subscription { initialPayload(repeat:3) }","extensions":"this_is_not_valid"}`,
		},
		{
			Input: `{"query":"subscription { initialPayload(repeat:3) }","extensions":42}`,
		},
		{
			Input: `{"query":"subscription { initialPayload(repeat:3) }","extensions":true}`,
		},
		{
			Input: `{"query":"subscription { initialPayload(repeat:3) }","extensions":{"foo":bar}}`,
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
			kit, err := parser.NewKitFromReader(strings.NewReader(tc.Input))
			require.NoError(t, err)
			defer kit.Free()

			err = kit.UnmarshalOperation()

			isInputError := errors.As(err, &inputError)
			if tc.Valid {
				assert.False(t, isInputError, "expected invalid extensions to not return an input error, got %s", err)
			} else {
				assert.True(t, isInputError, "expected invalid extensions to return an input error, got %s", err)
			}
		})
	}
}
