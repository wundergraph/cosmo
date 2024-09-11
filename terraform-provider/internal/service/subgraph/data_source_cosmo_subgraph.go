package subgraph

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/attr"
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
	Id                   types.String `tfsdk:"id"`
	Name                 types.String `tfsdk:"name"`
	Namespace            types.String `tfsdk:"namespace"`
	RoutingUrl           types.String `tfsdk:"routing_url"`
	BaseSubgraphName     types.String `tfsdk:"base_subgraph_name"`
	Labels               types.List   `tfsdk:"labels"`
	SubscriptionUrl      types.String `tfsdk:"subscription_url"`
	SubscriptionProtocol types.String `tfsdk:"subscription_protocol"`
	Readme               types.String `tfsdk:"readme"`
	WebsocketSubprotocol types.String `tfsdk:"websocket_subprotocol"`
	IsEventDrivenGraph   types.Bool   `tfsdk:"is_event_driven_graph"`
	IsFeatureSubgraph    types.Bool   `tfsdk:"is_feature_subgraph"`
	Headers              types.List   `tfsdk:"headers"`
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
			"base_subgraph_name": schema.StringAttribute{
				Computed:            true,
				MarkdownDescription: "The base subgraph name.",
			},
			"subscription_url": schema.StringAttribute{
				Computed:            true,
				MarkdownDescription: "The subscription URL for the subgraph.",
			},
			"subscription_protocol": schema.StringAttribute{
				Computed:            true,
				MarkdownDescription: "The subscription protocol for the subgraph.",
			},
			"readme": schema.StringAttribute{
				Computed:            true,
				MarkdownDescription: "The readme for the subgraph.",
			},
			"websocket_subprotocol": schema.StringAttribute{
				Computed:            true,
				MarkdownDescription: "The websocket subprotocol for the subgraph.",
			},
			"is_event_driven_graph": schema.BoolAttribute{
				Computed:            true,
				MarkdownDescription: "Indicates if the subgraph is event-driven.",
			},
			"is_feature_subgraph": schema.BoolAttribute{
				Computed:            true,
				MarkdownDescription: "Indicates if the subgraph is a feature subgraph.",
			},
			"headers": schema.ListAttribute{
				Computed:            true,
				MarkdownDescription: "Headers for the subgraph.",
				ElementType:         types.StringType,
			},
			"labels": schema.ListAttribute{
				Computed:            true,
				MarkdownDescription: "Labels for the subgraph.",
				ElementType:         types.StringType,
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

	data.Id = types.StringValue(subgraph.GetBaseSubgraphId())
	data.Name = types.StringValue(subgraph.GetName())
	data.Namespace = types.StringValue(subgraph.GetNamespace())
	data.RoutingUrl = types.StringValue(subgraph.GetRoutingURL())
	data.BaseSubgraphName = types.StringValue(subgraph.GetBaseSubgraphName())

	var labels []attr.Value
	for _, matcher := range subgraph.GetLabels() {
		labels = append(labels, types.StringValue(fmt.Sprintf("%s=%s", matcher.GetKey(), matcher.GetValue())))
	}

	data.Labels = types.ListValueMust(types.StringType, labels)
	data.Readme = types.StringValue(subgraph.GetReadme())
	data.IsEventDrivenGraph = types.BoolValue(subgraph.GetIsEventDrivenGraph())
	data.IsFeatureSubgraph = types.BoolValue(subgraph.GetIsFeatureSubgraph())
	data.SubscriptionProtocol = types.StringValue(subgraph.GetSubscriptionProtocol())
	data.WebsocketSubprotocol = types.StringValue(subgraph.GetWebsocketSubprotocol())

	tflog.Trace(ctx, "Read subgraph data source", map[string]interface{}{
		"id": data.Id.ValueString(),
	})

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}
