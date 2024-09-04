package provider

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// Ensure provider defined types fully satisfy framework interfaces.
var _ datasource.DataSource = &FederatedGraphDataSource{}

func NewFederatedGraphDataSource() datasource.DataSource {
	return &FederatedGraphDataSource{}
}

// FederatedGraphDataSource defines the data source implementation.
type FederatedGraphDataSource struct {
	client *http.Client
}

// FederatedGraphDataSourceModel describes the data source data model.
type FederatedGraphDataSourceModel struct {
	GraphId    types.String `tfsdk:"graph_id"`   // Added `graph_id` to the struct
	GraphName  types.String `tfsdk:"graph_name"` // Graph name attribute
	ServiceUrl types.String `tfsdk:"service_url"` // Service URL attribute
	Id         types.String `tfsdk:"id"`         // Resource ID attribute
}

func (d *FederatedGraphDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_federated_graph"
}

func (d *FederatedGraphDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Cosmo Federated Graph Data Source",

		Attributes: map[string]schema.Attribute{
			"graph_id": schema.StringAttribute{
				MarkdownDescription: "ID of the federated graph",
				Required:            true,
			},
			"graph_name": schema.StringAttribute{
				MarkdownDescription: "Name of the federated graph",
				Required:            true,
			},
			"service_url": schema.StringAttribute{
				MarkdownDescription: "Service URL for the federated graph",
				Optional:            true,
			},
			"id": schema.StringAttribute{
				MarkdownDescription: "Computed ID for the resource",
				Computed:            true,
			},
		},
	}
}

func (d *FederatedGraphDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	// Prevent panic if the provider has not been configured.
	if req.ProviderData == nil {
		return
	}

	client, ok := req.ProviderData.(*http.Client)

	if !ok {
		resp.Diagnostics.AddError(
			"Unexpected Data Source Configure Type",
			fmt.Sprintf("Expected *http.Client, got: %T. Please report this issue to the provider developers.", req.ProviderData),
		)

		return
	}

	d.client = client
}

func (d *FederatedGraphDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var data FederatedGraphDataSourceModel

	// Read Terraform configuration data into the model
	resp.Diagnostics.Append(req.Config.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	// Simulate retrieving data for the federated graph
	// You should replace this with the actual API call logic
	// For example:
	// httpResp, err := d.client.Get(serviceURL)
	// if err != nil {
	//     resp.Diagnostics.AddError("Client Error", fmt.Sprintf("Unable to retrieve data for federated graph, got error: %s", err))
	//     return
	// }

	// Hardcoding a response value to simulate an API response
	data.Id = types.StringValue("cosmo-federated-graph-id")

	// Log activity using tflog
	tflog.Trace(ctx, "retrieved federated graph data source")

	// Save data into Terraform state
	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
