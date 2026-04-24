package entity_caching

import (
	_ "embed"
)

//go:embed testdata/config.json
var configJSONTemplate string

const (
	itemsPlaceholderURL        = "http://items.entity-cache-test.local/graphql"
	detailsPlaceholderURL      = "http://details.entity-cache-test.local/graphql"
	inventoryPlaceholderURL    = "http://inventory.entity-cache-test.local/graphql"
	viewerPlaceholderURL       = "http://viewer.entity-cache-test.local/graphql"
	articlesPlaceholderURL     = "http://articles.entity-cache-test.local/graphql"
	articlesMetaPlaceholderURL = "http://articlesmeta.entity-cache-test.local/graphql"
)
