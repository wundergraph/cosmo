//go:build wg_composition_v8

package composition

import (
	"fmt"
	"os"
	"reflect"

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

// serializes an object for v8 using reflect and the goja
// tags for field names
func serializeGojaObject(ctx *v8.Context, v any) (*v8.Value, error) {
	rv := reflect.ValueOf(v)
	for rv.Kind() == reflect.Ptr {
		rv = rv.Elem()
	}
	rt := rv.Type()
	switch rt.Kind() {
	case reflect.Struct:
		tmpl := v8.NewObjectTemplate(ctx.Isolate())
		obj, err := tmpl.NewInstance(ctx)
		if err != nil {
			return nil, err
		}
		for ii := 0; ii < rt.NumField(); ii++ {
			field := rt.Field(ii)
			tag := field.Tag.Get("goja")
			if tag == "" {
				return nil, fmt.Errorf("no goja field tag in field %s", field.Name)
			}
			value := rv.Field(ii).Interface()
			valueObject, err := serializeGojaObject(ctx, value)
			if err != nil {
				return nil, err
			}
			obj.Set(tag, valueObject)
		}
		return obj.Value, nil
	case reflect.String:
		return v8.NewValue(ctx.Isolate(), rv.String())
	default:
		return nil, fmt.Errorf("cannot serialize type kind %s", rt.Kind())
	}
}

type v8Vm struct {
	isolate                  *v8.Isolate
	ctx                      *v8.Context
	null                     v8.Valuer
	federateSubgraphs        *v8.Function
	buildRouterConfiguration *v8.Function
}

func (m *v8Vm) Dispose() {
	m.isolate.Dispose()
}

func (m *v8Vm) subgraphsToJS(subgraphs []*Subgraph) (*v8.Object, error) {
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
	return arrayObject, nil
}

func (m *v8Vm) FederateSubgraphs(subgraphs []*Subgraph) (*FederatedGraph, error) {
	arrayObject, err := m.subgraphsToJS(subgraphs)
	if err != nil {
		return nil, err
	}
	result, err := m.federateSubgraphs.Call(m.null, arrayObject)
	if err != nil {
		return nil, err
	}
	resultObject := result.Object()
	fieldConfigurationsValue, err := resultObject.Get("fieldConfigurations")
	if err != nil {
		return nil, err
	}
	fieldConfigurationsObject := fieldConfigurationsValue.Object()
	fieldConfigurations, err := deserializeArray(fieldConfigurationsObject, func(o *v8.Object) (*FieldConfiguration, error) {
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
		requiresAuthenticationValue, _ := o.Get("requiresAuthentication")
		requiredScopesValue, _ := o.Get("requiredScopes")
		fieldConfiguration := &FieldConfiguration{
			ArgumentNames: argumentNames,
			FieldName:     fieldNameValue.String(),
			TypeName:      typeNameValue.String(),
		}
		if requiresAuthenticationValue.IsBoolean() {
			fieldConfiguration.RequiresAuthentication = requiresAuthenticationValue.Boolean()
		}
		if requiredScopesValue.IsArray() {
			requiredScopes, err := deserializeArray(requiredScopesValue.Object(), func(orScopes *v8.Object) ([]string, error) {
				deserializedAndScopes, err := deserializeArray(orScopes, func(andScopes *v8.Object) (string, error) {
					return andScopes.String(), nil
				})
				if err != nil {
					return nil, err
				}
				return deserializedAndScopes, nil
			})
			if err != nil {
				return nil, err
			}
			fieldConfiguration.RequiredScopes = requiredScopes
		}
		return fieldConfiguration, nil
	})
	if err != nil {
		return nil, err
	}
	sdl, err := resultObject.Get("sdl")
	if err != nil {
		return nil, err
	}
	return &FederatedGraph{
		FieldConfigurations: fieldConfigurations,
		SDL:                 sdl.String(),
	}, nil
}

func (m *v8Vm) BuildRouterConfiguration(subgraphs []*Subgraph) (string, error) {
	arrayObject, err := m.subgraphsToJS(subgraphs)
	if err != nil {
		return "", err
	}
	result, err := m.buildRouterConfiguration.Call(m.null, arrayObject)
	if err != nil {
		return "", err
	}
	return result.String(), nil
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

func v8Exception(isolate *v8.Isolate, err error) {
	exc, err := v8.NewValue(isolate, err.Error())
	if err != nil {
		panic(err)
	}
	isolate.ThrowException(exc)
}

func stringHashV8(info *v8.FunctionCallbackInfo) *v8.Value {
	isolate := info.Context().Isolate()
	input := info.Args()[0].String()
	result, err := stringHash(input)
	if err != nil {
		v8Exception(isolate, err)
		return nil
	}
	resultValue, err := v8.NewValue(isolate, result)
	if err != nil {
		panic(err)
	}
	return resultValue
}

func urlParseV8(info *v8.FunctionCallbackInfo) *v8.Value {
	isolate := info.Context().Isolate()
	args := info.Args()
	url := args[0].String()
	base := args[1].String()

	result, err := urlParse(url, base)
	if err != nil {
		v8Exception(isolate, err)
		return nil
	}
	value, err := serializeGojaObject(info.Context(), result)
	if err != nil {
		panic(err)
	}
	return value
}

func newVM() (*v8Vm, error) {
	isolate := v8.NewIsolate()

	global := v8.NewObjectTemplate(isolate)

	stringHash := v8.NewFunctionTemplate(isolate, stringHashV8)
	if err := global.Set("stringHash", stringHash, v8.ReadOnly); err != nil {
		return nil, err
	}

	urlParse := v8.NewFunctionTemplate(isolate, urlParseV8)
	if err := global.Set("urlParse", urlParse, v8.ReadOnly); err != nil {
		return nil, err
	}

	ctx := v8.NewContext(isolate, global)

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
	buildRouterConfiguration, err := shimFunc("buildRouterConfiguration")
	if err != nil {
		return nil, err
	}

	return &v8Vm{
		isolate:                  isolate,
		ctx:                      ctx,
		null:                     v8.Null(ctx.Isolate()),
		federateSubgraphs:        federateSubgraphs,
		buildRouterConfiguration: buildRouterConfiguration,
	}, nil
}

type vm = v8Vm
