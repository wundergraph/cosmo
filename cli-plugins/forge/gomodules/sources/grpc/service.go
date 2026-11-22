package grpcsource

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/bufbuild/protocompile"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

const (
	protoFileName    = "service.proto"
	upstreamFileName = "upstream.proto"
)

// What the contract response's one field holds.
const (
	returnsField   = "field"
	returnsMessage = "message"
	returnsEmpty   = "empty"
)

// spec is operations.json: how each RPC of the generated service maps to the upstream gRPC service.
type spec struct {
	Target     string      `json:"target"`
	ListenAddr string      `json:"listenAddr"`
	Operations []operation `json:"operations"`
	names
}

type operation struct {
	RPC string `json:"rpc"`
	// Method is the full gRPC method of the upstream service, such as /payroll.v1.PayrollService/GetSalary.
	Method  string `json:"method"`
	Returns string `json:"returns"`
	// Field is the field of the upstream response that holds the result when Returns is "field".
	Field string `json:"field"`
}

// names maps contract names to upstream names, keyed by the contract message or enum they belong to.
type names struct {
	Messages map[string]map[string]string `json:"messages"`
	Enums    map[string]map[string]string `json:"enums"`
}

func loadSpec(data []byte) (*spec, error) {
	loaded := &spec{}
	if err := json.Unmarshal(data, loaded); err != nil {
		return nil, fmt.Errorf("operations.json: %w", err)
	}
	return loaded, nil
}

func compileFile(fileName string, protoSource string) (protoreflect.FileDescriptor, error) {
	compiler := protocompile.Compiler{
		Resolver: protocompile.WithStandardImports(&protocompile.SourceResolver{
			Accessor: protocompile.SourceAccessorFromMap(map[string]string{fileName: protoSource}),
		}),
	}

	files, err := compiler.Compile(context.Background(), fileName)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", fileName, err)
	}
	return files[0], nil
}

func compileService(protoSource string) (protoreflect.ServiceDescriptor, error) {
	file, err := compileFile(protoFileName, protoSource)
	if err != nil {
		return nil, err
	}

	services := file.Services()
	if services.Len() != 1 {
		return nil, fmt.Errorf("%s: want one service, got %d", protoFileName, services.Len())
	}
	return services.Get(0), nil
}

// findMethod looks up a full gRPC method name, such as /payroll.v1.PayrollService/GetSalary, in a proto file.
func findMethod(file protoreflect.FileDescriptor, fullMethod string) protoreflect.MethodDescriptor {
	serviceName, methodName, found := strings.Cut(strings.TrimPrefix(fullMethod, "/"), "/")
	if !found {
		return nil
	}

	for index := range file.Services().Len() {
		service := file.Services().Get(index)
		if string(service.FullName()) == serviceName {
			return service.Methods().ByName(protoreflect.Name(methodName))
		}
	}
	return nil
}

// registerService serves every RPC of the generated proto with messages built from its descriptors, and calls
// the upstream with messages built from upstream.proto, so the module needs no generated Go code.
func registerService(
	server *grpc.Server,
	protoSource string,
	upstreamSource string,
	spec *spec,
	current func() *upstream,
) error {
	service, err := compileService(protoSource)
	if err != nil {
		return err
	}

	upstreamFile, err := compileFile(upstreamFileName, upstreamSource)
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

		upstreamMethod := findMethod(upstreamFile, operation.Method)
		if upstreamMethod == nil {
			return fmt.Errorf("operations.json: %s has no method %s", upstreamFileName, operation.Method)
		}
		if upstreamMethod.IsStreamingClient() || upstreamMethod.IsStreamingServer() {
			return fmt.Errorf("operations.json: %s is a streaming method", operation.Method)
		}

		switch operation.Returns {
		case returnsField:
			if upstreamMethod.Output().Fields().ByName(protoreflect.Name(operation.Field)) == nil {
				return fmt.Errorf("operations.json: the response of %s has no field %s", operation.Method, operation.Field)
			}
		case returnsMessage, returnsEmpty:
		default:
			return fmt.Errorf("operations.json: %s returns %q, want field, message or empty", operation.RPC, operation.Returns)
		}

		description.Methods = append(description.Methods, grpc.MethodDesc{
			MethodName: operation.RPC,
			Handler:    handlerFor(method, upstreamMethod, operation, spec.names, current),
		})
	}

	server.RegisterService(&description, struct{}{})
	return nil
}

type unaryHandler = func(any, context.Context, func(any) error, grpc.UnaryServerInterceptor) (any, error)

func handlerFor(
	method protoreflect.MethodDescriptor,
	upstreamMethod protoreflect.MethodDescriptor,
	operation operation,
	names names,
	current func() *upstream,
) unaryHandler {
	return func(_ any, ctx context.Context, decode func(any) error, _ grpc.UnaryServerInterceptor) (any, error) {
		request := dynamicpb.NewMessage(method.Input())
		if err := decode(request); err != nil {
			return nil, err
		}

		response := dynamicpb.NewMessage(method.Output())
		if err := current().call(ctx, operation, upstreamMethod, names, request, response); err != nil {
			return nil, err
		}
		return response, nil
	}
}
