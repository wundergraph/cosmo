// Copyright (c) HashiCorp, Inc.
// SPDX-License-Identifier: MPL-2.0

package provider

import (
	"context"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/function"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
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

// CosmoProviderModel describes the provider data model.
type CosmoProviderModel struct {
	Endpoint types.String `tfsdk:"endpoint"`
}

func (p *CosmoProvider) Metadata(ctx context.Context, req provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "cosmo"
	resp.Version = p.version
}

func (p *CosmoProvider) Schema(ctx context.Context, req provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"endpoint": schema.StringAttribute{
				MarkdownDescription: "Example provider attribute",
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

	// Configuration values are now available.
	// if data.Endpoint.IsNull() { /* ... */ }

	// Example client configuration for data sources and resources
	client := http.DefaultClient
	resp.DataSourceData = client
	resp.ResourceData = client
}

func (p *CosmoProvider) Resources(ctx context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		NewFederatedGraphResource,
	}
}

func (p *CosmoProvider) DataSources(ctx context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{
		NewFederatedGraphDataSource,
	}
}

func (p *CosmoProvider) Functions(ctx context.Context) []func() function.Function {
	return []func() function.Function{
	}
}

func New(version string) func() provider.Provider {
	return func() provider.Provider {
		return &CosmoProvider{
			version: version,
		}
	}
}
