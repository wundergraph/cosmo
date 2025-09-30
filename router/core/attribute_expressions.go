package core

import (
	"context"
	"fmt"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"reflect"

	"github.com/expr-lang/expr/ast"
	"github.com/expr-lang/expr/vm"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.opentelemetry.io/otel/attribute"
)

type ProgramWithKey struct {
	Program *vm.Program
	Key     string
}

// attributeExpressions maps context attributes to custom attributes.
type attributeExpressions struct {
	expressions map[expr.AttributeBucket][]ProgramWithKey
}

type VisitorCheckForRequestAuthAccess struct {
	HasAuth bool
}

func (v *VisitorCheckForRequestAuthAccess) Visit(node *ast.Node) {
	if node == nil {
		return
	}

	if v.HasAuth {
		return
	}

	switch n := (*node).(type) {
	case *ast.MemberNode:
		property, propertyOk := n.Property.(*ast.StringNode)
		node, nodeOk := n.Node.(*ast.IdentifierNode)
		if propertyOk && nodeOk {
			if node.Value == expr.ExprRequestKey && property.Value == expr.ExprRequestAuthKey {
				v.HasAuth = true
			}
		}
	}
}

func newAttributeExpressions(attr []config.CustomAttribute, exprManager *expr.Manager) (*attributeExpressions, error) {
	attrs := make(map[expr.AttributeBucket][]ProgramWithKey)

	for _, a := range attr {
		if a.ValueFrom != nil && a.ValueFrom.Expression != "" {
			bucket := expr.RequestOperationBucketVisitor{}

			prog, err := exprManager.CompileExpression(a.ValueFrom.Expression, reflect.String, &bucket)
			if err != nil {
				return nil, fmt.Errorf("custom attribute error, unable to compile '%s' with expression '%s': %s", a.Key, a.ValueFrom.Expression, err)
			}

			attrs[bucket.Bucket] = append(attrs[bucket.Bucket], ProgramWithKey{
				Program: prog,
				Key:     a.Key,
			})
		}
	}

	return &attributeExpressions{
		expressions: attrs,
	}, nil
}

func (r *attributeExpressions) expressionsAttributes(exprCtx *expr.Context, key expr.AttributeBucket) ([]attribute.KeyValue, error) {
	if exprCtx == nil {
		return nil, nil
	}

	programWrappers, ok := r.expressions[key]
	if !ok {
		return nil, nil
	}

	var result []attribute.KeyValue
	for _, wrapper := range programWrappers {
		val, err := expr.ResolveStringExpression(wrapper.Program, *exprCtx)
		if err != nil {
			return nil, err
		}
		result = append(result, attribute.String(wrapper.Key, val))
	}

	return result, nil
}

type AddExprOpts struct {
	logger      *zap.Logger
	expressions *attributeExpressions
	key         expr.AttributeBucket
	currSpan    trace.Span
	exprCtx     *expr.Context
	attrAddFunc func(vals ...attribute.KeyValue)
}

func setTelemetryAttributes(ctx context.Context, requestContext *requestContext, key expr.AttributeBucket) {
	currSpan := trace.SpanFromContext(ctx)
	addExpressions(AddExprOpts{
		logger:      requestContext.logger,
		expressions: requestContext.telemetry.telemetryAttributeExpressions,
		key:         key,
		currSpan:    currSpan,
		exprCtx:     &requestContext.expressionContext,
		attrAddFunc: requestContext.telemetry.addCommonAttribute,
	})

	addExpressions(AddExprOpts{
		logger:      requestContext.logger,
		expressions: requestContext.telemetry.metricAttributeExpressions,
		key:         key,
		exprCtx:     &requestContext.expressionContext,
		attrAddFunc: requestContext.telemetry.addMetricAttribute,
	})

	addExpressions(AddExprOpts{
		logger:      requestContext.logger,
		expressions: requestContext.telemetry.tracingAttributeExpressions,
		key:         key,
		currSpan:    currSpan,
		exprCtx:     &requestContext.expressionContext,
		attrAddFunc: requestContext.telemetry.addCommonTraceAttribute,
	})
}

func addExpressions(opts AddExprOpts) {
	if opts.expressions == nil {
		return
	}

	attributesForKey, err := opts.expressions.expressionsAttributes(opts.exprCtx, opts.key)
	if err != nil {
		opts.logger.Error("failed to resolve trace attribute", zap.Error(err))
		return
	}

	opts.attrAddFunc(attributesForKey...)
	if opts.currSpan != nil {
		opts.currSpan.SetAttributes(attributesForKey...)
	}
}
