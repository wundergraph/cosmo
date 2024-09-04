package provider

import (
	"context"
	"fmt"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// Ensure provider defined types fully satisfy framework interfaces.
var _ resource.Resource = &FederatedGraphResource{}
var _ resource.ResourceWithImportState = &FederatedGraphResource{}

func NewFederatedGraphResource() resource.Resource {
	return &FederatedGraphResource{}
}

// FederatedGraphResource defines the resource implementation for federated graphs.
type FederatedGraphResource struct {
	client *http.Client
}

// FederatedGraphResourceModel describes the resource data model for a federated graph.
type FederatedGraphResourceModel struct {
	Id         types.String `tfsdk:"id"`          // This is now the primary ID
	GraphName  types.String `tfsdk:"graph_name"`  // Graph name attribute
	ServiceUrl types.String `tfsdk:"service_url"` // Service URL attribute
}

func (r *FederatedGraphResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_federated_graph"
}

func (r *FederatedGraphResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Federated Graph Resource for managing federated graphs",

		Attributes: map[string]schema.Attribute{
			"graph_name": schema.StringAttribute{
				MarkdownDescription: "Name of the federated graph",
				Optional:            true,
			},
			"service_url": schema.StringAttribute{
				MarkdownDescription: "Service URL for the federated graph",
				Optional:            true,
				Computed:            true,
				Default:             stringdefault.StaticString("https://default-service-url.com"),
			},
			"id": schema.StringAttribute{
				Computed:            true,
				MarkdownDescription: "Computed ID of the federated graph resource",
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
		},
	}
}

func (r *FederatedGraphResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	// Prevent panic if the provider has not been configured.
	if req.ProviderData == nil {
		return
	}

	client, ok := req.ProviderData.(*http.Client)

	if !ok {
		resp.Diagnostics.AddError(
			"Unexpected Resource Configure Type",
			fmt.Sprintf("Expected *http.Client, got: %T. Please report this issue to the provider developers.", req.ProviderData),
		)

		return
	}

	r.client = client
}

func (r *FederatedGraphResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var data FederatedGraphResourceModel

	// Read Terraform plan data into the model
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	// Simulate the creation of a federated graph, and generate an ID.
	// Replace this section with real API logic.
	data.Id = types.StringValue("federated-graph-id")

	// Log the creation of the resource
	tflog.Trace(ctx, "created a federated graph resource")

	// Save data into Terraform state
	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *FederatedGraphResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var data FederatedGraphResourceModel

	// Read Terraform prior state data into the model
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	// Example: Retrieve the federated graph by ID and update the data model.
	// Replace this section with real API logic.

	// Log the read operation
	tflog.Trace(ctx, "read a federated graph resource")

	// Save updated data into Terraform state
	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *FederatedGraphResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var data FederatedGraphResourceModel

	// Read Terraform plan data into the model
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	// Simulate updating the federated graph via an API
	// Replace this section with real API logic.

	// Log the update operation
	tflog.Trace(ctx, "updated a federated graph resource")

	// Save updated data into Terraform state
	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *FederatedGraphResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var data FederatedGraphResourceModel

	// Read Terraform prior state data into the model
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	// Simulate deleting the federated graph via an API
	// Replace this section with real API logic.

	// Log the delete operation
	tflog.Trace(ctx, "deleted a federated graph resource")
}

func (r *FederatedGraphResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	// Import the federated graph based on the ID
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}
