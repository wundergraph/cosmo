package verify_cost_analysis

import (
	"net/http"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "verifyCost"

// CapturedCost holds the captured cost from operation context
type CapturedCost struct {
	Cost  core.OperationCost
	Error error
}

// VerifyCostModule captures cost for verification in tests
type VerifyCostModule struct {
	ResultsChan chan CapturedCost
	Logger      *zap.Logger
}

func (m *VerifyCostModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	if m.ResultsChan == nil {
		m.ResultsChan = make(chan CapturedCost, 1)
	}
	return nil
}

func (m *VerifyCostModule) Middleware(ctx core.RequestContext, next http.Handler) {
	operation := ctx.Operation()

	cost, err := operation.Cost()
	captured := CapturedCost{Cost: cost, Error: err}

	// Send the captured values to the test
	select {
	case m.ResultsChan <- captured:
	default:
		// Channel is full, skip
	}

	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *VerifyCostModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &VerifyCostModule{
				ResultsChan: make(chan CapturedCost, 1),
			}
		},
	}
}

var (
	_ core.RouterMiddlewareHandler = (*VerifyCostModule)(nil)
)
