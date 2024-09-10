package utils

import "github.com/hashicorp/terraform-plugin-framework/types"

func StringValueOrNil(s types.String) *string {
	if s.IsNull() {
		return nil
	}
	value := s.ValueString()
	return &value
}
