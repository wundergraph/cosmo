package connectrpc

import (
	"context"
	"fmt"
	"net/http"

	"connectrpc.com/connect"
	"github.com/bufbuild/protocompile"
	"github.com/bufbuild/protocompile/protoutil"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
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

type OperationPath string

type ConnectRPCOperation struct {
	ServiceName string
	MethodName  string
	Schema      *descriptorpb.MethodDescriptorProto
	inputType   string
	outputType  string
	fd          *descriptorpb.FileDescriptorProto
}

func (o *ConnectRPCOperation) Procedure() string {
	return o.MethodName
}

func (o *ConnectRPCOperation) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	makeResponse := func(ctx context.Context, r *connect.Request[UniversalMessage]) (*connect.Response[UniversalMessage], error) {
		var msgType *descriptorpb.DescriptorProto
		for _, mt := range o.fd.GetMessageType() {
			if "."+o.fd.GetPackage()+"."+mt.GetName() == o.outputType {
				msgType = mt
				break
			}
		}
		if msgType == nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("message type not found"))
		}
		desc := msgType.ProtoReflect().Descriptor()
		fields := desc.Fields()
		msg := dynamicpb.NewMessage(desc)
		field := fields.ByName(protoreflect.Name("message"))
		value := protoreflect.ValueOfString("Hello, World!")
		msg.Set(field, value)

		response := connect.NewResponse(&UniversalMessage{msg: msg})
		return response, nil
	}

	pingServicePingHandler := connect.NewUnaryHandler[UniversalMessage, UniversalMessage](
		o.Procedure(),
		makeResponse,
		connect.WithSchema(o.Schema),
		connect.WithIdempotency(connect.IdempotencyNoSideEffects),
		connect.WithRequestInitializer(func(spec connect.Spec, message any) error {
			var msgType *descriptorpb.DescriptorProto
			for _, mt := range o.fd.GetMessageType() {
				if "."+o.fd.GetPackage()+"."+mt.GetName() == o.inputType {
					msgType = mt
					break
				}
			}
			if msgType == nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("message type not found"))
			}
			msg := dynamicpb.NewMessage(msgType.ProtoReflect().Descriptor())
			message.(*UniversalMessage).Set(msg)
			return nil
		}),
	)
	pingServicePingHandler.ServeHTTP(w, r)
}

type ConnectRPC struct {
	ops    map[OperationPath]*ConnectRPCOperation
	schema string
}

// Start starts the ConnectRPC server
func (c *ConnectRPC) Bootstrap() error {
	c.ops = make(map[OperationPath]*ConnectRPCOperation)
	fd, err := fileDescriptorProto(c.schema, context.TODO())
	if err != nil {
		return err
	}
	for _, svc := range fd.GetService() {
		for _, method := range svc.GetMethod() {
			c.ops[OperationPath("/"+method.GetName())] = &ConnectRPCOperation{
				ServiceName: svc.GetName(),
				MethodName:  method.GetName(),
				Schema:      method,
				inputType:   method.GetInputType(),
				outputType:  method.GetOutputType(),
				fd:          fd,
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

func fileDescriptorProto(proto string, ctx context.Context) (*descriptorpb.FileDescriptorProto, error) {
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
	fdProto := protoutil.ProtoFromFileDescriptor(mainFile)

	return fdProto, nil
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

func NewConnectRPC(schema string) *ConnectRPC {
	return &ConnectRPC{
		schema: schema,
	}
}
