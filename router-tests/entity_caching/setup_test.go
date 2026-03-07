package entity_caching

import (
	_ "embed"
)

//go:embed testdata/config.json
var configJSONTemplate string

const (
	itemsPlaceholderURL     = "http://items.entity-cache-test.local/graphql"
	detailsPlaceholderURL   = "http://details.entity-cache-test.local/graphql"
	inventoryPlaceholderURL = "http://inventory.entity-cache-test.local/graphql"
)
