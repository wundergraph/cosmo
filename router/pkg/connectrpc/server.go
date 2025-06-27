package connectrpc

import (
	"context"
	"fmt"
	"net/http"

	"connectrpc.com/connect"
	"github.com/bufbuild/protocompile"
	"github.com/bufbuild/protocompile/linker"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

type UniversalMessage struct {
	msg *dynamicpb.Message
}

func (m *UniversalMessage) Set(msg *dynamicpb.Message) {
	m.msg = msg
}

func (m *UniversalMessage) ProtoReflect() protoreflect.Message {
	return m.msg
}

func (m *UniversalMessage) Get() *dynamicpb.Message {
	return m.msg
}

type OperationPath string

type ConnectRPCOperation struct {
	ServiceName  string
	MethodName   string
	Schema       protoreflect.MessageDescriptor
	input        protoreflect.MessageDescriptor
	output       protoreflect.MessageDescriptor
	fd           linker.File
	graphqlQuery string
	schema       string
	mapping      *nodev1.GRPCMapping
}

func (o *ConnectRPCOperation) Procedure() string {
	return o.MethodName
}

func sendGraphqlRequest(request string) string {
	return `
	{
		"data": {
			"TestQueryUser": {
				"id": "1",
				"name": "John Doe",
				"details": {
					"age": 30
				}
			}
		}
	}
	`
}

func (o *ConnectRPCOperation) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	makeResponse := func(ctx context.Context, r *connect.Request[UniversalMessage]) (*connect.Response[UniversalMessage], error) {
		// Build request
		rMsg := r.Msg.Get()
		params := make(map[string]any)
		inFields := o.input.Fields()
		for i := 0; i < inFields.Len(); i++ {
			field := inFields.Get(i)
			protoValue := rMsg.Get(field)
			switch field.Kind() {
			case protoreflect.StringKind:
				params[string(field.Name())] = protoValue.String()
			case protoreflect.Int32Kind:
			case protoreflect.Int64Kind:
				params[string(field.Name())] = protoValue.Int()
			}
		}

		// Send the query in the happy GraphQL federated world
		graphqlResponse := sendGraphqlRequest(o.graphqlQuery)

		// Convert the response to gRPC
		msg, err := graphqlToRPC(o.fd, o.mapping, graphqlResponse)
		if err != nil {
			return nil, err
		}

		response := connect.NewResponse(&UniversalMessage{msg: msg})
		return response, nil
	}

	pingServicePingHandler := connect.NewUnaryHandler[UniversalMessage, UniversalMessage](
		o.Procedure(),
		makeResponse,
		connect.WithSchema(o.Schema),
		connect.WithIdempotency(connect.IdempotencyNoSideEffects),
		connect.WithRequestInitializer(func(spec connect.Spec, message any) error {
			var desc protoreflect.MessageDescriptor
			for i := 0; i < o.fd.Messages().Len(); i++ {
				mt := o.fd.Messages().Get(i)
				if mt.FullName() == o.input.FullName() {
					desc = mt
					break
				}
			}
			if desc == nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("message type not found"))
			}
			msg := dynamicpb.NewMessage(desc)
			message.(*UniversalMessage).Set(msg)
			return nil
		}),
	)
	pingServicePingHandler.ServeHTTP(w, r)
}

type ConnectRPC struct {
	ops     map[OperationPath]*ConnectRPCOperation
	schema  string
	mapping *nodev1.GRPCMapping
}

// Start starts the ConnectRPC server
func (c *ConnectRPC) Bootstrap() error {
	c.ops = make(map[OperationPath]*ConnectRPCOperation)
	fd, err := fileDescriptorProto(c.schema, context.TODO())
	if err != nil {
		return err
	}

	opToQueries := make(map[string]string)
	for _, op := range c.mapping.GetOperationMappings() {
		opToQueries[op.GetMapped()] = op.GetOriginalQuery()
	}

	services := fd.Services()
	for i := 0; i < services.Len(); i++ {
		svc := services.Get(i)
		for j := 0; j < svc.Methods().Len(); j++ {
			method := svc.Methods().Get(j)
			c.ops[OperationPath("/"+string(method.Name()))] = &ConnectRPCOperation{
				ServiceName:  string(svc.Name()),
				MethodName:   string(method.Name()),
				Schema:       method.Input(),
				input:        method.Input(),
				output:       method.Output(),
				fd:           fd,
				graphqlQuery: opToQueries[string(method.Name())],
				schema:       c.schema,
				mapping:      c.mapping,
			}
		}
	}

	return nil
}

// Start starts the ConnectRPC server
func (c *ConnectRPC) Start() error {
	return nil
}

// Stop gracefully shuts down the ConnectRPC server
func (c *ConnectRPC) Stop(_ context.Context) error {
	return nil
}

func fileDescriptorProto(proto string, ctx context.Context) (linker.File, error) {
	const fileName = "base.proto"
	fileContent := map[string]string{
		fileName: proto,
	}
	res := &protocompile.SourceResolver{
		Accessor: protocompile.SourceAccessorFromMap(fileContent),
	}
	// Include standard imports (well-known types) in the resolver:
	resolver := protocompile.WithStandardImports(res)
	compiler := protocompile.Compiler{Resolver: resolver}
	files, err := compiler.Compile(ctx, fileName)
	if err != nil {
		// handle compilation errors (e.g. syntax, imports not found, etc.)
		return nil, err
	}
	// 'files' is a slice of compiled File descriptors (implements protoreflect.FileDescriptor)
	mainFile := files.FindFileByPath(fileName)

	return mainFile, nil
}

func (c *ConnectRPC) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		op, found := c.ops[OperationPath(r.URL.Path)]
		if !found {
			http.NotFound(w, r)
			return
		}

		op.ServeHTTP(w, r)
	})
}

func NewConnectRPC(schema string, mapping *nodev1.GRPCMapping) *ConnectRPC {
	return &ConnectRPC{
		schema:  schema,
		mapping: mapping,
	}
}
