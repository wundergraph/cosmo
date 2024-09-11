package namespace

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	platformv1 "github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1/platformv1connect"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/api"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/client"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/utils"
)

type NamespaceResource struct {
	*client.PlatformClient
}

type NamespaceResourceModel struct {
	Id   types.String `tfsdk:"id"`
	Name types.String `tfsdk:"name"`
}

func NewNamespaceResource() resource.Resource {
	return &NamespaceResource{}
}

func (r *NamespaceResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}

	client, ok := req.ProviderData.(*client.PlatformClient)
	if !ok {
		utils.AddDiagnosticError(resp, ErrUnexpectedDataSourceType, fmt.Sprintf("Expected *client.PlatformClient, got: %T. Please report this issue to the provider developers.", req.ProviderData))
		return
	}

	r.PlatformClient = client
}

func (r *NamespaceResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_namespace"
}

func (r *NamespaceResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Cosmo Namespace Resource",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed:            true,
				MarkdownDescription: "The unique identifier of the namespace resource.",
			},
			"name": schema.StringAttribute{
				Required:            true,
				MarkdownDescription: "The name of the namespace.",
			},
		},
	}
}

func (r *NamespaceResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var data NamespaceResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	if data.Name.IsNull() || data.Name.ValueString() == "" {
		utils.AddDiagnosticError(resp, ErrInvalidNamespaceName, "The 'name' attribute is required.")
		return
	}

	err := api.CreateNamespace(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrCreatingNamespace, fmt.Sprintf("Could not create namespace: %s, name: %s", err, data.Name.ValueString()))
		return
	}

	namespace, err := getNamespaceByName(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrReadingNamespace, err.Error())
		return
	}

	data.Id = types.StringValue(namespace.Id)
	data.Name = types.StringValue(namespace.Name)

	utils.LogAction(ctx, "created", data.Id.ValueString(), data.Name.ValueString(), "")

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *NamespaceResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var data NamespaceResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	namespace, err := getNamespaceByName(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrReadingNamespace, err.Error())
		return
	}

	data.Id = types.StringValue(namespace.Id)
	data.Name = types.StringValue(namespace.Name)

	utils.LogAction(ctx, "read", data.Id.ValueString(), data.Name.ValueString(), "")

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *NamespaceResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var data NamespaceResourceModel
	var state NamespaceResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	if data.Name.ValueString() != state.Name.ValueString() {
		utils.AddDiagnosticError(resp, ErrUpdatingNamespace, "Changing the namespace name requires recreation.")
		return
	}

	namespace, err := getNamespaceByName(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrReadingNamespace, err.Error())
		return
	}

	err = api.RenameNamespace(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, namespace.Name, data.Name.String())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrUpdatingNamespace, fmt.Sprintf("Could not update namespace: %s", err))
		return
	}

	utils.LogAction(ctx, "updated", data.Id.ValueString(), data.Name.ValueString(), "")

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *NamespaceResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var data NamespaceResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	err := api.DeleteNamespace(ctx, r.PlatformClient.Client, r.PlatformClient.CosmoApiKey, data.Name.ValueString())
	if err != nil {
		utils.AddDiagnosticError(resp, ErrDeletingNamespace, fmt.Sprintf("Could not delete namespace: %s", err))
		return
	}

	utils.LogAction(ctx, "deleted", data.Id.ValueString(), data.Name.ValueString(), "")
}

func getNamespaceByName(ctx context.Context, client platformv1connect.PlatformServiceClient, cosmoApiKey string, name string) (*platformv1.Namespace, error) {
	namespaces, err := api.ListNamespaces(ctx, client, cosmoApiKey)
	if err != nil {
		return nil, fmt.Errorf("could not list namespaces: %w", err)
	}

	for _, namespace := range namespaces {
		if namespace.Name == name {
			return namespace, nil
		}
	}

	return nil, fmt.Errorf("namespace with name '%s' not found", name)
}

func (r *NamespaceResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}
