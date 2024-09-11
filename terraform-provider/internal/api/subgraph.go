package api

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	platformv1 "github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1/platformv1connect"
)

func CreateSubgraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string, name string, namespace string, routingUrl string, baseSubgraphName *string, labels []*platformv1.Label, subscriptionUrl *string, readme *string, isEventDrivenGraph *bool, isFeatureSubgraph *bool, subscriptionProtocol string, websocketSubprotocol string) error {
	request := connect.NewRequest(&platformv1.CreateFederatedSubgraphRequest{
		Name:                 name,
		BaseSubgraphName:     baseSubgraphName,
		Namespace:            namespace,
		RoutingUrl:           &routingUrl,
		Labels:               labels,
		SubscriptionUrl:      subscriptionUrl,
		Readme:               readme,
		WebsocketSubprotocol: resolveWebsocketSubprotocol(websocketSubprotocol),
		SubscriptionProtocol: resolveSubscriptionProtocol(subscriptionProtocol),
		IsEventDrivenGraph:   isEventDrivenGraph,
		IsFeatureSubgraph:    isFeatureSubgraph,
	})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.CreateFederatedSubgraph(ctx, request)
	return err
}

func UpdateSubgraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace, routingUrl string, labels []*platformv1.Label, headers []string, subscriptionUrl, readme *string, unsetLabels *bool, websocketSubprotocol string, subscriptionProtocol string) error {
	request := connect.NewRequest(&platformv1.UpdateSubgraphRequest{
		Name:                 name,
		RoutingUrl:           &routingUrl,
		Labels:               labels,
		Headers:              headers,
		SubscriptionUrl:      subscriptionUrl,
		Readme:               readme,
		Namespace:            namespace,
		UnsetLabels:          unsetLabels,
		WebsocketSubprotocol: resolveWebsocketSubprotocol(websocketSubprotocol),
		SubscriptionProtocol: resolveSubscriptionProtocol(subscriptionProtocol),
	})

	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.UpdateSubgraph(ctx, request)
	return err
}

func DeleteSubgraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) error {
	request := connect.NewRequest(&platformv1.DeleteFederatedSubgraphRequest{
		SubgraphName: name,
		Namespace:    namespace,
	})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.DeleteFederatedSubgraph(ctx, request)
	return err
}

func GetSubgraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) (*platformv1.Subgraph, error) {
	request := connect.NewRequest(&platformv1.GetSubgraphByNameRequest{
		Name:      name,
		Namespace: namespace,
	})
	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	response, err := client.GetSubgraphByName(ctx, request)
	if err != nil {
		return nil, err
	}

	subgraph := &platformv1.Subgraph{
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
