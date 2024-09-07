package api

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	platform "github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1/platformv1connect"
)

type NamespaceAPI interface {
	Create(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name string) error
	Rename(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, oldName, newName string) error
	Delete(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name string) error
	List(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string) ([]*platform.Namespace, error)
}

func CreateNamespace(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name string) error {
	request := connect.NewRequest(&platform.CreateNamespaceRequest{Name: name})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.CreateNamespace(ctx, request)
	return err
}

func RenameNamespace(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, oldName, newName string) error {
	request := connect.NewRequest(&platform.RenameNamespaceRequest{
		Name:    oldName,
		NewName: newName,
	})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.RenameNamespace(ctx, request)
	return err
}

func DeleteNamespace(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name string) error {
	request := connect.NewRequest(&platform.DeleteNamespaceRequest{Name: name})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.DeleteNamespace(ctx, request)
	return err
}

func ListNamespaces(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string) ([]*platform.Namespace, error) {
	request := connect.NewRequest(&platform.GetNamespacesRequest{})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	response, err := client.GetNamespaces(ctx, request)
	if err != nil {
		return nil, err
	}
	return response.Msg.Namespaces, nil
}
