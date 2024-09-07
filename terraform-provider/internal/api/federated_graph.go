package api

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/common"

	platform "github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1/platformv1connect"
)

type FederatedGraph struct {
	Name                   string
	Namespace              string
	RoutingUrl             string
	AdmissionWebhookURL    *string
	AdmissionWebhookSecret *string
	Readme                 *string
	LabelMatchers          []string
}

type FederatedGraphAPI interface {
	Create(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string, graph FederatedGraph) (*platform.CreateFederatedGraphResponse, error)
	Update(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string, graph FederatedGraph) (*platform.UpdateFederatedGraphResponse, error)
	Delete(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) error
	Get(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) (*platform.GetFederatedGraphByNameResponse, error)
}

func CreateFederatedGraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string, graph FederatedGraph) (*platform.CreateFederatedGraphResponse, error) {
	var admissionWebhookURL string
	if graph.AdmissionWebhookURL != nil {
		admissionWebhookURL = *graph.AdmissionWebhookURL
	}

	request := connect.NewRequest(&platform.CreateFederatedGraphRequest{
		Name:                   graph.Name,
		Namespace:              graph.Namespace,
		RoutingUrl:             graph.RoutingUrl,
		AdmissionWebhookURL:    admissionWebhookURL,
		AdmissionWebhookSecret: graph.AdmissionWebhookSecret,
		Readme:                 graph.Readme,
		LabelMatchers:          graph.LabelMatchers,
	})

	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	response, err := client.CreateFederatedGraph(ctx, request)
	if err != nil {
		return nil, err
	}

	if response.Msg.GetResponse().Code != common.EnumStatusCode_OK {
		return nil, fmt.Errorf("failed to create federated graph: %s", response.Msg.GetResponse().GetDetails())
	}

	return response.Msg, nil
}

func UpdateFederatedGraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string, graph FederatedGraph) (*platform.UpdateFederatedGraphResponse, error) {
	var admissionWebhookURL *string
	if graph.AdmissionWebhookURL != nil {
		admissionWebhookURL = graph.AdmissionWebhookURL
	}

	request := connect.NewRequest(&platform.UpdateFederatedGraphRequest{
		Name:                   graph.Name,
		Namespace:              graph.Namespace,
		RoutingUrl:             graph.RoutingUrl,
		AdmissionWebhookURL:    admissionWebhookURL,
		AdmissionWebhookSecret: graph.AdmissionWebhookSecret,
		LabelMatchers:          graph.LabelMatchers,
	})

	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	response, err := client.UpdateFederatedGraph(ctx, request)
	if err != nil {
		return nil, err
	}

	if response.Msg.GetResponse().Code != common.EnumStatusCode_OK {
		return nil, fmt.Errorf("failed to update federated graph: %s", response.Msg.GetResponse().GetDetails())
	}

	return response.Msg, nil
}

func DeleteFederatedGraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) error {
	request := connect.NewRequest(&platform.DeleteFederatedGraphRequest{
		Name:      name,
		Namespace: namespace,
	})

	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	_, err := client.DeleteFederatedGraph(ctx, request)
	if err != nil {
		return err
	}

	return nil
}

func GetFederatedGraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) (*platform.GetFederatedGraphByNameResponse, error) {
	request := connect.NewRequest(&platform.GetFederatedGraphByNameRequest{
		Name:      name,
		Namespace: namespace,
	})

	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	response, err := client.GetFederatedGraphByName(ctx, request)
	if err != nil {
		return nil, err
	}

	if response.Msg.GetResponse().Code != common.EnumStatusCode_OK {
		return nil, fmt.Errorf("failed to get federated graph: %s", response.Msg.GetResponse().GetDetails())
	}

	return response.Msg, nil
}
