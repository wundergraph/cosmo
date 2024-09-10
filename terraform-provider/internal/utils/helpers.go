package utils

import (
	"github.com/hashicorp/terraform-plugin-framework/types"
)

func StringValueOrNil(s types.String) *string {
	if s.IsNull() {
		return nil
	}
	value := s.ValueString()
	return &value
}

func ConvertHeadersToStringList(headersList types.List) []string {
	var headers []string
	for _, header := range headersList.Elements() {
		if headerStr, ok := header.(types.String); ok {
			headers = append(headers, headerStr.ValueString())
		}
	}
	return headers
}
