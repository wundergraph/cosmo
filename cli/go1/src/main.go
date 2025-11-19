package main

import (
  "context"
  "log"
  "strconv"

  service "github.com/wundergraph/cosmo/plugin/generated"

  routerplugin "github.com/wundergraph/cosmo/router-plugin"
  "google.golang.org/grpc"
)

func main() {
  pl, err := routerplugin.NewRouterPlugin(func(s *grpc.Server) {
    s.RegisterService(&service.Go1Service_ServiceDesc, &Go1Service{
      nextID: 1,
    })
  }, routerplugin.WithTracing())

  if err != nil {
    log.Fatalf("failed to create router plugin: %v", err)
  }

  pl.Serve()
}

type Go1Service struct {
  service.UnimplementedGo1ServiceServer
  nextID int
}

func (s *Go1Service) QueryHello(ctx context.Context, req *service.QueryHelloRequest) (*service.QueryHelloResponse, error) {
  response := &service.QueryHelloResponse{
    Hello: &service.World{
      Id:   strconv.Itoa(s.nextID),
      Name: req.Name,
    },
  }
  s.nextID++
  return response, nil
}
