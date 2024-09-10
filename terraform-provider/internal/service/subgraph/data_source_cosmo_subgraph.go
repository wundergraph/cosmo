package subgraph

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/api"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/client"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/utils"
)

// Ensure provider defined types fully satisfy framework interfaces.
var _ datasource.DataSource = &SubgraphDataSource{}

func NewSubgraphDataSource() datasource.DataSource {
	return &SubgraphDataSource{}
}

// SubgraphDataSource defines the data source implementation.
type SubgraphDataSource struct {
	*client.PlatformClient
}

// SubgraphDataSourceModel describes the data source data model.
type SubgraphDataSourceModel struct {
	Id         types.String `tfsdk:"id"`
	Name       types.String `tfsdk:"name"`
	Namespace  types.String `tfsdk:"namespace"`
	RoutingUrl types.String `tfsdk:"routing_url"`
}

func (d *SubgraphDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_subgraph"
}

func (d *SubgraphDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Cosmo Subgraph Data Source",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed:            true,
				MarkdownDescription: "The unique identifier of the subgraph resource.",
			},
			"name": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "The name of the subgraph.",
			},
			"namespace": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "The namespace in which the subgraph is located.",
			},
			"routing_url": schema.StringAttribute{
				Computed:            true,
				MarkdownDescription: "The routing URL of the subgraph.",
			},
		},
	}
}

func (d *SubgraphDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}

	client, ok := req.ProviderData.(*client.PlatformClient)
	if !ok {
		utils.AddDiagnosticError(resp, "Unexpected Data Source Configure Type", fmt.Sprintf("Expected *http.Client, got: %T. Please report this issue to the provider developers.", req.ProviderData))
		return
	}

	d.PlatformClient = client
}

func (d *SubgraphDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var data SubgraphDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	if data.Name.IsNull() || data.Name.ValueString() == "" {
		utils.AddDiagnosticError(resp, "Invalid Subgraph Name", "The 'name' attribute is required.")
		return
	}
	if data.Namespace.IsNull() || data.Namespace.ValueString() == "" {
		utils.AddDiagnosticError(resp, "Invalid Namespace", "The 'namespace' attribute is required.")
		return
	}

	subgraph, err := api.GetSubgraph(ctx, d.PlatformClient.Client, d.PlatformClient.CosmoApiKey, data.Name.ValueString(), data.Namespace.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, "Error Reading Subgraph", fmt.Sprintf("Could not read subgraph: %s", err))
		return
	}

	data.Id = types.StringValue(subgraph.Id)
	data.Name = types.StringValue(subgraph.Name)
	data.Namespace = types.StringValue(subgraph.Namespace)
	data.RoutingUrl = types.StringValue(subgraph.RoutingURL)

	tflog.Trace(ctx, "Read subgraph data source", map[string]interface{}{
		"id": data.Id.ValueString(),
	})

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
