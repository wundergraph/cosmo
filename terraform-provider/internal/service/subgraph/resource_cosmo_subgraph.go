package subgraph

import (
	"context"
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
	platformv1 "github.com/wundergraph/cosmo/connect-go/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/api"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/client"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/utils"
)

type SubgraphResource struct {
	*client.PlatformClient
}

type SubgraphResourceModel struct {
	Id                   types.String `tfsdk:"id"`
	Name                 types.String `tfsdk:"name"`
	Namespace            types.String `tfsdk:"namespace"`
	RoutingURL           types.String `tfsdk:"routing_url"`
	BaseSubgraphName     types.String `tfsdk:"base_subgraph_name"`
	SubscriptionUrl      types.String `tfsdk:"subscription_url"`
	SubscriptionProtocol types.String `tfsdk:"subscription_protocol"`
	WebsocketSubprotocol types.String `tfsdk:"websocket_subprotocol"`
	Readme               types.String `tfsdk:"readme"`
	IsEventDrivenGraph   types.Bool   `tfsdk:"is_event_driven_graph"`
	IsFeatureSubgraph    types.Bool   `tfsdk:"is_feature_subgraph"`
	UnsetLabels          types.Bool   `tfsdk:"unset_labels"`
	Headers              types.List   `tfsdk:"headers"`
	Labels               types.List   `tfsdk:"labels"`
}

func NewSubgraphResource() resource.Resource {
	return &SubgraphResource{}
}

func (r *SubgraphResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}

	client, ok := req.ProviderData.(*client.PlatformClient)
	if !ok {
		utils.AddDiagnosticError(resp, ErrUnexpectedDataSourceType, fmt.Sprintf("Expected *http.Client, got: %T. Please report this issue to the provider developers.", req.ProviderData))
		return
	}

	r.PlatformClient = client
}

func (r *SubgraphResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_subgraph"
}

func (r *SubgraphResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Cosmo Subgraph Resource",
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
				Required:            true,
				MarkdownDescription: "The routing URL of the subgraph.",
			},
			"base_subgraph_name": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "The base subgraph name.",
			},
			"subscription_url": schema.StringAttribute{
				Optional:            true,
				MarkdownDescription: "The subscription URL for the subgraph.",
			},
			"subscription_protocol": schema.StringAttribute{
				Optional:            true,
				MarkdownDescription: "The subscription protocol for the subgraph.",
				Validators: []validator.String{
					stringvalidator.OneOf(api.GraphQLSubscriptionProtocolWS, api.GraphQLSubscriptionProtocolSSE, api.GraphQLSubscriptionProtocolSSEPost),
				},
			},
			"readme": schema.StringAttribute{
				Optional:            true,
				MarkdownDescription: "The readme for the subgraph.",
			},
			"websocket_subprotocol": schema.StringAttribute{
				Optional:            true,
				MarkdownDescription: "The websocket subprotocol for the subgraph.",
				Validators: []validator.String{
					stringvalidator.OneOf(api.GraphQLWebsocketSubprotocolDefault, api.GraphQLWebsocketSubprotocolGraphQLWS, api.GraphQLWebsocketSubprotocolGraphQLTransportWS),
				},
			},
			"is_event_driven_graph": schema.BoolAttribute{
				Optional:            true,
				MarkdownDescription: "Indicates if the subgraph is event-driven.",
			},
			"is_feature_subgraph": schema.BoolAttribute{
				Optional:            true,
				MarkdownDescription: "Indicates if the subgraph is a feature subgraph.",
			},
			"headers": schema.ListAttribute{
				Optional:            true,
				MarkdownDescription: "Headers for the subgraph.",
				ElementType:         types.StringType,
			},
			"unset_labels": schema.BoolAttribute{
				Optional:            true,
				MarkdownDescription: "Unset labels for the subgraph.",
			},
			"labels": schema.ListAttribute{
				Optional:            true,
				MarkdownDescription: "Labels for the subgraph.",
				ElementType:         types.StringType,
			},
		},
	}
}

func (r *SubgraphResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var data SubgraphResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	stringLabels, err := utils.ConvertAndValidateLabelMatchers(data.Labels, resp)
	if err != nil {
		return
	}

	var labels []*platformv1.Label
	for _, label := range stringLabels {
		labelParts := strings.Split(label, "=")
		labels = append(labels, &platformv1.Label{
			Key:   labelParts[0],
			Value: labelParts[1],
		})
	}

	err = api.CreateSubgraph(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString(), data.Namespace.ValueString(), data.RoutingURL.ValueString(), data.BaseSubgraphName.ValueStringPointer(), labels, data.SubscriptionUrl.ValueStringPointer(), data.Readme.ValueStringPointer(), data.IsEventDrivenGraph.ValueBoolPointer(), data.IsFeatureSubgraph.ValueBoolPointer(), data.SubscriptionProtocol.ValueString(), data.WebsocketSubprotocol.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrCreatingSubgraph, fmt.Sprintf("Could not create subgraph '%s': %s", data.Name.ValueString(), err))
		return
	}

	subgraph, err := api.GetSubgraph(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString(), data.Namespace.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrRetrievingSubgraph, fmt.Sprintf("Could not fetch created subgraph '%s': %s", data.Name.ValueString(), err))
		return
	}

	data.Id = types.StringValue(subgraph.GetId())
	data.Name = types.StringValue(subgraph.GetName())
	data.Namespace = types.StringValue(subgraph.GetNamespace())
	data.RoutingURL = types.StringValue(subgraph.GetRoutingURL())

	utils.LogAction(ctx, "created", data.Id.ValueString(), data.Name.ValueString(), data.Namespace.ValueString())

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *SubgraphResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var data SubgraphResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	subgraph, err := api.GetSubgraph(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString(), data.Namespace.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrRetrievingSubgraph, fmt.Sprintf("Could not read subgraph '%s': %s", data.Name.ValueString(), err))
		return
	}

	data.Id = types.StringValue(subgraph.GetId())
	data.Name = types.StringValue(subgraph.GetName())
	data.Namespace = types.StringValue(subgraph.GetNamespace())
	data.RoutingURL = types.StringValue(subgraph.GetRoutingURL())

	utils.LogAction(ctx, "read", data.Id.ValueString(), data.Name.ValueString(), data.Namespace.ValueString())

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *SubgraphResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var data SubgraphResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	stringLabels, err := utils.ConvertAndValidateLabelMatchers(data.Labels, resp)
	if err != nil {
		return
	}

	var labels []*platformv1.Label
	for _, label := range stringLabels {
		labelParts := strings.Split(label, "=")
		labels = append(labels, &platformv1.Label{
			Key:   labelParts[0],
			Value: labelParts[1],
		})
	}

	var unsetLabels *bool
	if data.UnsetLabels.ValueBool() {
		unsetLabels = &[]bool{true}[0]
	}

	headers := utils.ConvertHeadersToStringList(data.Headers)
	err = api.UpdateSubgraph(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString(), data.Namespace.ValueString(), data.RoutingURL.ValueString(), labels, headers, data.SubscriptionUrl.ValueStringPointer(), data.Readme.ValueStringPointer(), unsetLabels, data.SubscriptionProtocol.ValueString(), data.WebsocketSubprotocol.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrUpdatingSubgraph, fmt.Sprintf("Could not update subgraph '%s': %s", data.Name.ValueString(), err))
		return
	}

	subgraph, err := api.GetSubgraph(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString(), data.Namespace.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrRetrievingSubgraph, fmt.Sprintf("Could not fetch updated subgraph '%s': %s", data.Name.ValueString(), err))
		return
	}

	data.Id = types.StringValue(subgraph.GetId())
	data.Name = types.StringValue(subgraph.GetName())
	data.Namespace = types.StringValue(subgraph.GetNamespace())
	data.RoutingURL = types.StringValue(subgraph.GetRoutingURL())

	utils.LogAction(ctx, "updated", data.Id.ValueString(), data.Name.ValueString(), data.Namespace.ValueString())

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *SubgraphResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var data SubgraphResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	err := api.DeleteSubgraph(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString(), data.Namespace.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrDeletingSubgraph, fmt.Sprintf("Could not delete subgraph '%s': %s", data.Name.ValueString(), err))
		return
	}

	utils.LogAction(ctx, "deleted", data.Id.ValueString(), data.Name.ValueString(), data.Namespace.ValueString())
}

func (r *SubgraphResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}
