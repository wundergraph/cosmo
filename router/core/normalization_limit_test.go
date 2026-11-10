package core

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

func TestDefaultNormalizationSelectionLimit(t *testing.T) {
	definition, report := astparser.ParseGraphqlDocumentString(`
  type Query {
    hello: String
  }
 `)
	require.False(t, report.HasErrors(), report.Error())
	normalizer := astnormalization.NewWithOpts(buildNormalizationOptions(false, config.ValidateInlineArguments{})...)
	operation, report := astparser.ParseGraphqlDocumentString("{\n" + strings.Repeat("hello\n", 10_001) + "}")
	require.False(t, report.HasErrors(), report.Error())
	normalizer.NormalizeNamedOperation(&operation, &definition, nil, &report)
	require.Len(t, report.ExternalErrors, 1)
	require.Equal(t, "NORMALIZATION_LIMIT_EXCEEDED", report.ExternalErrors[0].ExtensionCode)
}
