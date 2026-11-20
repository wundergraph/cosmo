package restsource

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/bufbuild/protocompile"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

const protoFileName = "service.proto"

// spec is operations.json: how each RPC of the generated service maps to the REST API.
type spec struct {
	BaseURL    string      `json:"baseUrl"`
	ListenAddr string      `json:"listenAddr"`
	Operations []operation `json:"operations"`
	// Types maps a message name to its fields: the REST property name to the proto field name.
	Types map[string]map[string]string `json:"types"`
}

type operation struct {
	RPC        string      `json:"rpc"`
	Method     string      `json:"method"`
	Path       string      `json:"path"`
	Parameters []parameter `json:"parameters"`
}

type parameter struct {
	// Field is the proto field of the request message that carries the argument.
	Field string `json:"field"`
	Name  string `json:"name"`
	In    string `json:"in"`
}

func loadSpec(data []byte) (*spec, error) {
	loaded := &spec{}
	if err := json.Unmarshal(data, loaded); err != nil {
		return nil, fmt.Errorf("operations.json: %w", err)
	}
	return loaded, nil
}

func compileService(protoSource string) (protoreflect.ServiceDescriptor, error) {
	compiler := protocompile.Compiler{
		Resolver: protocompile.WithStandardImports(&protocompile.SourceResolver{
			Accessor: protocompile.SourceAccessorFromMap(map[string]string{protoFileName: protoSource}),
		}),
	}

	files, err := compiler.Compile(context.Background(), protoFileName)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", protoFileName, err)
	}

	services := files[0].Services()
	if services.Len() != 1 {
		return nil, fmt.Errorf("%s: want one service, got %d", protoFileName, services.Len())
	}
	return services.Get(0), nil
}

// registerService serves every RPC of the generated proto with messages built from its descriptors, so the
// module needs no generated Go code and stays in step with service.proto.
func registerService(server *grpc.Server, protoSource string, spec *spec, current func() *upstream) error {
	service, err := compileService(protoSource)
	if err != nil {
		return err
	}

	description := grpc.ServiceDesc{
		ServiceName: string(service.FullName()),
		HandlerType: (*any)(nil),
		Metadata:    protoFileName,
	}

	for _, operation := range spec.Operations {
		method := service.Methods().ByName(protoreflect.Name(operation.RPC))
		if method == nil {
			return fmt.Errorf("operations.json: %s has no rpc %s", protoFileName, operation.RPC)
		}

		description.Methods = append(description.Methods, grpc.MethodDesc{
			MethodName: operation.RPC,
			Handler:    handlerFor(method, operation, spec.Types, current),
		})
	}

	server.RegisterService(&description, struct{}{})
	return nil
}

type unaryHandler = func(any, context.Context, func(any) error, grpc.UnaryServerInterceptor) (any, error)

func handlerFor(
	method protoreflect.MethodDescriptor,
	operation operation,
	types map[string]map[string]string,
	current func() *upstream,
) unaryHandler {
	return func(_ any, ctx context.Context, decode func(any) error, _ grpc.UnaryServerInterceptor) (any, error) {
		request := dynamicpb.NewMessage(method.Input())
		if err := decode(request); err != nil {
			return nil, err
		}

		response := dynamicpb.NewMessage(method.Output())
		if err := current().call(ctx, operation, types, request, response); err != nil {
			return nil, err
		}
		return response, nil
	}
}
