package api

import (
	"context"

	platformv1 "github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1/platformv1connect"
)

type Subgraph struct {
	Id               string
	Name             string
	Namespace        string
	RoutingURL       string
	BaseSubgraphName *string
}

type SubgraphAPI interface {
	Create(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace, routingUrl string) error
	Update(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace, routingUrl string) error
	Delete(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) error
	Get(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) (*platformv1.Subgraph, error)
}

type NamespaceAPI interface {
	Create(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name string) error
	Rename(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, oldName, newName string) error
	Delete(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name string) error
	List(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string) ([]*platformv1.Namespace, error)
}
