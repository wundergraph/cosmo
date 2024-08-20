package core

import (
	"errors"
	"github.com/stretchr/testify/assert"
	"io"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestNoError(t *testing.T) {

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/graphql", nil)

	requestContext := &requestContext{
		logger:         zap.NewNop(),
		keys:           map[string]any{},
		responseWriter: rr,
		request:        req,
		operation:      nil,
	}

	WriteResponseError(requestContext, nil)

	body, err := io.ReadAll(rr.Result().Body)
	require.NoError(t, err)

	require.Equal(t, `{"errors":[{"message":"Internal Error"}],"data":null}`, string(body))
}

func TestSingleError(t *testing.T) {

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/graphql", nil)

	requestContext := &requestContext{
		logger:         zap.NewNop(),
		keys:           map[string]any{},
		responseWriter: rr,
		request:        req,
		operation:      nil,
	}

	WriteResponseError(requestContext, errors.New("test"))

	body, err := io.ReadAll(rr.Result().Body)
	require.NoError(t, err)

	require.Equal(t, `{"errors":[{"message":"test"}],"data":null}`, string(body))
}

func TestSortingModulesByPriority(t *testing.T) {

	modulesW := []ModuleInfo{
		{
			ID: "module1_0",
			New: func() Module {
				return nil
			},
		},
		{
			ID: "module2_0",
			New: func() Module {
				return nil
			},
		},
	}

	modulesX := []ModuleInfo{
		{
			ID:       "module1_1",
			Priority: 1,
			New: func() Module {
				return nil
			},
		},
		{
			ID:       "module2_2",
			Priority: 2,
			New: func() Module {
				return nil
			},
		},
	}

	modulesY := []ModuleInfo{
		{
			ID:       "module1_2",
			Priority: 2,
			New: func() Module {
				return nil
			},
		},
		{
			ID:       "module2_1",
			Priority: 1,
			New: func() Module {
				return nil
			},
		},
	}

	modulesZ := []ModuleInfo{
		{
			ID: "module1_0",
			New: func() Module {
				return nil
			},
		},
		{
			ID:       "module2_2",
			Priority: 2,
			New: func() Module {
				return nil
			},
		},
	}

	sortedModulesW := sortModules(modulesW)
	assert.Equal(t, 2, len(sortedModulesW))

	sortedModulesX := sortModules(modulesX)
	assert.Equal(t, ModuleID("module1_1"), sortedModulesX[0].ID)
	assert.Equal(t, 1, sortedModulesX[0].Priority)
	assert.Equal(t, ModuleID("module2_2"), sortedModulesX[1].ID)
	assert.Equal(t, 2, sortedModulesX[1].Priority)

	sortedModulesY := sortModules(modulesY)
	assert.Equal(t, ModuleID("module2_1"), sortedModulesY[0].ID)
	assert.Equal(t, 1, sortedModulesY[0].Priority)
	assert.Equal(t, ModuleID("module1_2"), sortedModulesY[1].ID)
	assert.Equal(t, 2, sortedModulesY[1].Priority)

	sortedModulesZ := sortModules(modulesZ)
	assert.Equal(t, ModuleID("module2_2"), sortedModulesZ[0].ID)
	assert.Equal(t, 2, sortedModulesZ[0].Priority)
	assert.Equal(t, ModuleID("module1_0"), sortedModulesZ[1].ID)
	assert.Equal(t, 0, sortedModulesZ[1].Priority)
}
