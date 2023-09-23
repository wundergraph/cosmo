//go:build v8

package composition

import (
	"fmt"
	"os"

	v8 "rogchap.com/v8go"
)

func deserializeArray[T any](arrayObject *v8.Object, elementDecoder func(*v8.Object) (T, error)) ([]T, error) {
	lengthValue, err := arrayObject.Get("length")
	if err != nil {
		return nil, err
	}
	length := lengthValue.Integer()
	result := make([]T, length)
	for ii := 0; ii < int(length); ii++ {
		elementValue, err := arrayObject.GetIdx(uint32(ii))
		if err != nil {
			return nil, err
		}
		elementObject := elementValue.Object()
		element, err := elementDecoder(elementObject)
		if err != nil {
			return nil, err
		}
		result[ii] = element
	}
	return result, nil
}

type v8Vm struct {
	isolate           *v8.Isolate
	ctx               *v8.Context
	null              v8.Valuer
	federateSubgraphs *v8.Function
}

func (m *v8Vm) Dispose() {
	m.isolate.Dispose()
}

func (m *v8Vm) FederateSubgraphs(subgraphs []*Subgraph) (*FederatedGraph, error) {
	tmpl := v8.NewObjectTemplate(m.ctx.Isolate())
	arrayValue, err := m.ctx.RunScript("[]", "array")
	if err != nil {
		return nil, err
	}
	arrayObject := arrayValue.Object()
	arrayObject.Set("length", len(subgraphs))
	for ii := range subgraphs {
		obj, err := tmpl.NewInstance(m.ctx)
		if err != nil {
			return nil, err
		}
		obj.Set("name", subgraphs[ii].Name)
		obj.Set("url", subgraphs[ii].URL)
		obj.Set("schema", subgraphs[ii].Schema)
		arrayObject.SetIdx(uint32(ii), obj)
	}

	result, err := m.federateSubgraphs.Call(m.null, arrayObject)
	if err != nil {
		return nil, err
	}
	resultObject := result.Object()
	argumentConfigurationsValue, err := resultObject.Get("argumentConfigurations")
	if err != nil {
		return nil, err
	}
	argumentConfigurationsObject := argumentConfigurationsValue.Object()
	argumentConfigurations, err := deserializeArray(argumentConfigurationsObject, func(o *v8.Object) (*ArgumentConfiguration, error) {
		argumentNamesValue, err := o.Get("argumentNames")
		if err != nil {
			return nil, err
		}
		argumentNames, err := deserializeArray(argumentNamesValue.Object(), func(o *v8.Object) (string, error) {
			return o.String(), nil
		})
		if err != nil {
			return nil, err
		}
		fieldNameValue, err := o.Get("fieldName")
		if err != nil {
			return nil, err
		}
		typeNameValue, err := o.Get("typeName")
		if err != nil {
			return nil, err
		}
		return &ArgumentConfiguration{
			ArgumentNames: argumentNames,
			FieldName:     fieldNameValue.String(),
			TypeName:      typeNameValue.String(),
		}, nil
	})
	if err != nil {
		return nil, err
	}
	ast, err := resultObject.Get("ast")
	if err != nil {
		return nil, err
	}
	schema, err := resultObject.Get("schema")
	if err != nil {
		return nil, err
	}
	return &FederatedGraph{
		ArgumentConfigurations: argumentConfigurations,
		AST:                    ast.String(),
		Schema:                 schema.String(),
	}, nil
}

func debugErr(err error) error {
	if os.Getenv("DEBUG_V8_ERRORS") != "" {
		if e, ok := err.(*v8.JSError); ok {
			fmt.Fprintln(os.Stderr, e.Message)
			fmt.Fprintln(os.Stderr, e.Location)
			fmt.Fprintln(os.Stderr, e.StackTrace)
		}
	}
	return err
}

func newVM() (*v8Vm, error) {
	isolate := v8.NewIsolate()
	ctx := v8.NewContext(isolate)
	if _, err := ctx.RunScript(jsPrelude, "prelude.js"); err != nil {
		return nil, fmt.Errorf("error running prelude: %w", debugErr(err))
	}
	if _, err := ctx.RunScript(indexJs, "shim.js"); err != nil {
		return nil, fmt.Errorf("error loading shim: %w", debugErr(err))
	}
	shim, err := ctx.Global().Get("shim")
	if err != nil {
		return nil, fmt.Errorf("error retrieving shim: %w", debugErr(err))
	}
	shimFunc := func(name string) (*v8.Function, error) {
		fpv, err := shim.Object().Get(name)
		if err != nil {
			return nil, fmt.Errorf("error retrieving shim function %s: %w", name, debugErr(err))
		}
		fp, err := fpv.AsFunction()
		if err != nil {
			return nil, fmt.Errorf("error converting shim function to JS function %s: %w", name, debugErr(err))
		}
		return fp, nil
	}
	federateSubgraphs, err := shimFunc("federateSubgraphs")
	if err != nil {
		return nil, err
	}

	return &v8Vm{
		isolate:           isolate,
		ctx:               ctx,
		null:              v8.Null(ctx.Isolate()),
		federateSubgraphs: federateSubgraphs,
	}, nil
}

type vm = v8Vm
