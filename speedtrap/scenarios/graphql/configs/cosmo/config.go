package cosmo

import _ "embed"

const (
	SubgraphAPlaceholderURL = "http://localhost:14001/graphql"
	SubgraphBPlaceholderURL = "http://localhost:14002/graphql"
)

//go:embed config.json
var ConfigJSON string
