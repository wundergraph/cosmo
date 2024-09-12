package api

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"github.com/wundergraph/cosmo/connect-go/wg/cosmo/common"
	platformv1 "github.com/wundergraph/cosmo/connect-go/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/connect-go/wg/cosmo/platform/v1/platformv1connect"
)

func CreateToken(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, name, graphName, namespace string) (string, error) {
	request := connect.NewRequest(&platformv1.CreateFederatedGraphTokenRequest{
		GraphName: graphName,
		Namespace: namespace,
	})

	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	response, err := client.CreateFederatedGraphToken(ctx, request)
	if err != nil {
		return "", err
	}

	if response.Msg.GetResponse().Code != common.EnumStatusCode_OK {
		return "", fmt.Errorf("failed to create token: %s", response.Msg.GetResponse().GetDetails())
	}

	return fmt.Sprintf("Token created successfully: %s", response.Msg.Token), nil
}

func DeleteToken(ctx context.Context, client platformv1connect.PlatformServiceClient, apiKey, tokenName, graphName, namespace string) error {
	request := connect.NewRequest(&platformv1.DeleteRouterTokenRequest{
		TokenName: tokenName,
		Namespace: namespace,
	})

	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	response, err := client.DeleteRouterToken(ctx, request)
	if err != nil {
		return fmt.Errorf("failed to delete token: %w", err)
	}

	if response.Msg.GetResponse().Code != common.EnumStatusCode_OK {
		return fmt.Errorf("failed to delete token: %s", response.Msg.GetResponse().GetDetails())
	}

	return nil
}
