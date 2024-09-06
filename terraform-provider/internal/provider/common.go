package provider

import (
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/types"
)

const (
	envCosmoApiUrl = "COSMO_API_URL"
	envCosmoApiKey = "COSMO_API_KEY"
)

// convertLabelMatchers converts a Terraform list of strings to a slice of strings for use in the gRPC request.
func convertLabelMatchers(labelMatchersList types.List) ([]string, error) {
	var labelMatchers []string
	if labelMatchersList.IsNull() {
		return labelMatchers, nil // Return nil if the list is null or unknown
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
