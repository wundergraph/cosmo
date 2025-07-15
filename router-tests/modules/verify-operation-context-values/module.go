package verify_operation_context_values

import (
	"net/http"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/zap"
)

const myModuleID = "verifyOperationContextValues"

// CapturedOperationValues holds the captured values from operation context
type CapturedOperationValues struct {
	Name      string
	Type      string
	Hash      uint64
	Content   string
	Variables *astjson.Value
	// Store the raw variables as string for easier testing
	VariablesJSON string
	ClientInfo    core.ClientInfo
}

// VerifyOperationContextValuesModule captures operation context values for verification
type VerifyOperationContextValuesModule struct {
	ResultsChan chan CapturedOperationValues
	Logger      *zap.Logger
}

func (m *VerifyOperationContextValuesModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	if m.ResultsChan == nil {
		m.ResultsChan = make(chan CapturedOperationValues, 1)
	}
	return nil
}

func (m *VerifyOperationContextValuesModule) Middleware(ctx core.RequestContext, next http.Handler) {
	operation := ctx.Operation()

	// Capture all the operation context values
	captured := CapturedOperationValues{
		Name:       operation.Name(),
		Type:       operation.Type(),
		Hash:       operation.Hash(),
		Content:    operation.Content(),
		Variables:  operation.Variables(),
		ClientInfo: operation.ClientInfo(),
	}

	// Convert variables to JSON string for easier testing
        captured.VariablesJSON = "{}"
	if captured.Variables != nil {
		variablesBytes := captured.Variables.MarshalTo(nil)
		captured.VariablesJSON = string(variablesBytes)
	} 
	// Send the captured values to the test
	select {
	case m.ResultsChan <- captured:
	default:
		// Channel is full, skip
	}

	// Call the next handler in the chain
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *VerifyOperationContextValuesModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &VerifyOperationContextValuesModule{
				ResultsChan: make(chan CapturedOperationValues, 1),
			}
		},
	}
}

// Interface guard
var (
	_ core.RouterMiddlewareHandler = (*VerifyOperationContextValuesModule)(nil)
)
