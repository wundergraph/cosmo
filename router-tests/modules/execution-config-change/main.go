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
type rules map[coordinate]string

func translate(text, language string) (string, error) {
	if text != "hello world" {
		return "", fmt.Errorf("unsupported translation text %q", text)
	}
	switch language {
	case "es":
		return "Hola mundo", nil
	case "de":
		return "Hallo Welt", nil
	case "fr":
		return "Bonjour le monde", nil
	case "it":
		return "Ciao mondo", nil
	default:
		return "", fmt.Errorf("unsupported translation language %q", language)
	}
}

func (r rules) RenderFieldValue(_ *resolve.Context, value resolve.FieldValue, out io.Writer) error {
	language, ok := r[coordinate{value.ParentType, value.Name}]
	if !ok {
		_, err := out.Write(value.Data)
		return err
	}
	if value.Type != "String" {
		return fmt.Errorf("@translate requires a String field, got %s.%s of type %s", value.ParentType, value.Name, value.Type)
	}
	translated, err := translate(string(value.ParsedData.GetStringBytes()), language)
	if err != nil {
		return err
	}
	data, err := json.Marshal(translated)
	if err != nil {
		return err
	}
	_, err = out.Write(data)
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
			language, ok := doc.DirectiveArgumentValueByName(directive, []byte("language"))
			if !ok {
				panic("composed @translate is missing its required language")
			}
			key := coordinate{doc.NodeNameString(parent), doc.FieldDefinitionNameString(field)}
			translations[key] = doc.ValueContentString(language)
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
