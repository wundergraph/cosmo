package api

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	platform "github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1/platformv1connect"
)

type SubgraphAPI interface {
	Create(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace, routingUrl string) error
	Update(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace, routingUrl string) error
	Delete(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) error
	Get(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) (*platform.Subgraph, error)
}

type Subgraph struct {
	Id               string
	Name             string
	Namespace        string
	RoutingURL       string
	BaseSubgraphName *string
}

func CreateSubgraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string, name string, namespace string, routingUrl string, baseSubgraphName *string) error {
	request := connect.NewRequest(&platform.CreateFederatedSubgraphRequest{
		Name:             name,
		BaseSubgraphName: baseSubgraphName,
		Namespace:        namespace,
		RoutingUrl:       &routingUrl,
	})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.CreateFederatedSubgraph(ctx, request)
	return err
}

func UpdateSubgraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace, routingUrl string, labels []*platform.Label, headers []string, subscriptionUrl, readme *string, unsetLabels *bool) error {
	request := connect.NewRequest(&platform.UpdateSubgraphRequest{
		Name:            name,
		RoutingUrl:      &routingUrl,
		Labels:          labels,
		Headers:         headers,
		SubscriptionUrl: subscriptionUrl,
		Readme:          readme,
		Namespace:       namespace,
		UnsetLabels:     unsetLabels,
	})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.UpdateSubgraph(ctx, request)
	return err
}

func DeleteSubgraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) error {
	request := connect.NewRequest(&platform.DeleteFederatedSubgraphRequest{
		SubgraphName: name,
		Namespace:    namespace,
	})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.DeleteFederatedSubgraph(ctx, request)
	return err
}

func GetSubgraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) (*Subgraph, error) {
	request := connect.NewRequest(&platform.GetSubgraphByNameRequest{
		Name:      name,
		Namespace: namespace,
	})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	response, err := client.GetSubgraphByName(ctx, request)
	if err != nil {
		return nil, err
	}

	subgraph := &Subgraph{
		Id:         response.Msg.Graph.Id,
		Name:       response.Msg.Graph.Name,
		Namespace:  response.Msg.Graph.Namespace,
		RoutingURL: response.Msg.Graph.RoutingURL,
	}

	if response.Msg.Graph.BaseSubgraphName != nil && *response.Msg.Graph.BaseSubgraphName != "" {
		baseSubgraphName := *response.Msg.Graph.BaseSubgraphName
		subgraph.BaseSubgraphName = &baseSubgraphName
	}

	return subgraph, nil
}
