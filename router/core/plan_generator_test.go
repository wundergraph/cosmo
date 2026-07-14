package core

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
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
		_, _, err = planner.PlanPreparedOperation(invalidOperation)
		assert.Error(t, err)
	})
}

func TestPlanWrapperMarshalDeferResponsePlan(t *testing.T) {
	primary := resolve.Single(&resolve.SingleFetch{
		FetchDependencies: resolve.FetchDependencies{FetchID: 1},
		Info: &resolve.FetchInfo{
			DataSourceID:   "employees",
			DataSourceName: "employees",
		},
	})
	deferred := resolve.Single(&resolve.SingleFetch{
		FetchDependencies: resolve.FetchDependencies{FetchID: 2},
		Info: &resolve.FetchInfo{
			DataSourceID:   "availability",
			DataSourceName: "availability",
		},
	})
	response := &resolve.GraphQLDeferResponse{
		Response: &resolve.GraphQLResponse{Fetches: primary},
		DeferDescriptors: map[int]resolve.DeferDescriptor{
			1: {ID: 1, Label: "Availability", Path: []string{"employees"}},
		},
		DeferTree: resolve.DeferSingle(&resolve.DeferFetchGroup{DeferID: 1, Fetches: deferred}),
	}
	wrapper := &PlanWrapper{Plan: &plan.DeferResponsePlan{Response: response}}

	encoded, err := wrapper.Marshal()
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, json.Unmarshal(encoded, &decoded))
	require.Equal(t, "Sequence", decoded["kind"])
	children := decoded["children"].([]any)
	require.Len(t, children, 2)
	deferNode := children[1].(map[string]any)
	require.Equal(t, map[string]any{
		"id":    float64(1),
		"label": "Availability",
		"path":  []any{"employees"},
	}, deferNode["defer"])
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
