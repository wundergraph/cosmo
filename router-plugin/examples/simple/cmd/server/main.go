package main

import (
	"context"
	"log"

	"github.com/hashicorp/go-plugin"
	routerplugin "github.com/wundergraph/cosmo/router-plugin"
	userv1 "github.com/wundergraph/cosmo/router-plugin/examples/simple/userv1/user/v1"
	"google.golang.org/grpc"
)

func main() {

	reattachConfigCh := make(chan *plugin.ReattachConfig)

	pl, err := routerplugin.NewRouterPlugin(func(s *grpc.Server) {
		userv1.RegisterUserServiceServer(s, &UserService{})
	})

	if err != nil {
		log.Fatalf("failed to create router plugin: %v", err)
	}

	go func() {
		reattachConfig := <-reattachConfigCh
		log.Printf("reattach config: %v", reattachConfig)
	}()

	pl.Serve()
}

type UserService struct {
	userv1.UnimplementedUserServiceServer
}

func (s *UserService) GetUser(ctx context.Context, req *userv1.GetUserRequest) (*userv1.GetUserResponse, error) {
	return &userv1.GetUserResponse{Id: req.Id}, nil
}
