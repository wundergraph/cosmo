//go:build !wg_composition_v8

package composition

import (
	"errors"
	"fmt"

	"github.com/dop251/goja"
	"github.com/dop251/goja/parser"
)

type gojaVm struct {
	runtime                  *goja.Runtime
	federateSubgraphs        goja.Callable
	buildRouterConfiguration goja.Callable
}

func (m *gojaVm) Dispose() {}

func (m *gojaVm) FederateSubgraphs(subgraphs []*Subgraph) (*FederatedGraph, error) {
	result, err := m.federateSubgraphs(goja.Undefined(), m.runtime.ToValue(subgraphs))
	if err != nil {
		return nil, err
	}

	var federated FederatedGraph
	if err := m.runtime.ExportTo(result, &federated); err != nil {
		return nil, err
	}
	return &federated, nil
}

func (m *gojaVm) BuildRouterConfiguration(subgraphs []*Subgraph) (string, error) {
	result, err := m.buildRouterConfiguration(goja.Undefined(), m.runtime.ToValue(subgraphs))
	if err != nil {
		return "", err
	}
	return result.String(), nil
}

func newVM() (*gojaVm, error) {
	runtime := goja.New()
	runtime.SetFieldNameMapper(goja.TagFieldNameMapper("goja", true))
	runtime.SetParserOptions(parser.WithDisableSourceMaps)
	if _, err := runtime.RunString(jsPrelude); err != nil {
		return nil, fmt.Errorf("error running prelude: %w", err)
	}
	if _, err := runtime.RunString(indexJs); err != nil {
		return nil, fmt.Errorf("could not load shim: %w", err)
	}
	shimValue := runtime.Get("shim")
	if shimValue == nil {
		return nil, errors.New("could not retrieve shim")
	}
	shimObject := shimValue.ToObject(runtime)
	shimFunc := func(name string) (goja.Callable, error) {
		fn, ok := goja.AssertFunction(shimObject.Get(name))
		if !ok {
			return nil, fmt.Errorf("could not get shim function %s()", name)
		}
		return fn, nil

	}
	federateSubgraphs, err := shimFunc("federateSubgraphs")
	if err != nil {
		return nil, err
	}
	buildRouterConfiguration, err := shimFunc("buildRouterConfiguration")
	if err != nil {
		return nil, err
	}
	if err := runtime.Set("stringHash", stringHash); err != nil {
		return nil, err
	}
	if err := runtime.Set("urlParse", urlParse); err != nil {
		return nil, err
	}
	return &gojaVm{
		runtime:                  runtime,
		federateSubgraphs:        federateSubgraphs,
		buildRouterConfiguration: buildRouterConfiguration,
	}, nil
}

type vm = gojaVm
