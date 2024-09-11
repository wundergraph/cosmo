package api

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/common"

	platformv1 "github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1/platformv1connect"
)

func CreateFederatedGraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string, admissionWebhookSecret *string, graph *platformv1.FederatedGraph) (*platformv1.CreateFederatedGraphResponse, error) {
	var admissionWebhookURL string
	if graph.AdmissionWebhookUrl != nil {
		admissionWebhookURL = *graph.AdmissionWebhookUrl
	} else {
		admissionWebhookURL = ""
	}

	request := connect.NewRequest(&platformv1.CreateFederatedGraphRequest{
		Name:                   graph.Name,
		Namespace:              graph.Namespace,
		RoutingUrl:             graph.RoutingURL,
		AdmissionWebhookURL:    admissionWebhookURL,
		AdmissionWebhookSecret: admissionWebhookSecret,
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

func UpdateFederatedGraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string, admissionWebhookSecret *string, graph *platformv1.FederatedGraph) (*platformv1.UpdateFederatedGraphResponse, error) {
	var admissionWebhookURL *string
	if graph.AdmissionWebhookUrl != nil {
		admissionWebhookURL = graph.AdmissionWebhookUrl
	}

	request := connect.NewRequest(&platformv1.UpdateFederatedGraphRequest{
		Name:                   graph.Name,
		Namespace:              graph.Namespace,
		RoutingUrl:             graph.RoutingURL,
		AdmissionWebhookURL:    admissionWebhookURL,
		AdmissionWebhookSecret: admissionWebhookSecret,
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
	request := connect.NewRequest(&platformv1.DeleteFederatedGraphRequest{
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

func GetFederatedGraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, namespace string) (*platformv1.GetFederatedGraphByNameResponse, error) {
	request := connect.NewRequest(&platformv1.GetFederatedGraphByNameRequest{
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
