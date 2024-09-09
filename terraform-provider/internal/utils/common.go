package utils

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

const (
	EnvCosmoApiUrl = "COSMO_API_URL"
	EnvCosmoApiKey = "COSMO_API_KEY"
)

// convertLabelMatchers converts a Terraform list of strings to a slice of strings for use in the gRPC request.
func ConvertLabelMatchers(labelMatchersList types.List) ([]string, error) {
	var labelMatchers []string
	if labelMatchersList.IsNull() {
		return nil, nil
	}

	for _, matcher := range labelMatchersList.Elements() {
		strVal, ok := matcher.(types.String)
		if !ok {
			return nil, fmt.Errorf("expected string type in label_matchers, got: %T", matcher)
		}
		labelMatchers = append(labelMatchers, strVal.ValueString())
	}

	return labelMatchers, nil
}

func ConvertAndValidateLabelMatchers(data types.List, resp interface{}) ([]string, error) {
	labelMatchers, err := ConvertLabelMatchers(data)
	if err != nil {
		switch r := resp.(type) {
		case *resource.CreateResponse:
			AddDiagnosticError(r, "Invalid Label Matchers", fmt.Sprintf("Error converting label matchers: %s", err))
		case *resource.UpdateResponse:
			AddDiagnosticError(r, "Invalid Label Matchers", fmt.Sprintf("Error converting label matchers: %s", err))
		case *resource.DeleteResponse:
			AddDiagnosticError(r, "Invalid Label Matchers", fmt.Sprintf("Error converting label matchers: %s", err))
		case *resource.ReadResponse:
			AddDiagnosticError(r, "Invalid Label Matchers", fmt.Sprintf("Error converting label matchers: %s", err))
		default:
			fmt.Printf("Unhandled response type: %T\n", resp)
		}
	}
	return labelMatchers, err
}

// Generalized function for adding errors to diagnostics
func AddDiagnosticError(resp interface{}, title, message string) {
	switch r := resp.(type) {
	case *resource.CreateResponse:
		r.Diagnostics.AddError(title, message)
	case *resource.UpdateResponse:
		r.Diagnostics.AddError(title, message)
	case *resource.DeleteResponse:
		r.Diagnostics.AddError(title, message)
	case *resource.ReadResponse:
		r.Diagnostics.AddError(title, message)
	case *provider.ConfigureResponse:
		r.Diagnostics.AddError(title, message)
	case *resource.SchemaResponse:
		r.Diagnostics.AddError(title, message)
	case *resource.ConfigureResponse:
		r.Diagnostics.AddError(title, message)
	case *resource.ImportStateResponse:
		r.Diagnostics.AddError(title, message)
	case *datasource.ReadResponse:
		r.Diagnostics.AddError(title, message)
	case *datasource.ConfigureResponse:
		r.Diagnostics.AddError(title, message)
	case *datasource.SchemaResponse:
		r.Diagnostics.AddError(title, message)
	default:
		panic(fmt.Sprintf("Unhandled response type: %T", resp))
	}
}

// Centralized logging function
func LogAction(ctx context.Context, action, resourceID, name, namespace string) {
	tflog.Trace(ctx, fmt.Sprintf("%s federated graph resource", action), map[string]interface{}{
		"id":        resourceID,
		"name":      name,
		"namespace": namespace,
	})
}
