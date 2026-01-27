package verify_static_cost

import (
	"net/http"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "verifyStaticCost"

// CapturedStaticCost holds the captured static cost from operation context
type CapturedStaticCost struct {
	Cost  int
	Error error
}

// VerifyStaticCostModule captures static cost for verification in tests
type VerifyStaticCostModule struct {
	ResultsChan chan CapturedStaticCost
	Logger      *zap.Logger
}

func (m *VerifyStaticCostModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	if m.ResultsChan == nil {
		m.ResultsChan = make(chan CapturedStaticCost, 1)
	}
	return nil
}

func (m *VerifyStaticCostModule) Middleware(ctx core.RequestContext, next http.Handler) {
	operation := ctx.Operation()

	cost, err := operation.StaticCost()
	captured := CapturedStaticCost{Cost: cost, Error: err}

	// Send the captured values to the test
	select {
	case m.ResultsChan <- captured:
	default:
		// Channel is full, skip
	}

	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *VerifyStaticCostModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &VerifyStaticCostModule{
				ResultsChan: make(chan CapturedStaticCost, 1),
			}
		},
	}
}

var (
	_ core.RouterMiddlewareHandler = (*VerifyStaticCostModule)(nil)
)
