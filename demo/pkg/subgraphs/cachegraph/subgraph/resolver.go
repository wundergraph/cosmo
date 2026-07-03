package subgraph

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

// Resolver is the root gqlgen resolver. Each Resolver owns its own data stores
// so mutations are isolated per subgraph server instance and safe under
// concurrent request handling.
type Resolver struct {
	articles *articleStore
	listings *listingStore
}

// NewResolver creates a Resolver with fresh, independent article and listing
// stores seeded from the default data.
func NewResolver() *Resolver {
	return &Resolver{
		articles: newArticleStore(),
		listings: newListingStore(),
	}
}
