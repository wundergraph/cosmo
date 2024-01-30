package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/products/subgraph/model"

var topSecretFactTypeDirective = model.TopSecretFactTypeDirective
var topSecretFactTypeEntity = model.TopSecretFactTypeEntity
var topSecretFactTypeMiscellaneous = model.TopSecretFactTypeMiscellaneous

var topSecretFederationFacts = []model.TopSecretFact{
	model.DirectiveFact{
		Title:       "Shareability and Federation Version",
		Description: "All fields in Federation Version 1 graphs are intrinsically considered @shareable.",
		FactType:    &topSecretFactTypeDirective,
	},
	model.DirectiveFact{
		Title: "Compounding Authorization Directives",
		Description: "The @requiresScopes directive will compound through matrix multiplication. For example, if" +
			" the scopes \"[[\"read:a\"], [\"read:b\"]]\" are defined on the scalar \"CustomScalar\", and a field" +
			" definition that returns that scalar defines the scopes \"[[\"read:x\"], [\"read:y\"]]\", the resulting" +
			" scopes for the field definition will be \"[[\"read:a\", \"read:x\"], [\"read:a\", \"read:y\"]," +
			" [\"read:b\", \"read:x\"], [\"read:b\", \"read:y\"]]\".",
		FactType: &topSecretFactTypeDirective,
	},
	model.EntityFact{
		Title: "Implicit Entities",
		Description: "If an object is declared as an entity in at least one graph, it's possible" +
			"(but not recommended) for a definition (or potentially some definitions) not to define any @key" +
			" directives explicitly. However, resolvers can only \"jump\" *away* and not *to* these" +
			" \"implicit entities\". This relies on the \"adoption\" of [a/some] mutual primary key(s).",
		FactType: &topSecretFactTypeEntity,
	},
	model.MiscellaneousFact{
		Title: "Unreachable Concrete Types through Interface",
		Description: "It is possible to define a field in a specific subgraph that returns an interface named type," +
			" but one or more concrete types that implement that interface are not defined in that subgraph." +
			" If there is no other way to reach such concrete types (e.g., through an \"entity ancestor\"), those" +
			" concrete types will be \"unreachable\" through those fields. Note that this will not produce an error.",
		FactType: &topSecretFactTypeMiscellaneous,
	},
}
