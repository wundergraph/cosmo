package connectrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"github.com/bufbuild/protocompile"
	"github.com/bufbuild/protocompile/linker"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap/buffer"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

type GraphQLRequest struct {
	Query         string          `json:"query,omitempty"`
	OperationName string          `json:"operationName,omitempty"`
	Variables     json.RawMessage `json:"variables,omitempty"`
	Extensions    json.RawMessage `json:"extensions,omitempty"`
}

type ConnectRPCData struct {
	Schema  string
	Mapping *nodev1.GRPCMapping
}

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

var _ http.ResponseWriter = &tempResponse{}

type tempResponse struct {
	header     http.Header
	data       *buffer.Buffer
	statusCode int
}

func (resp *tempResponse) Header() http.Header {
	return resp.header
}

func (resp *tempResponse) Write(data []byte) (int, error) {
	return resp.data.Write(data)
}

func (resp *tempResponse) WriteHeader(statusCode int) {
	resp.statusCode = statusCode
}

type OperationPath string

type ConnectRPCOperation struct {
	PackageName  string
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

func (o *ConnectRPCOperation) Input() protoreflect.MessageDescriptor {
	return o.input
}

func (o *ConnectRPCOperation) Output() protoreflect.MessageDescriptor {
	return o.output
}

func (o *ConnectRPCOperation) Procedure() string {
	return fmt.Sprintf("/%s.%s/%s", o.PackageName, o.ServiceName, o.MethodName)
}

type FuncUnaryFn func(ctx context.Context, r *connect.Request[UniversalMessage]) (*connect.Response[UniversalMessage], error)

func (o *ConnectRPCOperation) GetUnaryFunc(graphqlPath string, graphqlHandler http.Handler, tempResp *tempResponse) FuncUnaryFn {
	return func(ctx context.Context, r *connect.Request[UniversalMessage]) (*connect.Response[UniversalMessage], error) {
		// Build request
		// TODO: handle messages in params
		rMsg := r.Msg.Get()
		params := make(map[string]any)
		inFields := o.input.Fields()
		for i := 0; i < inFields.Len(); i++ {
			field := inFields.Get(i)
			protoValue := rMsg.Get(field)
			kind := field.Kind()
			switch kind {
			case protoreflect.StringKind:
				params[string(field.Name())] = protoValue.String()
			case protoreflect.Int32Kind, protoreflect.Int64Kind:
				params[string(field.Name())] = protoValue.Int()
			case protoreflect.BoolKind:
				params[string(field.Name())] = protoValue.Bool()
			case protoreflect.BytesKind:
				params[string(field.Name())] = protoValue.Bytes()
			case protoreflect.FloatKind:
				params[string(field.Name())] = protoValue.Float()
			}
		}

		paramsJSON, err := json.Marshal(params)
		if err != nil {
			return nil, err
		}

		gqlRequest := &GraphQLRequest{
			Query:     o.graphqlQuery,
			Variables: json.RawMessage(paramsJSON),
		}

		gqlRequestJSON, err := json.Marshal(gqlRequest)
		if err != nil {
			return nil, err
		}

		// Send the query in the happy GraphQL federated world
		graphqlRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, graphqlPath, bytes.NewReader(gqlRequestJSON))
		if err != nil {
			return nil, err
		}

		// send the request to the graphql handler
		graphqlHandler.ServeHTTP(tempResp, graphqlRequest)

		// Convert the response to gRPC
		msg, err := graphqlToRPC(o.fd, o.MethodName, o.mapping, tempResp.data.String())
		if err != nil {
			return nil, err
		}

		response := connect.NewResponse(&UniversalMessage{msg: msg})
		return response, nil
	}
}

type ConnectRPC struct {
	prefix string
	ops    map[OperationPath]*ConnectRPCOperation
	data   []ConnectRPCData
}

func (c *ConnectRPC) GetOperation(path OperationPath) *ConnectRPCOperation {
	return c.ops[path]
}

// Start starts the ConnectRPC server
func (c *ConnectRPC) Bootstrap() error {
	c.ops = make(map[OperationPath]*ConnectRPCOperation)
	for _, d := range c.data {
		fd, err := fileDescriptorProto(d.Schema, context.TODO())
		if err != nil {
			return err
		}

		opToQueries := make(map[string]string)
		for _, op := range d.Mapping.GetOperationMappings() {
			opToQueries[op.GetMapped()] = op.GetOriginalQuery()
		}

		services := fd.Services()
		for i := 0; i < services.Len(); i++ {
			svc := services.Get(i)
			for j := 0; j < svc.Methods().Len(); j++ {
				method := svc.Methods().Get(j)
				op := &ConnectRPCOperation{
					PackageName:  string(svc.ParentFile().Package()),
					ServiceName:  string(svc.Name()),
					MethodName:   string(method.Name()),
					Schema:       method.Input(),
					input:        method.Input(),
					output:       method.Output(),
					fd:           fd,
					graphqlQuery: opToQueries[string(method.Name())],
					schema:       d.Schema,
					mapping:      d.Mapping,
				}
				c.ops[OperationPath(op.Procedure())] = op
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

func (c *ConnectRPC) HandlerFunc(w http.ResponseWriter, r *http.Request, graphqlPath string, graphqlHandler http.Handler) bool {
	path := strings.TrimPrefix(r.URL.Path, c.prefix)
	op, found := c.ops[OperationPath(path)]
	if !found {
		return false
	}

	tempResp := &tempResponse{
		header:     w.Header(),
		data:       &buffer.Buffer{},
		statusCode: http.StatusOK,
	}

	connect.NewUnaryHandler(
		op.Procedure(),
		op.GetUnaryFunc(graphqlPath, graphqlHandler, tempResp),
		connect.WithSchema(op.Schema),
		connect.WithIdempotency(connect.IdempotencyNoSideEffects),
		connect.WithRequestInitializer(func(spec connect.Spec, message any) error {
			desc := op.fd.Messages().ByName(op.input.Name())
			if desc == nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("message type not found"))
			}
			msg := dynamicpb.NewMessage(desc)
			message.(*UniversalMessage).Set(msg)
			return nil
		}),
	).ServeHTTP(w, r)

	return true
}

func NewConnectRPC(prefix string, data []ConnectRPCData) *ConnectRPC {
	connectRPC := &ConnectRPC{
		prefix: prefix,
	}

	connectRPC.data = append(connectRPC.data, data...)

	return connectRPC
}
