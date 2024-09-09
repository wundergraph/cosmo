package api

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	platformv1 "github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1/platformv1connect"
)

func CreateNamespace(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name string) error {
	request := connect.NewRequest(&platformv1.CreateNamespaceRequest{Name: name})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.CreateNamespace(ctx, request)
	return err
}

func RenameNamespace(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, oldName, newName string) error {
	request := connect.NewRequest(&platformv1.RenameNamespaceRequest{
		Name:    oldName,
		NewName: newName,
	})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.RenameNamespace(ctx, request)
	return err
}

func DeleteNamespace(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name string) error {
	request := connect.NewRequest(&platformv1.DeleteNamespaceRequest{Name: name})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.DeleteNamespace(ctx, request)
	return err
}

func ListNamespaces(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string) ([]*platformv1.Namespace, error) {
	request := connect.NewRequest(&platformv1.GetNamespacesRequest{})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	response, err := client.GetNamespaces(ctx, request)
	if err != nil {
		return nil, err
	}
	return response.Msg.Namespaces, nil
}
