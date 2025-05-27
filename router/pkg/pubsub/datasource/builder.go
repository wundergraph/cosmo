package datasource

import (
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

type DataSourceConfigurationWithMetadata struct {
	Configuration *nodev1.DataSourceConfiguration
	Metadata      *plan.DataSourceMetadata
}
