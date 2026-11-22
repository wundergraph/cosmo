package grpcsource

import (
	"context"
	"net"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// upstreamCall is one call the stub upstream received.
type upstreamCall struct {
	method   string
	request  *dynamicpb.Message
	metadata metadata.MD
}

// answer fills the upstream response to a call, or fails it.
type answer func(request *dynamicpb.Message, response *dynamicpb.Message) error

// stubUpstream serves every method of upstream.proto with messages built from its descriptors. A method without
// an answer replies with its zero response.
type stubUpstream struct {
	address string
	answers map[string]answer

	mutex    sync.Mutex
	received []upstreamCall
}

func startUpstream(t *testing.T, answers map[string]answer) *stubUpstream {
	t.Helper()

	file, err := compileFile(upstreamFileName, upstreamProto)
	if err != nil {
		t.Fatal(err)
	}

	stub := &stubUpstream{answers: answers}
	server := grpc.NewServer(grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
		fullMethod, _ := grpc.MethodFromServerStream(stream)
		method := findMethod(file, fullMethod)
		if method == nil {
			return status.Errorf(codes.Unimplemented, "%s is not in %s", fullMethod, upstreamFileName)
		}

		request := dynamicpb.NewMessage(method.Input())
		if err := stream.RecvMsg(request); err != nil {
			return err
		}

		incoming, _ := metadata.FromIncomingContext(stream.Context())
		stub.mutex.Lock()
		stub.received = append(stub.received, upstreamCall{method: fullMethod, request: request, metadata: incoming})
		stub.mutex.Unlock()

		response := dynamicpb.NewMessage(method.Output())
		if answer := stub.answers[fullMethod]; answer != nil {
			if err := answer(request, response); err != nil {
				return err
			}
		}
		return stream.SendMsg(response)
	}))

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(server.Stop)

	stub.address = listener.Addr().String()
	return stub
}

func (s *stubUpstream) calls() []upstreamCall {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return append([]upstreamCall(nil), s.received...)
}

// connect is the upstream as Provision configures it for a target.
func connect(t *testing.T, stub *stubUpstream, headers map[string]string) *upstream {
	t.Helper()

	connection, err := grpc.NewClient(stub.address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })

	return &upstream{connection: connection, headers: headers, timeout: 5 * time.Second}
}

type subgraph struct {
	connection *grpc.ClientConn
	service    protoreflect.ServiceDescriptor
}

// startSubgraph serves the generated service on a loopback port, as the module does inside the router, and
// answers it from the given upstream.
func startSubgraph(t *testing.T, current *upstream) *subgraph {
	t.Helper()

	loaded, err := loadSpec(operationsJSON)
	if err != nil {
		t.Fatal(err)
	}

	server := grpc.NewServer()
	err = registerService(server, serviceProto, upstreamProto, loaded, func() *upstream {
		return current
	})
	if err != nil {
		t.Fatal(err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(server.Stop)

	return dial(t, listener.Addr().String())
}

func dial(t *testing.T, address string) *subgraph {
	t.Helper()

	connection, err := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })

	service, err := compileService(serviceProto)
	if err != nil {
		t.Fatal(err)
	}
	return &subgraph{connection: connection, service: service}
}

// invoke calls an RPC the way the router does: by its full method name, with messages built from the proto.
func (s *subgraph) invoke(rpc string, fill func(request *dynamicpb.Message)) (*dynamicpb.Message, error) {
	method := s.service.Methods().ByName(protoreflect.Name(rpc))
	request := dynamicpb.NewMessage(method.Input())
	fill(request)

	response := dynamicpb.NewMessage(method.Output())
	fullMethod := "/" + string(s.service.FullName()) + "/" + rpc
	err := s.connection.Invoke(context.Background(), fullMethod, request, response)
	return response, err
}

func TestEveryOperationCallsItsUpstreamMethod(t *testing.T) {
	loaded, err := loadSpec(operationsJSON)
	if err != nil {
		t.Fatal(err)
	}

	for _, operation := range loaded.Operations {
		t.Run(operation.RPC, func(t *testing.T) {
			stub := startUpstream(t, nil)
			started := startSubgraph(t, connect(t, stub, nil))

			_, err := started.invoke(operation.RPC, func(*dynamicpb.Message) {})
			if err != nil {
				t.Fatalf("want an answer, got %v", err)
			}

			calls := stub.calls()
			if len(calls) != 1 {
				t.Fatalf("want one call to the upstream, got %d", len(calls))
			}
			if calls[0].method != operation.Method {
				t.Fatalf("want a call to %s, got %s", operation.Method, calls[0].method)
			}
		})
	}
}
