// Copyright (c) HashiCorp, Inc.
// SPDX-License-Identifier: MPL-2.0

package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/function"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/client"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/utils"

	// service
	federated_graph "github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/service/federated-graph"
	monograph "github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/service/monograph"
	namespace "github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/service/namespace"
	router_token "github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/service/router-token"
	subgraph "github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/service/subgraph"
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
	*client.PlatformClient
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
				MarkdownDescription: fmt.Sprintf("The Api Url to be used: %s", utils.EnvCosmoApiUrl),
				Optional:            true,
			},
			"cosmo_api_key": schema.StringAttribute{
				MarkdownDescription: fmt.Sprintf("The Api Key to be used: %s", utils.EnvCosmoApiKey),
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

	cosmoApiKey := data.CosmoApiKey.ValueString()
	cosmoApiUrl := data.CosmoApiUrl.ValueString()

	providerConfig, err := client.NewClient(cosmoApiKey, cosmoApiUrl)

	if err != nil {
		utils.AddDiagnosticError(resp, "Error configuring client", err.Error())
		return
	}
	resp.DataSourceData = providerConfig
	resp.ResourceData = providerConfig
}

func (p *CosmoProvider) Resources(ctx context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		federated_graph.NewFederatedGraphResource,
		namespace.NewNamespaceResource,
		subgraph.NewSubgraphResource,
		monograph.NewMonographResource,
		router_token.NewTokenResource,
	}
}

func (p *CosmoProvider) DataSources(ctx context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{
		federated_graph.NewFederatedGraphDataSource,
		subgraph.NewSubgraphDataSource,
		namespace.NewNamespaceDataSource,
		monograph.NewMonographDataSource,
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
