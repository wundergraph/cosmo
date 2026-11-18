// This binary exercises execution-config notifications using the real router CLI.
package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"strconv"
	"sync/atomic"

	routercmd "github.com/wundergraph/cosmo/router/cmd"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"go.uber.org/zap"
)

type schemaMetadata struct {
	subgraph   routerconfig.Subgraph
	role       string
	version    string
	hash       string
	clientHash string
	updates    uint64
}

type policyModule struct {
	logger  *zap.Logger
	current atomic.Pointer[schemaMetadata]
	updates atomic.Uint64
}

func (m *policyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{ID: "schemaPolicy", New: func() core.Module { return &policyModule{} }}
}

func (m *policyModule) Provision(ctx *core.ModuleContext) error {
	m.logger = ctx.Logger
	return nil
}

func (m *policyModule) OnExecutionConfigChange(ctx context.Context, cfg routerconfig.ExecutionConfig) {
	schema, report := astparser.ParseGraphqlDocumentString(cfg.Schema())
	if report.HasErrors() {
		m.logger.Error("Cannot build policy metadata", zap.Error(&report))
		return
	}
	query, ok := schema.Index.FirstNodeByNameStr("Query")
	if !ok {
		return
	}
	field, ok := schema.NodeFieldDefinitionByName(query, []byte("hello"))
	if !ok {
		return
	}
	directive, ok := schema.FieldDefinitionDirectiveByName(field, []byte("modulePolicy"))
	if !ok {
		m.logger.Error("Composed SDL has no policy on Query.hello")
		return
	}
	role, ok := schema.DirectiveArgumentValueByName(directive, []byte("role"))
	if !ok {
		return
	}
	subgraphs := cfg.Subgraphs()
	if len(subgraphs) != 1 {
		m.logger.Error("Expected one fixture subgraph", zap.Int("count", len(subgraphs)))
		return
	}
	m.current.Store(&schemaMetadata{
		subgraph:   subgraphs[0],
		role:       schema.ValueContentString(role),
		version:    cfg.Version(),
		hash:       fmt.Sprintf("%x", sha256.Sum256([]byte(cfg.Schema()))),
		clientHash: fmt.Sprintf("%x", sha256.Sum256([]byte(cfg.ClientSchema()))),
		updates:    m.updates.Add(1),
	})
}

func (m *policyModule) Middleware(ctx core.RequestContext, next http.Handler) {
	if snapshot := m.current.Load(); snapshot != nil {
		ctx.ResponseWriter().Header().Set("X-Subgraph-ID", snapshot.subgraph.ID)
		ctx.ResponseWriter().Header().Set("X-Subgraph-Name", snapshot.subgraph.Name)
		ctx.ResponseWriter().Header().Set("X-Subgraph-URL", snapshot.subgraph.RoutingURL)
		ctx.ResponseWriter().Header().Set("X-Schema-Role", snapshot.role)
		ctx.ResponseWriter().Header().Set("X-Schema-Version", snapshot.version)
		ctx.ResponseWriter().Header().Set("X-Schema-Hash", snapshot.hash)
		ctx.ResponseWriter().Header().Set("X-Client-Schema-Hash", snapshot.clientHash)
		ctx.ResponseWriter().Header().Set("X-Schema-Updates", strconv.FormatUint(snapshot.updates, 10))
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

var (
	_ core.Provisioner                          = (*policyModule)(nil)
	_ core.RouterMiddlewareHandler              = (*policyModule)(nil)
	_ core.RouterOnExecutionConfigChangeHandler = (*policyModule)(nil)
)

func main() {
	core.RegisterModule(&policyModule{})
	routercmd.Main()
}
