package sha256_verifier

import (
	"net/http"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "sha256VerifierModule"

// ResultContainer holds the SHA256 result, shared across module instances
type ResultContainer struct {
	Sha256Result string
}

// Sha256VerifierModule is a simple module that has access to the GraphQL operation and adds custom scopes to the response
type Sha256VerifierModule struct {
	ForceSha256     bool
	ResultContainer *ResultContainer
}

func (m *Sha256VerifierModule) Middleware(ctx core.RequestContext, next http.Handler) {
	m.ResultContainer.Sha256Result = ctx.Operation().Sha256Hash()
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *Sha256VerifierModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	if m.ForceSha256 {
		ctx.SetForceSha256Compute()
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *Sha256VerifierModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &Sha256VerifierModule{}
		},
	}
}

// Interface guard
var (
	_ core.RouterMiddlewareHandler = (*Sha256VerifierModule)(nil)
	_ core.RouterOnRequestHandler  = (*Sha256VerifierModule)(nil)
)
