package restsource

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

type subgraph struct {
	connection *grpc.ClientConn
	service    protoreflect.ServiceDescriptor
	spec       *spec
}

// startSubgraph serves the generated service on a loopback port, as the module does inside the router, and
// answers it from the given REST API.
func startSubgraph(t *testing.T, restAPI *httptest.Server) *subgraph {
	t.Helper()

	loaded, err := loadSpec(operationsJSON)
	if err != nil {
		t.Fatal(err)
	}

	server := grpc.NewServer()
	err = registerService(server, serviceProto, loaded, func() *upstream {
		return &upstream{baseURL: restAPI.URL, client: restAPI.Client()}
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

	return dial(t, listener.Addr().String(), loaded)
}

func dial(t *testing.T, address string, loaded *spec) *subgraph {
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
	return &subgraph{connection: connection, service: service, spec: loaded}
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

// setSample gives an argument a value and returns it as the REST API should receive it.
func setSample(request *dynamicpb.Message, fieldName string) string {
	field := request.Descriptor().Fields().ByName(protoreflect.Name(fieldName))
	target := protoreflect.Message(request)
	if field.Kind() == protoreflect.MessageKind {
		target = request.Mutable(field).Message()
		field = field.Message().Fields().ByName("value")
	}

	switch field.Kind() {
	case protoreflect.Int32Kind:
		target.Set(field, protoreflect.ValueOfInt32(7))
		return "7"
	case protoreflect.DoubleKind:
		target.Set(field, protoreflect.ValueOfFloat64(1.5))
		return "1.5"
	case protoreflect.BoolKind:
		target.Set(field, protoreflect.ValueOfBool(true))
		return "true"
	default:
		target.Set(field, protoreflect.ValueOfString("sample"))
		return "sample"
	}
}

func TestEveryOperationCallsItsRESTPath(t *testing.T) {
	loaded, err := loadSpec(operationsJSON)
	if err != nil {
		t.Fatal(err)
	}

	for _, operation := range loaded.Operations {
		t.Run(operation.RPC, func(t *testing.T) {
			var received []*http.Request
			emptyBody := "{}"

			restAPI := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				received = append(received, request)
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(emptyBody))
			}))
			defer restAPI.Close()

			started := startSubgraph(t, restAPI)
			if started.service.Methods().ByName(protoreflect.Name(operation.RPC)).Output().Fields().Get(0).IsList() {
				emptyBody = "[]"
			}

			wantPath := operation.Path
			wantQuery := map[string]string{}
			_, err := started.invoke(operation.RPC, func(request *dynamicpb.Message) {
				for _, parameter := range operation.Parameters {
					sample := setSample(request, parameter.Field)
					if parameter.In == "path" {
						wantPath = strings.ReplaceAll(wantPath, "{"+parameter.Name+"}", sample)
						continue
					}
					wantQuery[parameter.Name] = sample
				}
			})
			if err != nil {
				t.Fatalf("want an answer, got %v", err)
			}

			if len(received) != 1 {
				t.Fatalf("want one request to the REST API, got %d", len(received))
			}
			if received[0].Method != operation.Method || received[0].URL.Path != wantPath {
				t.Fatalf("want %s %s, got %s %s", operation.Method, wantPath, received[0].Method, received[0].URL.Path)
			}
			for name, want := range wantQuery {
				if got := received[0].URL.Query().Get(name); got != want {
					t.Fatalf("want query parameter %s=%s, got %q", name, want, got)
				}
			}
		})
	}
}
