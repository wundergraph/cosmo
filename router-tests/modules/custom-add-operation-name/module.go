package module

import (
	"bytes"
	"io"
	"net/http"

	"github.com/wundergraph/astjson"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"go.uber.org/zap"
)

const moduleID = "addOperationNameModule"

type AddOperationNameModule struct {
	Logger *zap.Logger
}

func (m *AddOperationNameModule) Provision(ctx *core.ModuleContext) error {

	// Assign the logger to the module for non-request related logging
	m.Logger = ctx.Logger

	return nil
}

func (m *AddOperationNameModule) OnOriginRequest(request *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	if request.Body == nil {
		return request, nil
	}
	body, err := io.ReadAll(request.Body)
	_ = request.Body.Close()
	if err != nil {
		m.Logger.Error("addOperationNameModule: failed to read origin request body", zap.Error(err))
		return request, nil
	}

	// Best-effort: on any parse failure, forward the original body unchanged.
	if payload, err := astjson.ParseBytes(body); err == nil {
		doc, report := astparser.ParseGraphqlDocumentBytes(payload.GetStringBytes("query"))
		if !report.HasErrors() && len(doc.OperationDefinitions) == 1 {
			if name := doc.Input.ByteSlice(doc.OperationDefinitions[0].Name); len(name) > 0 {
				payload.Set(nil, "operationName", astjson.StringValueBytes(nil, name))
				body = payload.MarshalTo(nil)
			}
		}
	}
	request.Body = io.NopCloser(bytes.NewReader(body))
	request.ContentLength = int64(len(body))
	request.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(body)), nil
	}
	return request, nil
}

func (m *AddOperationNameModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		// This is the ID of your module, it must be unique
		ID: moduleID,
		// The priority of your module, lower numbers are executed first
		Priority: 1,
		New: func() core.Module {
			return &AddOperationNameModule{}
		},
	}
}

// Interface guard
var (
	_ core.EnginePreOriginHandler = (*AddOperationNameModule)(nil)
	_ core.Provisioner            = (*AddOperationNameModule)(nil)
)
