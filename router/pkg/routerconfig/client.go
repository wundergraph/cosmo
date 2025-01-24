package routerconfig

import (
	"context"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"time"
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

func GetDefaultConfig() []byte {
	return []byte(`
{
  "engineConfig": {
    "defaultFlushInterval": "500",
    "datasourceConfigurations": [
      {
        "kind": "STATIC",
        "rootNodes": [
          {
            "typeName": "Query",
            "fieldNames": [
              "hello"
            ]
          }
        ],
        "customStatic": {
          "data": {
            "kind": "STATIC_CONFIGURATION_VARIABLE",
            "staticVariableContent": "{\"hello\": \"world\"}"
          }
        },
        "id": "0"
      }
    ],
    "graphqlSchema": "schema {\n  query: Query\n}\ntype Query {\n  hello: String\n}",
    "fieldConfigurations": [
      {
        "typeName": "Query",
        "fieldName": "hello"
      }
    ]
  },
  "version": "1a7c0b1a-839c-4b6f-9d05-7cb728168f57",
  "subgraphs": [
  ]
}
`)
}
