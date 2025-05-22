package routerconfig

import (
	"context"
	"fmt"
	"time"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

type Response struct {
	// Config is the marshaled router config
	Config *nodev1.RouterConfig
}

type Client interface {
	// RouterConfig returns the latest router config from the config provider
	// Version and last fetch time information can be used from different providers to determine if the config has changed
	RouterConfig(ctx context.Context, prevVersion string, prevFetchTime time.Time) (*Response, error)
}

type ConfigNotFoundError interface {
	error
	FederatedGraphId() string
}

func GetDefaultConfig() *nodev1.RouterConfig {
	msg := `Cosmo Router is ready! Follow this guide to deploy your first Supergraph: https://cosmo-docs.wundergraph.com/tutorial/from-zero-to-federation-in-5-steps-using-cosmo`
	return &nodev1.RouterConfig{
		Version: "1a7c0b1a-839c-4b6f-9d05-7cb728168f57",
		EngineConfig: &nodev1.EngineConfiguration{
			DefaultFlushInterval: 500,
			DatasourceConfigurations: []*nodev1.DataSourceConfiguration{
				{
					Kind: nodev1.DataSourceKind_STATIC,
					RootNodes: []*nodev1.TypeField{
						{
							TypeName:   "Query",
							FieldNames: []string{"hello"},
						},
					},
					CustomStatic: &nodev1.DataSourceCustom_Static{
						Data: &nodev1.ConfigurationVariable{
							StaticVariableContent: fmt.Sprintf(`{"hello": "%s"}`, msg),
						},
					},
					Id: "0",
				},
			},
			GraphqlSchema: "schema {\n  query: Query\n}\ntype Query {\n  hello: String\n}",
			FieldConfigurations: []*nodev1.FieldConfiguration{
				{
					TypeName:  "Query",
					FieldName: "hello",
				},
			},
		},
	}
}
