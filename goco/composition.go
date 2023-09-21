//go:generate ./generate.sh

package composition

import (
	"embed"
	"errors"
	"fmt"
	"sync"

	"github.com/dop251/goja"
	"github.com/dop251/goja/parser"
	"github.com/dop251/goja_nodejs/console"
	"github.com/dop251/goja_nodejs/require"
)

type Subgraph struct {
	Name   string `goja:"name"`
	URL    string `goja:"url"`
	Schema string `goja:"schema"`
}

type ArgumentConfiguration struct {
	ArgumentNames []string `goja:"argumentNames"`
	FieldName     string   `goja:"fieldName"`
	TypeName      string   `goja:"typeName"`
}

type FederatedGraph struct {
	ArgumentConfigurations []ArgumentConfiguration `goja:"argumentConfigurations"`
	AST                    string                  `goja:"ast"`
	Schema                 string                  `goja:"schema"`
}

type vm struct {
	runtime           *goja.Runtime
	federateSubgraphs goja.Callable
}

// content holds our static web server content.
//
//go:embed node_modules/*
var content embed.FS

func preparedVm() (*vm, error) {
	const (
		moduleName     = "__composition"
		moduleVariable = moduleName
	)
	registry := require.NewRegistryWithLoader(func(path string) ([]byte, error) {
		data, err := content.ReadFile(path)
		if err != nil {
			return nil, require.ModuleFileDoesNotExistError
		}
		return data, nil
	})

	runtime := goja.New()
	runtime.SetFieldNameMapper(goja.TagFieldNameMapper("goja", true))
	runtime.SetParserOptions(parser.WithDisableSourceMaps)
	_ = registry.Enable(runtime)
	console.Enable(runtime)
	if _, err := runtime.RunString(`var ` + moduleVariable + ` = require("` + moduleName + `")`); err != nil {
		return nil, err
	}
	module := runtime.Get(moduleVariable).ToObject(runtime)
	if module == nil {
		return nil, errors.New("could not retrieve implementation module")
	}
	moduleFunc := func(name string) (goja.Callable, error) {
		fn, ok := goja.AssertFunction(module.Get(name))
		if !ok {
			return nil, fmt.Errorf("could not get module function %s()", name)
		}
		return fn, nil

	}
	federateSubgraphs, err := moduleFunc("federateSubgraphs")
	if err != nil {
		return nil, err
	}
	return &vm{
		runtime:           runtime,
		federateSubgraphs: federateSubgraphs,
	}, nil
}

var (
	pool sync.Pool
)

func Federate(subgraphs ...Subgraph) (*FederatedGraph, error) {
	vm, _ := pool.Get().(*vm)
	if vm == nil {
		var err error
		vm, err = preparedVm()
		if err != nil {
			return nil, err
		}
	}
	defer pool.Put(vm)
	result, err := vm.federateSubgraphs(goja.Undefined(), vm.runtime.ToValue(subgraphs))
	if err != nil {
		return nil, err
	}

	var federated FederatedGraph
	if err := vm.runtime.ExportTo(result, &federated); err != nil {
		return nil, err
	}
	return &federated, nil
}
