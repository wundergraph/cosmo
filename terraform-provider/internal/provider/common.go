package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

const (
	envCosmoApiUrl = "COSMO_API_URL"
	envCosmoApiKey = "COSMO_API_KEY"
)

// convertLabelMatchers converts a Terraform list of strings to a slice of strings for use in the gRPC request.
func convertLabelMatchers(labelMatchersList types.List) ([]string, error) {
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

func convertAndValidateLabelMatchers(data types.List, resp interface{}) ([]string, error) {
	labelMatchers, err := convertLabelMatchers(data)
	if err != nil {
		switch r := resp.(type) {
		case *resource.CreateResponse:
			addDiagnosticErrorForCreate(r, "Invalid Label Matchers", fmt.Sprintf("Error converting label matchers: %s", err))
		case *resource.UpdateResponse:
			addDiagnosticErrorForUpdate(r, "Invalid Label Matchers", fmt.Sprintf("Error converting label matchers: %s", err))
		case *resource.DeleteResponse:
			addDiagnosticErrorForDelete(r, "Invalid Label Matchers", fmt.Sprintf("Error converting label matchers: %s", err))
		case *resource.ReadResponse:
			addDiagnosticErrorForRead(r, "Invalid Label Matchers", fmt.Sprintf("Error converting label matchers: %s", err))
		default:
			// Handle unknown types if necessary
			fmt.Printf("Unhandled response type: %T\n", resp)
		}
	}
	return labelMatchers, err
}

// Generalized function for adding errors to diagnostics
func addDiagnosticErrorForCreate(resp *resource.CreateResponse, title, message string) {
	resp.Diagnostics.AddError(title, message)
}

func addDiagnosticErrorForUpdate(resp *resource.UpdateResponse, title, message string) {
	resp.Diagnostics.AddError(title, message)
}

func addDiagnosticErrorForDelete(resp *resource.DeleteResponse, title, message string) {
	resp.Diagnostics.AddError(title, message)
}

func addDiagnosticErrorForRead(resp *resource.ReadResponse, title, message string) {
	resp.Diagnostics.AddError(title, message)
}

func addDiagnosticErrorForConfigure(resp *provider.ConfigureResponse, title, message string) {
	resp.Diagnostics.AddError(title, message)
}

// Centralized logging function
func logAction(ctx context.Context, action, resourceID, name, namespace string) {
	tflog.Trace(ctx, fmt.Sprintf("%s federated graph resource", action), map[string]interface{}{
		"id":        resourceID,
		"name":      name,
		"namespace": namespace,
	})
}
