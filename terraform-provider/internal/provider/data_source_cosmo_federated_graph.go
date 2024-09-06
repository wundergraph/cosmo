package provider

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
	platform "github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1"
)

// Ensure provider defined types fully satisfy framework interfaces.
var _ datasource.DataSource = &FederatedGraphDataSource{}

func NewFederatedGraphDataSource() datasource.DataSource {
	return &FederatedGraphDataSource{}
}

// FederatedGraphDataSource defines the data source implementation.
type FederatedGraphDataSource struct {
	provider Provider
}

// FederatedGraphDataSourceModel describes the data source data model.
type FederatedGraphDataSourceModel struct {
	Name       types.String `tfsdk:"name"`
	Namespace  types.String `tfsdk:"namespace"`
	RoutingURL types.String `tfsdk:"routing_url"`
}

func (d *FederatedGraphDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_federated_graph"
}

func (d *FederatedGraphDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Cosmo Federated Graph Data Source",

		Attributes: map[string]schema.Attribute{
			"name": schema.StringAttribute{
				MarkdownDescription: "Name of the federated graph",
				Required:            true,
			},
			"namespace": schema.StringAttribute{
				MarkdownDescription: "The namespace in which the federated graph is located. Defaults to 'default' if not provided.",
				Optional:            true,
			},
			"routing_url": schema.StringAttribute{
				MarkdownDescription: "The URL of the federated graph service",
				Optional:            true,
			},
		},
	}
}

func (d *FederatedGraphDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	// Prevent panic if the provider has not been configured.
	if req.ProviderData == nil {
		return
	}

	provider, ok := req.ProviderData.(*Provider)
	if !ok {
		resp.Diagnostics.AddError(
			"Unexpected Data Source Configure Type",
			fmt.Sprintf("Expected *http.Client, got: %T. Please report this issue to the provider developers.", req.ProviderData),
		)

		return
	}

	d.provider = *provider
}

func (d *FederatedGraphDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var data FederatedGraphDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	if data.Name.IsNull() || data.Name.ValueString() == "" {
		resp.Diagnostics.AddError(
			"Invalid Federated Subgraph Name",
			"The 'name' attribute is required.",
		)
		return
	}

	var namespace string
	if data.Namespace.IsNull() || data.Namespace.ValueString() == "" {
		namespace = defaultNamespace
	} else {
		namespace = data.Namespace.ValueString()
	}

	name := data.Name.ValueString()
	request := connect.NewRequest(&platform.GetFederatedGraphByNameRequest{
		Name:      name,
		Namespace: namespace,
	})

	request.Header().Set("Authorization", fmt.Sprintf("Bearer %s", d.provider.cosmoApiKey))
	response, err := d.provider.client.GetFederatedGraphByName(ctx, request)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error creating federated subgraph",
			fmt.Sprintf("Could not create federated subgraph: %s", err),
		)
		return
	}

	tflog.Trace(ctx, "retrieved federated graph data source")
	data.Name = types.StringValue(response.Msg.Graph.Name)
	data.Namespace = types.StringValue(response.Msg.Graph.Namespace)
	data.RoutingURL = types.StringValue(response.Msg.Graph.RoutingURL)

	tflog.Trace(ctx, "retrieved federated graph data source")
	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
