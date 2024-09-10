package services

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/common"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/api"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/client"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/utils"
)

type MonographResource struct {
	*client.PlatformClient
}

type MonographResourceModel struct {
	Id                   types.String `tfsdk:"id"`
	Name                 types.String `tfsdk:"name"`
	Namespace            types.String `tfsdk:"namespace"`
	SubscriptionUrl      types.String `tfsdk:"subscription_url"`
	WebsocketSubprotocol types.String `tfsdk:"websocket_subprotocol"`
	GraphUrl             types.String `tfsdk:"graph_url"`
	RoutingURL           types.String `tfsdk:"routing_url"`
	Readme               types.String `tfsdk:"readme"`
}

func NewMonographResource() resource.Resource {
	return &MonographResource{}
}

func (r *MonographResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_monograph"
}

func (r *MonographResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Cosmo Monograph Resource",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed:            true,
				MarkdownDescription: "The unique identifier of the monograph resource.",
			},
			"name": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "The name of the monograph.",
			},
			"namespace": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "The namespace in which the monograph is located.",
			},
			"graph_url": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "The GraphQL endpoint URL of the monograph.",
			},
			"websocket_subprotocol": schema.StringAttribute{
				Optional:            true,
				MarkdownDescription: "The websocket subprotocol for the subgraph.",
			},
			"routing_url": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "The routing URL for the monograph.",
			},
			"readme": schema.StringAttribute{
				Optional:            true,
				MarkdownDescription: "The readme for the subgraph.",
			},
			"subscription_url": schema.StringAttribute{
				Optional:            true,
				MarkdownDescription: "The subscription URL for the subgraph.",
			},
		},
	}
}

func (r *MonographResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}

	client, ok := req.ProviderData.(*client.PlatformClient)
	if !ok {
		utils.AddDiagnosticError(resp, "Unexpected Data Source Configure Type", fmt.Sprintf("Expected *http.Client, got: %T. Please report this issue to the provider developers.", req.ProviderData))
		return
	}

	r.PlatformClient = client
}

func (r *MonographResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var data MonographResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	var websocketSubprotocol *int32

	if !data.WebsocketSubprotocol.IsNull() {
		protocol := common.GraphQLWebsocketSubprotocol(common.GraphQLWebsocketSubprotocol_value[data.WebsocketSubprotocol.ValueString()])
		websocketSubprotocol = (*int32)(&protocol)
	}

	err := api.CreateMonograph(
		ctx,
		r.PlatformClient.Client,
		r.PlatformClient.CosmoApiKey,
		data.Name.ValueString(),
		data.Namespace.ValueString(),
		data.RoutingURL.ValueString(),
		data.GraphUrl.ValueString(),
		utils.StringValueOrNil(data.SubscriptionUrl),
		utils.StringValueOrNil(data.Readme),
		websocketSubprotocol,
	)
	if err != nil {
		utils.AddDiagnosticError(resp, "Error Creating Monograph", fmt.Sprintf("Could not create monograph: %s", err))
		return
	}

	monograph, err := api.GetMonograph(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString(), data.Namespace.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, "Error Fetching Created Monograph", fmt.Sprintf("Could not fetch created monograph: %s", err))
		return
	}

	data.Id = types.StringValue(monograph.Id)
	if monograph.Readme != nil {
		data.Readme = types.StringValue(*monograph.Readme)
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *MonographResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var data MonographResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	monograph, err := api.GetMonograph(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString(), data.Namespace.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, "Error Reading Monograph", fmt.Sprintf("Could not read monograph: %s", err))
		return
	}

	data.Id = types.StringValue(monograph.Id)
	data.Name = types.StringValue(monograph.Name)
	data.Namespace = types.StringValue(monograph.Namespace)
	data.RoutingURL = types.StringValue(monograph.RoutingURL)

	if monograph.Readme != nil {
		data.Readme = types.StringValue(*monograph.Readme)
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *MonographResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var data MonographResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	var websocketSubprotocol *int32

	if !data.WebsocketSubprotocol.IsNull() {
		protocol := common.GraphQLWebsocketSubprotocol(common.GraphQLWebsocketSubprotocol_value[data.WebsocketSubprotocol.ValueString()])
		websocketSubprotocol = (*int32)(&protocol)
	}

	err := api.UpdateMonograph(
		ctx,
		r.PlatformClient.Client,
		r.PlatformClient.CosmoApiKey,
		data.Name.ValueString(),
		data.Namespace.ValueString(),
		data.RoutingURL.ValueString(),
		data.GraphUrl.ValueString(),
		utils.StringValueOrNil(data.SubscriptionUrl),
		utils.StringValueOrNil(data.Readme),
		websocketSubprotocol,
	)
	if err != nil {
		utils.AddDiagnosticError(resp, "Error Updating Monograph", fmt.Sprintf("Could not update monograph: %s", err))
		return
	}

	monograph, err := api.GetMonograph(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString(), data.Namespace.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, "Error Fetching Updated Monograph", fmt.Sprintf("Could not fetch updated monograph: %s", err))
		return
	}

	data.Id = types.StringValue(monograph.Id)

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *MonographResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var data MonographResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	err := api.DeleteMonograph(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString(), data.Namespace.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, "Error Deleting Monograph", fmt.Sprintf("Could not delete monograph: %s", err))
		return
	}
}