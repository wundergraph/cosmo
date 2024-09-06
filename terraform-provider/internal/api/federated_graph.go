package api

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/common"

	platform "github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1/platformv1connect"
)

// FederatedGraph represents the data required to create or update a federated graph.
type FederatedGraph struct {
	Name                   string
	Namespace              string
	RoutingUrl             string
	AdmissionWebhookURL    *string
	AdmissionWebhookSecret *string
	Readme                 *string
	LabelMatchers          []string
}

// CreateFederatedGraph creates a federated graph using the provided API client and graph data.
func CreateFederatedGraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string, graph FederatedGraph) (*platform.CreateFederatedGraphResponse, error) {
	// Safely handle AdmissionWebhookURL (check if it's nil before dereferencing)
	var admissionWebhookURL string
	if graph.AdmissionWebhookURL != nil {
		admissionWebhookURL = *graph.AdmissionWebhookURL
	}

	// Create the request, using the safe values
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

// UpdateFederatedGraph updates an existing federated graph using the provided API client and graph data.
func UpdateFederatedGraph(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey string, graph FederatedGraph) (*platform.UpdateFederatedGraphResponse, error) {
	// Safely handle AdmissionWebhookURL (check if it's nil before dereferencing)
	var admissionWebhookURL *string
	if graph.AdmissionWebhookURL != nil {
		admissionWebhookURL = graph.AdmissionWebhookURL
	}

	// Create the request, using the safe values
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

// DeleteFederatedGraph deletes a federated graph using the provided API client.
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

// GetFederatedGraph fetches a federated graph by name and namespace using the provided API client.
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
