package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	platformv1 "github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/gen/proto/wg/cosmo/platform/v1/platformv1connect"
	"github.com/wundergraph/cosmo/terraform-provider-cosmo/internal/api"
)

type NamespaceResource struct {
	provider *Provider
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
	r.provider = req.ProviderData.(*Provider)
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

	err := api.CreateNamespace(ctx, r.provider.client, r.provider.cosmoApiKey, data.Name.ValueString())
	if err != nil {
		addDiagnosticError(resp, "Error Creating Namespace", fmt.Sprintf("Could not create namespace: %s", err))
		return
	}

	namespace, err := getNamespaceByName(ctx, r.provider.client, r.provider.cosmoApiKey, data.Name.ValueString())
	if err != nil {
		addDiagnosticError(resp, "Error Reading Namespace", err.Error())
		return
	}

	data.Id = types.StringValue(namespace.Id)
	data.Name = types.StringValue(namespace.Name)

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *NamespaceResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var data NamespaceResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	namespace, err := getNamespaceByName(ctx, r.provider.client, r.provider.cosmoApiKey, data.Name.ValueString())
	if err != nil {
		addDiagnosticError(resp, "Error Reading Namespace", err.Error())
		return
	}

	data.Id = types.StringValue(namespace.Id)
	data.Name = types.StringValue(namespace.Name)

	resp.Diagnostics.Append(resp.State.Set(ctx, &data)...)
}

func (r *NamespaceResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var data NamespaceResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	namespace, err := getNamespaceByName(ctx, r.provider.client, r.provider.cosmoApiKey, data.Name.ValueString())
	if err != nil {
		addDiagnosticError(resp, "Error Reading Namespace", err.Error())
		return
	}

	err = api.RenameNamespace(ctx, r.provider.client, r.provider.cosmoApiKey, namespace.Name, data.Name.String())
	if err != nil {
		addDiagnosticError(resp, "Error Updating Namespace", fmt.Sprintf("Could not update namespace: %s", err))
		return
	}
}

func (r *NamespaceResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var data NamespaceResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &data)...)

	if resp.Diagnostics.HasError() {
		return
	}

	err := api.DeleteNamespace(ctx, r.provider.client, r.provider.cosmoApiKey, data.Name.ValueString())
	if err != nil {
		addDiagnosticError(resp, "Error Deleting Namespace", fmt.Sprintf("Could not delete namespace: %s", err))
		return
	}
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
