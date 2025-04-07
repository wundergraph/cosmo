package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func TestPlanOperationPanic(t *testing.T) {
	// Create a minimal plan configuration
	planConfig := &plan.Configuration{}

	// Create a planner with minimal configuration
	planner, err := NewPlanner(planConfig, &ast.Document{}, &ast.Document{})
	if err != nil {
		t.Fatalf("Failed to create planner: %v", err)
	}

	// Create an invalid operation document that will cause a panic
	invalidOperation := &ast.Document{
		RootNodes: []ast.Node{
			{
				Kind: ast.NodeKindOperationDefinition,
				Ref:  0,
			},
		},
	}

	assert.NotPanics(t, func() {
		_, err = planner.planOperation(invalidOperation)
		assert.Error(t, err)
	})
}

func TestValidateOperationPanic(t *testing.T) {
	// Create a minimal plan configuration
	planConfig := &plan.Configuration{}

	// Create a planner with minimal configuration
	planner, err := NewPlanner(planConfig, &ast.Document{}, &ast.Document{})
	if err != nil {
		t.Fatalf("Failed to create planner: %v", err)
	}

	// Create an invalid operation document that will cause a panic
	invalidOperation := &ast.Document{
		RootNodes: []ast.Node{
			{
				Kind: ast.NodeKindOperationDefinition,
				Ref:  0,
			},
		},
	}

	// Attempt to validate the operation - this should panic
	assert.NotPanics(t, func() {
		err = planner.validateOperation(invalidOperation)
		assert.Error(t, err)
	})
}
