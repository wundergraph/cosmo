package core

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/buger/jsonparser"
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/internal/pool"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

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
			_, err := parser.ParseReader(context.Background(), clientInfo, strings.NewReader(tc.Input), log)
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
