package core

import (
	"errors"
	"fmt"
	"reflect"

	"github.com/expr-lang/expr/vm"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"go.uber.org/zap"
)

var (
	ErrMutationOperationBlocked     = errors.New("operation type 'mutation' is blocked")
	ErrSubscriptionOperationBlocked = errors.New("operation type 'subscription' is blocked")
	ErrNonPersistedOperationBlocked = errors.New("non-persisted operation is blocked")
)

type OperationBlocker struct {
	blockMutations     BlockMutationOptions
	blockSubscriptions BlockSubscriptionOptions
	blockNonPersisted  BlockNonPersistedOptions
	mutationExpr       *vm.Program
	subscriptionExpr   *vm.Program
	nonPersistedExpr   *vm.Program

	persistedOperationsDisabled bool
	safelistEnabled             bool
	logUnknownOperationsEnabled bool
}

type BlockMutationOptions struct {
	Enabled   bool
	Condition string
}

type BlockSubscriptionOptions struct {
	Enabled   bool
	Condition string
}

type BlockNonPersistedOptions struct {
	Enabled   bool
	Condition string
}

type SafelistPersistedOptions struct {
	Enabled bool
}

type OperationBlockerOptions struct {
	BlockMutations              BlockMutationOptions
	BlockSubscriptions          BlockSubscriptionOptions
	BlockNonPersisted           BlockNonPersistedOptions
	SafelistEnabled             bool
	PersistedOperationsDisabled bool
	LogUnknownOperationsEnabled bool
	exprManager                 *expr.Manager
}

func NewOperationBlocker(opts *OperationBlockerOptions) (*OperationBlocker, error) {
	ob := &OperationBlocker{
		blockMutations:     opts.BlockMutations,
		blockSubscriptions: opts.BlockSubscriptions,
		blockNonPersisted:  opts.BlockNonPersisted,

		persistedOperationsDisabled: opts.PersistedOperationsDisabled,
		safelistEnabled:             opts.SafelistEnabled,
		logUnknownOperationsEnabled: opts.LogUnknownOperationsEnabled,
	}

	if err := ob.compileExpressions(opts.exprManager); err != nil {
		return nil, err
	}

	return ob, nil
}

func (o *OperationBlocker) compileExpressions(exprManager *expr.Manager) error {
	if o.blockMutations.Enabled && o.blockMutations.Condition != "" {

		v, err := exprManager.CompileExpression(o.blockMutations.Condition, reflect.Bool)
		if err != nil {
			return fmt.Errorf("failed to compile mutation expression: %w", err)
		}
		o.mutationExpr = v
	}

	if o.blockSubscriptions.Enabled && o.blockSubscriptions.Condition != "" {
		v, err := exprManager.CompileExpression(o.blockSubscriptions.Condition, reflect.Bool)
		if err != nil {
			return fmt.Errorf("failed to compile subscription expression: %w", err)
		}
		o.subscriptionExpr = v
	}

	if o.blockNonPersisted.Enabled && o.blockNonPersisted.Condition != "" {
		v, err := exprManager.CompileExpression(o.blockNonPersisted.Condition, reflect.Bool)
		if err != nil {
			return fmt.Errorf("failed to compile non-persisted expression: %w", err)
		}
		o.nonPersistedExpr = v
	}

	return nil
}

func (o *OperationBlocker) OperationIsBlocked(requestLogger *zap.Logger, exprContext expr.Context, operation *ParsedOperation) error {

	if !operation.IsPersistedOperation && o.blockNonPersisted.Enabled {

		// Block all non-persisted operations when no expression is provided
		if o.nonPersistedExpr == nil {
			return ErrNonPersistedOperationBlocked
		}

		ok, err := expr.ResolveBoolExpression(o.nonPersistedExpr, exprContext)
		if err != nil {
			requestLogger.Error("failed to resolve non-persisted block expression", zap.Error(err))
			return ErrNonPersistedOperationBlocked
		}

		if ok {
			return ErrNonPersistedOperationBlocked
		}
	}

	switch operation.Type {
	case "mutation":
		if o.blockMutations.Enabled {

			// Block all mutations when no expression is provided
			if o.mutationExpr == nil {
				return ErrMutationOperationBlocked
			}

			ok, err := expr.ResolveBoolExpression(o.mutationExpr, exprContext)
			if err != nil {
				requestLogger.Error("failed to resolve mutation block expression", zap.Error(err))
				return ErrMutationOperationBlocked
			}

			if ok {
				return ErrMutationOperationBlocked
			}
		}
	case "subscription":
		if o.blockSubscriptions.Enabled {

			// Block all subscriptions when no expression is provided
			if o.subscriptionExpr == nil {
				return ErrSubscriptionOperationBlocked
			}

			ok, err := expr.ResolveBoolExpression(o.subscriptionExpr, exprContext)
			if err != nil {
				requestLogger.Error("failed to resolve subscription block expression", zap.Error(err))
				return ErrSubscriptionOperationBlocked
			}

			if ok {
				return ErrSubscriptionOperationBlocked
			}
		}
	}
	return nil
}
