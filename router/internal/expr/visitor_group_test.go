package expr

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestVisitorManager(t *testing.T) {
	t.Parallel()

	t.Run("verify IsResponseBodyUsedInExpressions", func(t *testing.T) {
		t.Parallel()

		testCases := []struct {
			name           string
			expression     string
			expectedResult bool
		}{
			{
				name:           "with response only",
				expression:     "response",
				expectedResult: false,
			},
			{
				name:           "with body - dot chaining",
				expression:     "response.body",
				expectedResult: true,
			},
			{
				name:           "with body - square bracket access",
				expression:     `response["body"]`,
				expectedResult: true,
			},
			{
				name:           "with body.raw - dot chaining",
				expression:     "response.body.raw",
				expectedResult: true,
			},
			{
				name:           "with body.raw - square bracket access",
				expression:     `response["body"]["raw"]`,
				expectedResult: true,
			},
			{
				name:           "with body.raw mixed access",
				expression:     `response["body"].raw`,
				expectedResult: true,
			},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				exprManager := CreateNewExprManager()
				visitorManager := exprManager.VisitorManager

				_, err := exprManager.CompileAnyExpression(tc.expression)
				require.NoError(t, err)

				require.Equal(t, tc.expectedResult, visitorManager.IsResponseBodyUsedInExpressions())
			})
		}
	})

	t.Run("verify IsRequestOperationSha256UsedInExpressions", func(t *testing.T) {
		t.Parallel()

		testCases := []struct {
			name           string
			expression     string
			expectedResult bool
		}{
			{
				name:           "without sha256",
				expression:     "request.operation.hash",
				expectedResult: false,
			},
			{
				name:           "with sha256 dot chaining",
				expression:     "request.operation.sha256Hash",
				expectedResult: true,
			},
			{
				name:           "with sha256 square bracket",
				expression:     `request["operation"]["sha256Hash"]`,
				expectedResult: true,
			},
			{
				name:           "with sha256 mixed access",
				expression:     `request["operation"].sha256Hash`,
				expectedResult: true,
			},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				exprManager := CreateNewExprManager()
				visitorManager := exprManager.VisitorManager

				_, err := exprManager.CompileAnyExpression(tc.expression)
				require.NoError(t, err)

				require.Equal(t, tc.expectedResult, visitorManager.IsRequestOperationSha256UsedInExpressions())
			})
		}
	})

	t.Run("verify IsRequestOperationVariablesUsedInExpressions", func(t *testing.T) {
		t.Parallel()

		testCases := []struct {
			name           string
			expression     string
			expectedResult bool
		}{
			{
				name:           "without variables",
				expression:     "request.operation.name",
				expectedResult: false,
			},
			{
				name:           "variablesRemappingCacheHit is not variables",
				expression:     "request.operation.variablesRemappingCacheHit",
				expectedResult: false,
			},
			{
				name:           "variablesNormalizationCacheHit is not variables",
				expression:     "request.operation.variablesNormalizationCacheHit",
				expectedResult: false,
			},
			{
				name:           "with variables dot chaining",
				expression:     "request.operation.variables",
				expectedResult: true,
			},
			{
				name:           "with variables square bracket",
				expression:     `request["operation"]["variables"]`,
				expectedResult: true,
			},
			{
				name:           "with variables mixed access",
				expression:     `request["operation"].variables`,
				expectedResult: true,
			},
			{
				name:           "with variables in conditional with cache hit",
				expression:     `request.operation.variablesRemappingCacheHit ? "" : request.operation.variables`,
				expectedResult: true,
			},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				exprManager := CreateNewExprManager()
				visitorManager := exprManager.VisitorManager

				_, err := exprManager.CompileAnyExpression(tc.expression)
				require.NoError(t, err)

				require.Equal(t, tc.expectedResult, visitorManager.IsRequestOperationVariablesUsedInExpressions())
			})
		}
	})

	t.Run("verify IsSubgraphResponseBodyUsedInExpressions", func(t *testing.T) {
		t.Parallel()

		testCases := []struct {
			name           string
			expression     string
			expectedResult bool
		}{
			{
				name:           "with subgraph only",
				expression:     "subgraph",
				expectedResult: false,
			},
			{
				name:           "with subgraph.response only",
				expression:     "subgraph.response",
				expectedResult: false,
			},
			{
				name:           "with subgraph.response.body - dot chaining",
				expression:     "subgraph.response.body",
				expectedResult: true,
			},
			{
				name:           "with subgraph.response.body - square bracket access",
				expression:     `subgraph["response"]["body"]`,
				expectedResult: true,
			},
			{
				name:           "with subgraph.response.body.raw - dot chaining",
				expression:     "subgraph.response.body.raw",
				expectedResult: true,
			},
			{
				name:           "with subgraph.response.body.raw - square bracket access",
				expression:     `subgraph["response"]["body"]["raw"]`,
				expectedResult: true,
			},
			{
				name:           "with subgraph.response.body.raw - mixed access",
				expression:     `subgraph["response"].body["raw"]`,
				expectedResult: true,
			},
			{
				name:           "with subgraph.response.header access - does not require body storage",
				expression:     `subgraph.response.header.Get("X-Custom-Header")`,
				expectedResult: false,
			},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				exprManager := CreateNewExprManager()
				visitorManager := exprManager.VisitorManager

				_, err := exprManager.CompileAnyExpression(tc.expression)
				require.NoError(t, err)

				require.Equal(t, tc.expectedResult, visitorManager.IsSubgraphResponseBodyUsedInExpressions())
			})
		}
	})
}
