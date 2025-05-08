package expr

import (
	"errors"
	"github.com/expr-lang/expr/ast"
	"github.com/stretchr/testify/require"
	"reflect"
	"testing"
	"time"
)

type VisitorExample struct {
	Uses bool
}

func (v *VisitorExample) Visit(node *ast.Node) {
	if node == nil {
		return
	}

	if v.Uses {
		return
	}

	if _, ok := (*node).(*ast.MemberNode); ok {
		v.Uses = true
	}
}

func TestExprManager(t *testing.T) {
	t.Parallel()

	t.Run("verify compiling any expression", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		expr, err := exprManager.CompileAnyExpression("request.error ?? 'somevalue'")
		require.NoError(t, err)

		context := Context{
			Request: Request{
				Error: nil,
			},
		}

		result, err := ResolveAnyExpression(expr, context)
		if err != nil {
			return
		}
		require.NoError(t, err)
		require.Equal(t, "somevalue", result)
	})

	t.Run("verify compiling expression with type", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		expr, err := exprManager.CompileExpression("request.error == nil", reflect.Bool)
		require.NoError(t, err)

		context := Context{
			Request: Request{
				Error: nil,
			},
		}

		result, err := ResolveBoolExpression(expr, context)
		if err != nil {
			return
		}
		require.NoError(t, err)
		require.True(t, result)
	})

	t.Run("verify compiling expression with type", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		expr, err := exprManager.CompileExpression("request.error == nil", reflect.Bool)
		require.NoError(t, err)

		context := Context{
			Request: Request{
				Error: nil,
			},
		}

		result, err := ResolveBoolExpression(expr, context)
		if err != nil {
			return
		}
		require.NoError(t, err)
		require.True(t, result)
	})

	t.Run("verify compiling an expression", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		_, err := exprManager.CompileAnyExpression("request.error ?? 'somevalue'")
		require.NoError(t, err)
	})

	t.Run("verify compiling expression with custom visitor", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		visitorExample := VisitorExample{}
		require.False(t, visitorExample.Uses)

		expr, err := exprManager.CompileExpression("request.error == nil", reflect.Bool, &visitorExample)
		require.NoError(t, err)

		context := Context{}

		_, err = ResolveBoolExpression(expr, context)
		if err != nil {
			return
		}
		require.NoError(t, err)
		require.True(t, visitorExample.Uses)
	})

	t.Run("verify when body.raw is not accessed", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		_, err := exprManager.CompileAnyExpression("request.error")
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		_, err = exprManager.CompileAnyExpression("request.body")
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		require.False(t, exprManager.VisitorManager.IsBodyUsedInExpressions())
	})

	t.Run("verify when body.raw is accessed", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		_, err := exprManager.CompileAnyExpression("request.error")
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		_, err = exprManager.CompileAnyExpression("request.body.raw")
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		require.True(t, exprManager.VisitorManager.IsBodyUsedInExpressions())
	})

	t.Run("verify when body.raw is called conditionally", func(t *testing.T) {
		t.Parallel()

		exprManager := CreateNewExprManager()

		_, err := exprManager.CompileAnyExpression("request.error ?? request.body.raw")
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		require.True(t, exprManager.VisitorManager.IsBodyUsedInExpressions())
	})

	t.Run("subgraph performance metric examples", func(t *testing.T) {
		t.Parallel()

		t.Run("get dial done errors", func(t *testing.T) {
			exprManager := CreateNewExprManager()

			context := Context{
				Subgraph: Subgraph{
					Id:   "subgraph-id",
					Name: "subgraph-name",
					Request: SubgraphRequest{
						Error: nil,
						ClientTrace: ClientTrace{
							DialStart: []SubgraphDialStart{
								{
									Time:    time.Now(),
									Network: "tcp",
									Address: "localhost:8080",
								},
								{
									Time:    time.Now(),
									Network: "tcp",
									Address: "localhost:8081",
								},
							},
							DialDone: []SubgraphDialDone{
								{
									Time:    time.Now(),
									Network: "tcp",
									Address: "localhost:8080",
									Error:   errors.New("error occurred"),
								},
								{
									Time:    time.Now(),
									Network: "tcp",
									Address: "localhost:8081",
									Error:   nil,
								},
							},
						},
					},
				},
			}

			exprString :=
				`let filtered = filter(subgraph.request.clientTrace.dialDone, #.error != nil);
 				string(map(filtered, #.error))`

			expr, err := exprManager.CompileAnyExpression(exprString)
			require.NoError(t, err)

			result, err := ResolveAnyExpression(expr, context)
			require.NoError(t, err)
			require.Equal(t, "[error occurred]", result)
		})

		t.Run("verify if dial done did not complete for a dial start", func(t *testing.T) {
			exprManager := CreateNewExprManager()

			context := Context{
				Subgraph: Subgraph{
					Id:   "subgraph-id",
					Name: "subgraph-name",
					Request: SubgraphRequest{
						Error: nil,
						ClientTrace: ClientTrace{
							DialStart: []SubgraphDialStart{
								{
									Time:    time.Now(),
									Network: "tcp",
									Address: "localhost:8080",
								},
								{
									Time:    time.Now(),
									Network: "tcp",
									Address: "localhost:8081",
								},
							},
							DialDone: []SubgraphDialDone{
								{
									Time:    time.Now(),
									Network: "tcp",
									Address: "localhost:8081",
									Error:   nil,
								},
							},
						},
					},
				},
			}

			exprString :=
				`string(
					len(subgraph.request.clientTrace.dialStart) > len(subgraph.request.clientTrace.dialDone)
				)`

			expr, err := exprManager.CompileAnyExpression(exprString)
			require.NoError(t, err)

			result, err := ResolveAnyExpression(expr, context)
			require.NoError(t, err)
			require.Equal(t, "true", result)
		})

		t.Run("calculate dial durations", func(t *testing.T) {
			// NOTE: From our testing we noted that the every dial done will have a dial start
			exprManager := CreateNewExprManager()

			context := Context{
				Subgraph: Subgraph{
					Id:   "subgraph-id",
					Name: "subgraph-name",
					Request: SubgraphRequest{
						Error: nil,
						ClientTrace: ClientTrace{
							DialStart: []SubgraphDialStart{
								{
									Time:    time.Now(),
									Network: "tcp",
									Address: "localhost:8080",
								},
								{
									Time:    time.Now(),
									Network: "tcp",
									Address: "localhost:8081",
								},
							},
							DialDone: []SubgraphDialDone{
								{
									Time:    time.Now(),
									Network: "tcp",
									Address: "localhost:8080",
									Error:   errors.New("error occurred"),
								},
								{
									Time:    time.Now(),
									Network: "tcp",
									Address: "localhost:8081",
									Error:   nil,
								},
							},
						},
					},
				},
			}

			// Note that
			exprString :=
				`let groupedDials = subgraph.request.clientTrace.GetGroupedDials();
				 let dialDurations = map(groupedDials, #.doneTime - #.startTime);
     			 dialDurations`

			expr, err := exprManager.CompileAnyExpression(exprString)
			require.NoError(t, err)

			result, err := ResolveAnyExpression(expr, context)
			require.NoError(t, err)

			casted := result.([]interface{})
			require.Equal(t, 2, len(casted))
			require.Greater(t, casted[0].(time.Duration), time.Duration(0))
			require.Greater(t, casted[1].(time.Duration), time.Duration(0))
		})

	})

}
