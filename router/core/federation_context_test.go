package core

import (
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"testing"
)

func TestFederationContextDataSourceMetadata(t *testing.T) {
	config := &nodev1.DataSourceConfiguration{
		ContextProviders: []*nodev1.ContextProvider{
			{ContextName: "member", Provider: &nodev1.ContextProvider_Concrete{Concrete: &nodev1.ConcreteContextProvider{TypeName: "Member"}}},
			{ContextName: "account", Provider: &nodev1.ContextProvider_Abstract{Abstract: &nodev1.AbstractContextProvider{TypeName: "Account", ConcreteTypeNames: []string{"Member", "Team"}}}},
			{ContextName: "unset"},
		},
		ContextArguments: []*nodev1.ContextArgument{{ContextName: "account", TypeName: "Wallet", FieldName: "quote", ArgumentName: "locale", ArgumentType: "String", ContextSelection: "{ locale }"}},
		Requires:         []*nodev1.RequiredField{{TypeName: "Wallet", FieldName: "quote", SelectionSet: "currency"}},
	}
	var loader Loader
	meta := loader.dataSourceMetaData(config)
	require.Equal(t, []plan.ContextProvider{
		{ContextName: "member", Provider: plan.ConcreteContextProvider{TypeName: "Member"}},
		{ContextName: "account", Provider: plan.AbstractContextProvider{TypeName: "Account", ConcreteTypeNames: []string{"Member", "Team"}}},
	}, meta.ContextProviders)
	require.Equal(t, []plan.ContextArgument{{ContextName: "account", TypeName: "Wallet", FieldName: "quote", ArgumentName: "locale", ArgumentType: "String", ContextSelection: "{ locale }"}}, meta.ContextArguments)
	require.Len(t, meta.Requires, 1)
	require.Empty(t, loader.dataSourceMetaData(&nodev1.DataSourceConfiguration{}).ContextArguments)
}
