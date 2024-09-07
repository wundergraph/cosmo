package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/api"
)

type SubgraphResource struct {
	provider *Provider
}

type SubgraphResourceModel struct {
	Id               types.String `tfsdk:"id"`
	Name             types.String `tfsdk:"name"`
	Namespace        types.String `tfsdk:"namespace"`
	RoutingUrl       types.String `tfsdk:"routing_url"`
	BaseSubgraphName types.String `tfsdk:"base_subgraph_name"`
}

func NewSubgraphResource() resource.Resource {
	return &SubgraphResource{}
}

func (r *SubgraphResource) Configure(_ context.Context, req resource.ConfigureRequest, _ *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	r.provider = req.ProviderData.(*Provider)
}

func (r *SubgraphResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_subgraph"
}

func (r *SubgraphResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed: true,
			},
			"name": schema.StringAttribute{
				Required: true,
			},
			"namespace": schema.StringAttribute{
				Required: true,
			},
			"routing_url": schema.StringAttribute{
				Required: true,
			},
			"base_subgraph_name": schema.StringAttribute{
				Required: true,
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

	name := data.Name.ValueString()
	namespace := data.Namespace.ValueString()
	routingUrl := data.RoutingUrl.ValueString()
	var baseSubgraphName *string
	if !data.BaseSubgraphName.IsNull() {
		baseSubgraphNameValue := data.BaseSubgraphName.ValueString()
		baseSubgraphName = &baseSubgraphNameValue
	}

	err := api.CreateSubgraph(ctx, r.provider.client, r.provider.cosmoApiKey, name, namespace, routingUrl, baseSubgraphName)
	if err != nil {
		addDiagnosticErrorForCreate(resp, "Error creating subgraph", fmt.Sprintf("Could not create subgraph: %s", err))
		return
	}

	// After creation, fetch the subgraph to ensure we have the most up-to-date data
	subgraph, err := api.GetSubgraph(ctx, r.provider.client, r.provider.cosmoApiKey, name, namespace)
	if err != nil {
		addDiagnosticErrorForCreate(resp, "Error reading subgraph", fmt.Sprintf("Could not read subgraph after creation: %s", err))
		return
	}

	// Update the resource data with the fetched information
	data.Id = types.StringValue(subgraph.Id)
	data.Name = types.StringValue(subgraph.Name)
	data.Namespace = types.StringValue(subgraph.Namespace)
	data.RoutingUrl = types.StringValue(subgraph.RoutingURL)

	if subgraph.BaseSubgraphName != nil {
		data.BaseSubgraphName = types.StringValue(*subgraph.BaseSubgraphName)
	} else {
		// If the API returns nil for BaseSubgraphName, use the value from the configuration
		data.BaseSubgraphName = types.StringValue(*baseSubgraphName)
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *SubgraphResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var data SubgraphResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	name := data.Name.ValueString()
	namespace := data.Namespace.ValueString()

	subgraph, err := api.GetSubgraph(ctx, r.provider.client, r.provider.cosmoApiKey, name, namespace)
	if err != nil {
		addDiagnosticErrorForRead(resp, "Error reading subgraph", fmt.Sprintf("Could not read subgraph: %s", err))
		return
	}

	data.Id = types.StringValue(subgraph.Id)
	data.Name = types.StringValue(subgraph.Name)
	data.Namespace = types.StringValue(subgraph.Namespace)
	data.RoutingUrl = types.StringValue(subgraph.RoutingURL)

	if subgraph.BaseSubgraphName != nil {
		data.BaseSubgraphName = types.StringValue(*subgraph.BaseSubgraphName)
	} else {
		// If the API returns nil for BaseSubgraphName, keep the existing value
		// This ensures we don't overwrite the value with null
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *SubgraphResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var data SubgraphResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	name := data.Name.ValueString()
	namespace := data.Namespace.ValueString()
	routingUrl := data.RoutingUrl.ValueString()

	err := api.UpdateSubgraph(
		ctx,
		r.provider.client,
		r.provider.cosmoApiKey,
		name,
		namespace,
		routingUrl,
		nil, // labels
		nil, // headers
		nil, // subscriptionUrl
		nil, // readme
		nil, // unsetLabels
	)
	if err != nil {
		addDiagnosticErrorForUpdate(resp, "Error updating subgraph", fmt.Sprintf("Could not update subgraph: %s", err))
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *SubgraphResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var data SubgraphResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	name := data.Name.ValueString()
	namespace := data.Namespace.ValueString()

	err := api.DeleteSubgraph(ctx, r.provider.client, r.provider.cosmoApiKey, name, namespace)
	if err != nil {
		addDiagnosticErrorForDelete(resp, "Error deleting subgraph", fmt.Sprintf("Could not delete subgraph: %s", err))
		return
	}
}
