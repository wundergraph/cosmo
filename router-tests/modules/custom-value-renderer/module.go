package custom_value_renderer

import (
	"fmt"
	"io"
	"net/http"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

const myModuleID = "routerCustomValueRenderer"

type RouterCustomValueRendererModule struct {
	Logger *zap.Logger
}

func (m *RouterCustomValueRendererModule) Provision(ctx *core.ModuleContext) error {
	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger
	return nil
}

type CustomTestValueRenderer struct {
}

func (c *CustomTestValueRenderer) RenderFieldValue(ctx *resolve.Context, value resolve.FieldValue, out io.Writer) (err error) {
	switch value.Type {
	case "String":
		_, err = out.Write([]byte(`"xxx"`))
	case "Int", "Float":
		_, err = out.Write([]byte(`123`))
	}

	if value.IsEnum {
		data := value.ParsedData.GetStringBytes()
		_, err = out.Write([]byte(fmt.Sprintf(`"Mood-%s"`, data)))
	}

	return err
}

func (m *RouterCustomValueRendererModule) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	if ctx.Request().Header.Get("X-Custom-Value-Renderer") != "" {
		ctx.SetCustomFieldValueRenderer(&CustomTestValueRenderer{})
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *RouterCustomValueRendererModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: myModuleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &RouterCustomValueRendererModule{}
		},
	}
}

// Interface guard
var (
	_ core.RouterOnRequestHandler = (*RouterCustomValueRendererModule)(nil)
	_ core.Provisioner            = (*RouterCustomValueRendererModule)(nil)
)
