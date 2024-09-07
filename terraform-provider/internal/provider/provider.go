// Copyright (c) HashiCorp, Inc.
// SPDX-License-Identifier: MPL-2.0

package provider

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/function"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1/platformv1connect"
)

// Ensure CosmoProvider satisfies various provider interfaces.
var _ provider.Provider = &CosmoProvider{}
var _ provider.ProviderWithFunctions = &CosmoProvider{}

// CosmoProvider defines the provider implementation.
type CosmoProvider struct {
	// version is set to the provider version on release, "dev" when the
	// provider is built and ran locally, and "test" when running acceptance
	// testing.
	version string
}

type Provider struct {
	client      platformv1connect.PlatformServiceClient
	cosmoApiKey string
}

// CosmoProviderModel describes the provider data model.
type CosmoProviderModel struct {
	CosmoApiUrl types.String `tfsdk:"cosmo_api_url"`
	CosmoApiKey types.String `tfsdk:"cosmo_api_key"`
}

func (p *CosmoProvider) Metadata(ctx context.Context, req provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "cosmo"
	resp.Version = p.version
}

func (p *CosmoProvider) Schema(ctx context.Context, req provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"cosmo_api_url": schema.StringAttribute{
				MarkdownDescription: fmt.Sprintf("The Api Url to be used: %s", envCosmoApiUrl),
				Optional:            true,
			},
			"cosmo_api_key": schema.StringAttribute{
				MarkdownDescription: fmt.Sprintf("The Api Key to be used: %s", envCosmoApiKey),
				Optional:            true,
			},
		},
	}
}

func (p *CosmoProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var data CosmoProviderModel

	resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}
	providerConfig, err := NewClient()

	if err != nil {
		addDiagnosticErrorForConfigure(resp, "Error configuring client", err.Error())
		return
	}
	resp.DataSourceData = providerConfig
	resp.ResourceData = providerConfig
}

func (p *CosmoProvider) Resources(ctx context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		NewFederatedGraphResource,
		NewNamespaceResource,
		NewSubgraphResource,
	}
}

func (p *CosmoProvider) DataSources(ctx context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{
		NewFederatedGraphDataSource,
	}
}

func (p *CosmoProvider) Functions(ctx context.Context) []func() function.Function {
	return []func() function.Function{}
}

func New(version string) func() provider.Provider {
	return func() provider.Provider {
		return &CosmoProvider{
			version: version,
		}
	}
}

func NewClient() (*Provider, error) {
	cosmoApiKey, ok := os.LookupEnv(envCosmoApiKey)
	if !ok {
		return nil, fmt.Errorf("COSMO_API_KEY environment variable not set")
	}

	cosmoApiUrl, ok := os.LookupEnv(envCosmoApiUrl)
	if !ok {
		return nil, fmt.Errorf("COSMO_API_URL environment variable not set")
	}

	httpClient := http.Client{}
	httpClient.Transport = &http.Transport{
		Proxy: http.ProxyFromEnvironment,
	}

	client := platformv1connect.NewPlatformServiceClient(&httpClient, cosmoApiUrl)
	return &Provider{
		client:      client,
		cosmoApiKey: cosmoApiKey,
	}, nil
}
