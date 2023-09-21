//go:generate ./generate.sh

package composition

import (
	"embed"

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

// content holds our static web server content.
//
//go:embed node_modules/*
var content embed.FS

func Federate(subgraphs ...Subgraph) (*FederatedGraph, error) {
	const (
		subgraphsVariableName = "__subgraphs"
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

	runtime.Set(subgraphsVariableName, subgraphs)

	result, err := runtime.RunString(`require("__composition").federateSubgraphs(` + subgraphsVariableName + `)`)

	if err != nil {
		return nil, err
	}

	var federated FederatedGraph
	if err := runtime.ExportTo(result, &federated); err != nil {
		return nil, err
	}
	return &federated, nil
}
