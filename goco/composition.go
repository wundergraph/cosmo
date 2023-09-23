//go:generate ./generate.sh

package composition

import (
	_ "embed"
	"sync"
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
	ArgumentConfigurations []*ArgumentConfiguration `goja:"argumentConfigurations"`
	AST                    string                   `goja:"ast"`
	Schema                 string                   `goja:"schema"`
}

const (
	// This is required because the polyfill for events
	// expects a browser environment and references navigator
	jsPrelude = `var navigator = {
		language: 'EN'
	};`
)

//go:embed index.global.js
var indexJs string

var (
	pool sync.Pool
)

func Federate(subgraphs ...*Subgraph) (*FederatedGraph, error) {
	vm, _ := pool.Get().(*vm)
	if vm == nil {
		var err error
		vm, err = newVM()
		if err != nil {
			return nil, err
		}
	}
	defer pool.Put(vm)
	return vm.FederateSubgraphs(subgraphs)
}
