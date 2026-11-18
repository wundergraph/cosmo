// This router renders translated string fields using rules from composed SDL.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"

	routercmd "github.com/wundergraph/cosmo/router/cmd"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type coordinate struct{ parent, field string }
type translation struct{ from, to string }
type rules map[coordinate]translation

func (r rules) RenderFieldValue(_ *resolve.Context, value resolve.FieldValue, out io.Writer) error {
	rule, ok := r[coordinate{value.ParentType, value.Name}]
	if ok && value.Type == "String" && string(value.ParsedData.GetStringBytes()) == rule.from {
		data, err := json.Marshal(rule.to)
		if err != nil {
			return err
		}
		_, err = out.Write(data)
		return err
	}
	_, err := out.Write(value.Data)
	return err
}

// snapshot includes diagnostics for the test alongside the module's translation rules.
type snapshot struct {
	rules  rules
	header string
}

func readSnapshot(cfg routerconfig.ExecutionConfig, updates uint64) snapshot {
	doc, report := astparser.ParseGraphqlDocumentString(cfg.Schema())
	if report.HasErrors() {
		panic(report.Error())
	}
	translations := make(rules)
	for _, parent := range doc.RootNodes {
		for _, field := range doc.NodeFieldDefinitions(parent) {
			directive, ok := doc.FieldDefinitionDirectiveByName(field, []byte("translate"))
			if !ok {
				continue
			}
			from, hasFrom := doc.DirectiveArgumentValueByName(directive, []byte("from"))
			to, hasTo := doc.DirectiveArgumentValueByName(directive, []byte("to"))
			if !hasFrom || !hasTo {
				panic("composed @translate is missing a required argument")
			}
			key := coordinate{doc.NodeNameString(parent), doc.FieldDefinitionNameString(field)}
			translations[key] = translation{doc.ValueContentString(from), doc.ValueContentString(to)}
		}
	}
	data, err := json.Marshal(map[string]any{
		"version": cfg.Version(), "updates": updates, "subgraphs": cfg.Subgraphs(),
		"schema":       fmt.Sprintf("%x", sha256.Sum256([]byte(cfg.Schema()))),
		"clientSchema": fmt.Sprintf("%x", sha256.Sum256([]byte(cfg.ClientSchema()))),
	})
	if err != nil {
		panic(err)
	}
	return snapshot{rules: translations, header: string(data)}
}

type translator struct {
	current atomic.Pointer[map[string]snapshot]
	updates atomic.Uint64
}

func (*translator) Module() core.ModuleInfo {
	return core.ModuleInfo{ID: "translator", New: func() core.Module { return &translator{} }}
}

func (m *translator) OnConfigChange(_ context.Context, cfg core.ModuleConfig) {
	updates := m.updates.Add(1)
	graphs := map[string]snapshot{"": readSnapshot(cfg.ExecutionConfig(), updates)}
	for _, flag := range []string{"german", "french"} {
		if graph, ok := cfg.FeatureFlagConfig(flag); ok {
			graphs[flag] = readSnapshot(graph, updates)
		}
	}
	m.current.Store(&graphs)
}

func (m *translator) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	if graphs := m.current.Load(); graphs != nil {
		// The router echoes the selected flag in the response header.
		headers := ctx.ResponseWriter().Header()
		if selected, ok := (*graphs)[headers.Get("X-Feature-Flag")]; ok {
			ctx.SetCustomFieldValueRenderer(selected.rules)
			headers.Set("X-Execution-Config", selected.header)
		}
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

var (
	_ core.ConfigHandler          = (*translator)(nil)
	_ core.RouterOnRequestHandler = (*translator)(nil)
)

func main() {
	core.RegisterModule(&translator{})
	routercmd.Main()
}
