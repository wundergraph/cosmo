package main

import (
  "context"
  "net"
  "testing"

  "github.com/stretchr/testify/assert"
  "github.com/stretchr/testify/require"
  service "github.com/wundergraph/cosmo/plugin/generated"
  "google.golang.org/grpc"
  "google.golang.org/grpc/credentials/insecure"
  "google.golang.org/grpc/test/bufconn"
)

const bufSize = 1024 * 1024

// testService is a wrapper that holds the gRPC test components
type testService struct {
  grpcConn  *grpc.ClientConn
  client service.A7ServiceClient
  cleanup   func()
}

// setupTestService creates a local gRPC server for testing
func setupTestService(t *testing.T) *testService {
  // Create a buffer for gRPC connections
  lis := bufconn.Listen(bufSize)

  // Create a new gRPC server
  grpcServer := grpc.NewServer()

  // Register our service
  service.RegisterA7ServiceServer(grpcServer, &A7Service{
    nextID: 1,
  })

  // Start the server
  go func() {
    if err := grpcServer.Serve(lis); err != nil {
      t.Fatalf("failed to serve: %v", err)
    }
  }()

  // Create a client connection
  dialer := func(context.Context, string) (net.Conn, error) {
    return lis.Dial()
  }
  conn, err := grpc.Dial(
    "passthrough:///bufnet",
    grpc.WithContextDialer(dialer),
    grpc.WithTransportCredentials(insecure.NewCredentials()),
  )
  require.NoError(t, err)

  // Create the service client
  client := service.NewA7ServiceClient(conn)

  // Return cleanup function
  cleanup := func() {
    conn.Close()
    grpcServer.Stop()
  }

  return &testService{
    grpcConn:  conn,
    client: client,
    cleanup:   cleanup,
  }
}

func TestQueryHello(t *testing.T) {
  // Set up basic service
  svc := setupTestService(t)
  defer svc.cleanup()

  tests := []struct {
    name     string
    userName string
    wantId   string
    wantName string
    wantErr  bool
  }{
    {
      name:     "valid hello",
      userName: "Alice",
      wantId:   "1",
      wantName: "Alice",
      wantErr:  false,
    },
    {
      name:     "empty name",
      userName: "",
      wantId:   "2",
      wantName: "", // Empty name should be preserved
      wantErr:  false,
    },
    {
      name:     "special characters",
      userName: "John & Jane",
      wantId:   "3",
      wantName: "John & Jane",
      wantErr:  false,
    },
  }

  for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
      req := &service.QueryHelloRequest{
        Name: tt.userName,
      }

      resp, err := svc.client.QueryHello(context.Background(), req)
      if tt.wantErr {
        assert.Error(t, err)
        return
      }

      assert.NoError(t, err)
      assert.NotNil(t, resp.Hello)
      assert.Equal(t, tt.wantId, resp.Hello.Id)
      assert.Equal(t, tt.wantName, resp.Hello.Name)
    })
  }
}

func TestSequentialIDs(t *testing.T) {
  // Set up basic service
  svc := setupTestService(t)
  defer svc.cleanup()

  // The first request should get ID "1"
  firstReq := &service.QueryHelloRequest{Name: "First"}
  firstResp, err := svc.client.QueryHello(context.Background(), firstReq)
  require.NoError(t, err)
  assert.Equal(t, "1", firstResp.Hello.Id)

  // The second request should get ID "2"
  secondReq := &service.QueryHelloRequest{Name: "Second"}
  secondResp, err := svc.client.QueryHello(context.Background(), secondReq)
  require.NoError(t, err)
  assert.Equal(t, "2", secondResp.Hello.Id)

  // The third request should get ID "3"
  thirdReq := &service.QueryHelloRequest{Name: "Third"}
  thirdResp, err := svc.client.QueryHello(context.Background(), thirdReq)
  require.NoError(t, err)
  assert.Equal(t, "3", thirdResp.Hello.Id)
}
