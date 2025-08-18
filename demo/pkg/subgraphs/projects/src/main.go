package main

import (
	"log"

	"github.com/hashicorp/go-hclog"
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/src/service"
	routerplugin "github.com/wundergraph/cosmo/router-plugin"
	"google.golang.org/grpc"
)

func main() {

	registerFunc := func(s *grpc.Server) {
		s.RegisterService(&projects.ProjectsService_ServiceDesc, &service.ProjectsService{
			NextID: 1,
		})
	}

	pl, err := routerplugin.NewRouterPlugin(registerFunc,
		routerplugin.WithLogger(hclog.Info),
	)

	if err != nil {
		log.Fatalf("failed to create router plugin: %v", err)
	}

	pl.Serve()
}
