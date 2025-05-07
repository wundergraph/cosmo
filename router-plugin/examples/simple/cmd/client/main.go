package main

import (
	"context"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/hashicorp/go-plugin"
	routerplugin "github.com/wundergraph/cosmo/router-plugin"
	userv1 "github.com/wundergraph/cosmo/router-plugin/examples/simple/userv1/user/v1"
	"google.golang.org/grpc"
)

// This file is only for test purposes, we only need the server part to be compliled

type mockPlugin struct {
	plugin.Plugin
}

func (p *mockPlugin) GRPCServer(broker *plugin.GRPCBroker, s *grpc.Server) error {
	panic("on a client this is not needed but must be implemented to satisfy the interface")
}

func (p *mockPlugin) GRPCClient(ctx context.Context, broker *plugin.GRPCBroker, c *grpc.ClientConn) (any, error) {
	return userv1.NewUserServiceClient(c), nil
}

func main() {

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		log.Fatalf("failed to get caller")
	}

	dir := filepath.Dir(file)

	pluginPath := filepath.Join(dir, "..", "..", "server-plugin")

	if _, err := os.Stat(pluginPath); os.IsNotExist(err) {
		log.Fatalf("plugin not found at %s", pluginPath)
	}

	client := plugin.NewClient(&plugin.ClientConfig{
		HandshakeConfig:  routerplugin.RouterPluginHandshakeConfig,
		AllowedProtocols: []plugin.Protocol{plugin.ProtocolGRPC},
		Plugins: map[string]plugin.Plugin{
			routerplugin.PluginMapName: &mockPlugin{},
		},
		Cmd: exec.Command(pluginPath),
	})

	defer client.Kill()

	cl, err := client.Client()
	if err != nil {
		log.Fatalf("failed to create client: %v", err)
	}

	rpcClient, err := cl.Dispense("grpc_datasource")
	if err != nil {
		log.Fatalf("failed to dispense client: %v", err)
	}

	userClient, ok := rpcClient.(userv1.UserServiceClient)
	if !ok {
		log.Fatalf("failed to cast to grpc.ClientConn")
	}

	resp, err := userClient.GetUser(context.Background(), &userv1.GetUserRequest{Id: "1"})
	if err != nil {
		log.Fatalf("failed to get user: %v", err)
	}

	log.Print("================= Plugin Output ================= ")
	log.Printf("user id: %v", resp.Id)
	log.Print("================================================= ")
}
