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
		s.RegisterService(&service.E7Service_ServiceDesc, &E7Service{
			nextID: 1,
		})
	}, routerplugin.WithTracing())

	if err != nil {
		log.Fatalf("failed to create router plugin: %v", err)
	}

	pl.Serve()
}

type E7Service struct {
	service.UnimplementedE7ServiceServer
	nextID int
}

func (s *E7Service) QueryHelloNewer(ctx context.Context, req *service.QueryHelloNewerRequest) (*service.QueryHelloNewerResponse, error) {
	response := &service.QueryHelloNewerResponse{
		HelloNewer: &service.World{
			Id:   strconv.Itoa(s.nextID),
			Name: "Awesome Name: " + req.Name,
		},
	}
	s.nextID++
	return response, nil
}
