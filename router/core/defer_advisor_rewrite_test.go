package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
)

func TestRewriteOperationWithDefer(t *testing.T) {
	t.Parallel()

	operation := `query Storefront {
  storefront {
    id
    name
    price
    priceHistory {
      date
      value
    }
    reviews {
      id
      body
      stars
    }
    ratingSummary {
      average
      count
    }
  }
}`

	rewritten, err := rewriteOperationWithDefer(operation, "Storefront", []deferGroup{
		{ParentPath: []string{"storefront"}, Fields: []string{"priceHistory"}, Label: "pricing_priceHistory"},
		{ParentPath: []string{"storefront"}, Fields: []string{"reviews"}, Label: "reviews_reviews"},
	})
	require.NoError(t, err)

	assert.Equal(t, `query Storefront {
  storefront {
    id
    name
    price
    ... @defer(label: "pricing_priceHistory") {
      priceHistory {
        date
        value
      }
    }
    ... @defer(label: "reviews_reviews") {
      reviews {
        id
        body
        stars
      }
    }
    ratingSummary {
      average
      count
    }
  }
}`, rewritten)
}

func TestRewriteOperationWithDeferInsideFragment(t *testing.T) {
	t.Parallel()

	operation := `query MyQuery {
  storefront {
    id
    ...PriceInfo
  }
}

fragment PriceInfo on Product {
  price
  priceHistory {
    date
    value
  }
}`

	rewritten, err := rewriteOperationWithDefer(operation, "MyQuery", []deferGroup{
		{ParentPath: []string{"storefront"}, Fields: []string{"priceHistory"}, Label: "pricing_priceHistory"},
	})
	require.NoError(t, err)

	assert.Equal(t, `query MyQuery {
  storefront {
    id
    ...PriceInfo
  }
}

fragment PriceInfo on Product {
  price
  ... @defer(label: "pricing_priceHistory") {
    priceHistory {
      date
      value
    }
  }
}`, rewritten)
}

// Without the schema, distinct type-condition names do not prove disjoint
// runtime types: an object can satisfy multiple interfaces. Rewriting the same
// response name in several branches must therefore fail closed.
func TestRewriteOperationWithDeferRejectsRepeatedResponseAcrossPotentiallyOverlappingTypes(t *testing.T) {
	t.Parallel()

	operation := `query Pets {
  pets {
    ... on Node {
      name
      nodeID
    }
    ... on Product {
      name
      sku
    }
  }
}`

	_, err := rewriteOperationWithDefer(operation, "Pets", []deferGroup{
		{ParentPath: []string{"pets"}, Fields: []string{"name"}, Label: "catalog:pets:name"},
	})
	require.EqualError(t, err, `field "name" is selected in multiple branches at rewrite path "pets"`)
}

func TestStripDeferDirectives(t *testing.T) {
	t.Parallel()

	stripped, err := stripDeferDirectives(`query Storefront {
  storefront {
    id
    price
    ... @defer(label: "a") {
      priceHistory {
        date
      }
    }
    ... on Product @defer(label: "b") {
      reviews {
        id
      }
    }
  }
}`)
	require.NoError(t, err)
	assert.Equal(t, `query Storefront {
  storefront {
    id
    price
    priceHistory {
      date
    }
    ... on Product {
      reviews {
        id
      }
    }
  }
}`, stripped)
}

func TestStripDeferDirectivesNoDefer(t *testing.T) {
	t.Parallel()

	operation := `query { storefront { id } }`
	stripped, err := stripDeferDirectives(operation)
	require.NoError(t, err)
	assert.Equal(t, operation, stripped)
}

func TestStripDeferDirectivesOnlyUnwrapsDeferCarriers(t *testing.T) {
	t.Parallel()

	stripped, err := stripDeferDirectives(`query Storefront {
  storefront {
    ... {
      id
      ... @defer(label: "name") {
        name
      }
    }
  }
}`)
	require.NoError(t, err)
	assert.Equal(t, `query Storefront {
  storefront {
    ...{
      id
      name
    }
  }
}`, stripped)
}

func TestStripDeferDirectivesPreservesFragmentSemantics(t *testing.T) {
	t.Parallel()

	stripped, err := stripDeferDirectives(`query Storefront($include: Boolean!, $skip: Boolean!) {
  storefront {
    ...Details @defer(label: "spread") @include(if: $include)
    ... on Product @defer(label: "typed") @skip(if: $skip) {
      reviews { id }
    }
    ... @defer(label: "directed") @include(if: $include) {
      name
    }
  }
}
fragment Details on Product {
  ... @defer(label: "definition") { price }
}`)
	require.NoError(t, err)
	assert.Equal(t, `query Storefront($include: Boolean!, $skip: Boolean!){
  storefront {
    ...Details @include(if: $include)
    ... on Product @skip(if: $skip) {
      reviews {
        id
      }
    }
    ... @include(if: $include) {
      name
    }
  }
}

fragment Details on Product {
  price
}`, stripped)
}

func TestStripDeferDirectivesReportsParseFailures(t *testing.T) {
	t.Parallel()

	_, err := stripDeferDirectives(`query Broken {`)
	require.ErrorContains(t, err, "failed to parse operation:")
}

func TestRewriteOperationWithDeferFieldNotFound(t *testing.T) {
	t.Parallel()

	_, err := rewriteOperationWithDefer(`query { storefront { id } }`, "", []deferGroup{
		{ParentPath: []string{"storefront"}, Fields: []string{"missing"}, Label: "l"},
	})
	require.EqualError(t, err, `field "missing" not found at rewrite path "storefront"`)
}

func TestRewriteOperationWithDeferSelectsOperationExactly(t *testing.T) {
	t.Parallel()

	t.Run("rejects an empty operation name for a multi-operation document", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`
query First { first { id } }
query Second { second { id } }
`, "", []deferGroup{{ParentPath: []string{"first"}, Fields: []string{"id"}, Label: "first_id"}})
		require.EqualError(t, err, "operation name is required when multiple operations are defined")
	})

	t.Run("never falls back when a named operation is missing", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`
query First { first { id } }
query Second { second { id } }
`, "Missing", []deferGroup{{ParentPath: []string{"first"}, Fields: []string{"id"}, Label: "first_id"}})
		require.EqualError(t, err, `operation "Missing" not found`)
	})

	t.Run("rewrites only the selected operation", func(t *testing.T) {
		t.Parallel()

		rewritten, err := rewriteOperationWithDefer(`
query First { first { id } }
query Second { second { id name } }
`, "Second", []deferGroup{{ParentPath: []string{"second"}, Fields: []string{"name"}, Label: "second_name"}})
		require.NoError(t, err)
		assert.Equal(t, `query First {
  first {
    id
  }
}

query Second {
  second {
    id
    ... @defer(label: "second_name") {
      name
    }
  }
}`, rewritten)
	})

	t.Run("returns the original source when there are no groups", func(t *testing.T) {
		t.Parallel()

		operation := `query Selected { storefront { id } }`
		rewritten, err := rewriteOperationWithDefer(operation, "Selected", nil)
		require.NoError(t, err)
		assert.Equal(t, operation, rewritten)
	})

	t.Run("reports parse failures", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Broken {`, "Broken", nil)
		require.ErrorContains(t, err, "failed to parse operation:")
	})
}

func TestRewriteOperationWithDeferRejectsInvalidGroups(t *testing.T) {
	t.Parallel()

	t.Run("empty field group", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront { storefront { id } }`, "Storefront", []deferGroup{{
			ParentPath: []string{"storefront"},
			Label:      "empty",
		}})
		require.EqualError(t, err, "defer group 1 has no fields")
	})

	t.Run("empty response name", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront { storefront { id } }`, "Storefront", []deferGroup{{
			ParentPath: []string{"storefront"},
			Fields:     []string{""},
			Label:      "empty_name",
		}})
		require.EqualError(t, err, "defer group 1 has an empty field response name")
	})

	t.Run("duplicate response names are sorted", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront { storefront { a z } }`, "Storefront", []deferGroup{{
			ParentPath: []string{"storefront"},
			Fields:     []string{"z", "a", "z", "a"},
			Label:      "duplicates",
		}})
		require.EqualError(t, err, "defer group 1 has duplicate fields [a z]")
	})

	t.Run("overlapping groups", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront { storefront { id name price } }`, "Storefront", []deferGroup{
			{ParentPath: []string{"storefront"}, Fields: []string{"price", "name"}, Label: "first"},
			{ParentPath: []string{"storefront"}, Fields: []string{"name", "price"}, Label: "second"},
		})
		require.EqualError(t, err, `defer group 2 overlaps an earlier group at path "storefront": fields [name price]`)
	})

	t.Run("multiple missing fields are sorted", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront { storefront { id } }`, "Storefront", []deferGroup{{
			ParentPath: []string{"storefront"},
			Fields:     []string{"z", "a"},
			Label:      "missing",
		}})
		require.EqualError(t, err, `fields [a z] not found at rewrite path "storefront"`)
	})

	t.Run("duplicate direct selections are ambiguous", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront { storefront { id name name } }`, "Storefront", []deferGroup{{
			ParentPath: []string{"storefront"},
			Fields:     []string{"name"},
			Label:      "name",
		}})
		require.EqualError(t, err, `field "name" is selected in multiple branches at rewrite path "storefront"`)
	})
}

func TestRewriteOperationWithDeferUsesResponseNamePaths(t *testing.T) {
	t.Parallel()

	rewritten, err := rewriteOperationWithDefer(`query Storefront {
  shop: storefront {
    id
    history: priceHistory { value }
  }
}`, "Storefront", []deferGroup{{
		ParentPath: []string{"shop"},
		Fields:     []string{"history"},
		Label:      "aliased_history",
	}})
	require.NoError(t, err)
	assert.Equal(t, `query Storefront {
  shop: storefront {
    id
    ... @defer(label: "aliased_history") {
      history: priceHistory {
        value
      }
    }
  }
}`, rewritten)
}

func TestRewriteOperationWithDeferReportsInvalidPaths(t *testing.T) {
	t.Parallel()

	t.Run("missing root field", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront { storefront { id } }`, "Storefront", []deferGroup{{
			ParentPath: []string{"missing"},
			Fields:     []string{"id"},
			Label:      "missing",
		}})
		require.EqualError(t, err, `field "missing" not found at path "<root>" while resolving rewrite path "missing"`)
	})

	t.Run("missing nested field", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront { storefront { id } }`, "Storefront", []deferGroup{{
			ParentPath: []string{"storefront", "missing"},
			Fields:     []string{"id"},
			Label:      "missing",
		}})
		require.EqualError(t, err, `field "missing" not found at path "storefront" while resolving rewrite path "storefront.missing"`)
	})

	t.Run("scalar parent", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront { storefront { id } }`, "Storefront", []deferGroup{{
			ParentPath: []string{"storefront", "id"},
			Fields:     []string{"value"},
			Label:      "scalar",
		}})
		require.EqualError(t, err, `field "id" at rewrite path "storefront.id" has no selection set`)
	})

	t.Run("schema field name does not match an alias", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront { shop: storefront { id } }`, "Storefront", []deferGroup{{
			ParentPath: []string{"storefront"},
			Fields:     []string{"id"},
			Label:      "wrong_path",
		}})
		require.EqualError(t, err, `field "storefront" not found at path "<root>" while resolving rewrite path "storefront"`)
	})
}

func TestRewriteOperationWithDeferRejectsInvalidFragmentGraphs(t *testing.T) {
	t.Parallel()

	t.Run("missing fragment definition", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront {
  storefront { ...Missing }
}`, "Storefront", []deferGroup{{ParentPath: []string{"storefront"}, Fields: []string{"name"}, Label: "name"}})
		require.EqualError(t, err, `fragment "Missing" is not defined`)
	})

	t.Run("fragment cycle", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront {
  storefront { ...A }
}
fragment A on Product { ...B }
fragment B on Product { ...A name }
`, "Storefront", []deferGroup{{ParentPath: []string{"storefront"}, Fields: []string{"name"}, Label: "name"}})
		require.EqualError(t, err, "fragment cycle detected: A -> B -> A")
	})
}

func TestRewriteOperationWithDeferRejectsSharedFragmentMutation(t *testing.T) {
	t.Parallel()

	t.Run("fragment spread at multiple response paths", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront {
  primary: storefront { ...Details }
  secondary: storefront { ...Details }
}
fragment Details on Product { id name }
`, "Storefront", []deferGroup{{ParentPath: []string{"primary"}, Fields: []string{"name"}, Label: "primary_name"}})
		require.EqualError(t, err, `fragment "Details" is used by multiple operation paths; rewriting it would affect unrelated selections`)
	})

	t.Run("fragment spread by multiple operations", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query First {
  first: storefront { ...Details }
}
query Second {
  second: storefront { ...Details }
}
fragment Details on Product { id name }
`, "First", []deferGroup{{ParentPath: []string{"first"}, Fields: []string{"name"}, Label: "first_name"}})
		require.EqualError(t, err, `fragment "Details" is used by multiple operation paths; rewriting it would affect unrelated selections`)
	})

	t.Run("transitively shared fragment", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront {
  primary: storefront { ...Outer }
  secondary: storefront { ...Outer }
}
fragment Outer on Product { ...Details }
fragment Details on Product { id name }
`, "Storefront", []deferGroup{{ParentPath: []string{"primary"}, Fields: []string{"name"}, Label: "primary_name"}})
		require.EqualError(t, err, `fragment "Details" is used by multiple operation paths; rewriting it would affect unrelated selections`)
	})
}

func TestRewriteOperationWithDeferTraversesFragmentsAndAliases(t *testing.T) {
	t.Parallel()

	t.Run("single-use fragment spread", func(t *testing.T) {
		t.Parallel()

		rewritten, err := rewriteOperationWithDefer(`query Storefront {
  storefront { ...Details }
}
fragment Details on Product {
  nested: details { id slow: history { value } }
}`, "Storefront", []deferGroup{{
			ParentPath: []string{"storefront", "nested"},
			Fields:     []string{"slow"},
			Label:      "details:slow",
		}})
		require.NoError(t, err)
		assert.Equal(t, `query Storefront {
  storefront {
    ...Details
  }
}

fragment Details on Product {
  nested: details {
    id
    ... @defer(label: "details:slow") {
      slow: history {
        value
      }
    }
  }
}`, rewritten)
	})

	t.Run("inline fragment", func(t *testing.T) {
		t.Parallel()

		rewritten, err := rewriteOperationWithDefer(`query Storefront {
  storefront {
    ... on Product { details { id history { value } } }
  }
}`, "Storefront", []deferGroup{{
			ParentPath: []string{"storefront", "details"},
			Fields:     []string{"history"},
			Label:      "details_history",
		}})
		require.NoError(t, err)
		assert.Equal(t, `query Storefront {
  storefront {
    ... on Product {
      details {
        id
        ... @defer(label: "details_history") {
          history {
            value
          }
        }
      }
    }
  }
}`, rewritten)
	})
}

func TestRewriteOperationWithDeferPreservesFieldOrderAcrossGroups(t *testing.T) {
	t.Parallel()

	rewritten, err := rewriteOperationWithDefer(`query Storefront {
  storefront { a b c d }
}`, "Storefront", []deferGroup{
		{ParentPath: []string{"storefront"}, Fields: []string{"c", "d"}, Label: "late"},
		{ParentPath: []string{"storefront"}, Fields: []string{"a"}, Label: "early"},
	})
	require.NoError(t, err)
	assert.Equal(t, `query Storefront {
  storefront {
    ... @defer(label: "early") {
      a
    }
    b
    ... @defer(label: "late") {
      c
      d
    }
  }
}`, rewritten)
}

func TestRewriteOperationWithDeferAtRoot(t *testing.T) {
	t.Parallel()

	rewritten, err := rewriteOperationWithDefer(`query Storefront { id storefront { name } }`, "Storefront", []deferGroup{{
		Fields: []string{"storefront"},
		Label:  "root_storefront",
	}})
	require.NoError(t, err)
	assert.Equal(t, `query Storefront {
  id
  ... @defer(label: "root_storefront") {
    storefront {
      name
    }
  }
}`, rewritten)
}

func TestRewriteOperationWithDeferRejectsAmbiguousIntermediatePath(t *testing.T) {
	t.Parallel()

	_, err := rewriteOperationWithDefer(`query Nodes {
  nodes {
    ... on A { child { slow } }
    ... on B { child { slow } }
  }
}`, "Nodes", []deferGroup{{
		ParentPath: []string{"nodes", "child"},
		Fields:     []string{"slow"},
		Label:      "child_slow",
	}})
	require.EqualError(t, err, `field "child" at rewrite path "nodes.child" is selected in multiple branches`)
}

func TestRewriteOperationWithDeferRejectsGeneratedLabelCollisions(t *testing.T) {
	t.Parallel()

	t.Run("same label on disjoint groups", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront { storefront { a b } }`, "Storefront", []deferGroup{
			{ParentPath: []string{"storefront"}, Fields: []string{"a"}, Label: "duplicate"},
			{ParentPath: []string{"storefront"}, Fields: []string{"b"}, Label: "duplicate"},
		})
		require.EqualError(t, err, `defer label "duplicate" is generated more than once`)
	})

	t.Run("explicit label collides with a generated suffix", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Pets {
  pets {
    id
    ... on A { name }
    ... on B { lives }
  }
}`, "Pets", []deferGroup{
			{ParentPath: []string{"pets"}, Fields: []string{"name", "lives"}, Label: "x"},
			{ParentPath: []string{"pets"}, Fields: []string{"id"}, Label: "x_2"},
		})
		require.EqualError(t, err, `defer label "x_2" is generated more than once`)
	})
}

func TestRewriteOperationWithDeferRejectsOverlappingSelections(t *testing.T) {
	t.Parallel()

	t.Run("direct and inline fragment", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront {
  storefront {
    name
    ... on Product { name }
  }
}`, "Storefront", []deferGroup{{ParentPath: []string{"storefront"}, Fields: []string{"name"}, Label: "name"}})
		require.EqualError(t, err, `field "name" is selected in multiple branches at rewrite path "storefront"`)
	})

	t.Run("direct and fragment spread", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront {
  storefront {
    name
    ...Details
  }
}
fragment Details on Product { name }
`, "Storefront", []deferGroup{{ParentPath: []string{"storefront"}, Fields: []string{"name"}, Label: "name"}})
		require.EqualError(t, err, `field "name" is selected in multiple branches at rewrite path "storefront"`)
	})

	t.Run("same type-condition branch", func(t *testing.T) {
		t.Parallel()

		_, err := rewriteOperationWithDefer(`query Storefront {
  storefront {
    ... on Product { name }
    ... on Product { name }
  }
}`, "Storefront", []deferGroup{{ParentPath: []string{"storefront"}, Fields: []string{"name"}, Label: "name"}})
		require.EqualError(t, err, `field "name" is selected in multiple branches at rewrite path "storefront"`)
	})
}

func TestFindFieldInSelectionSetUsesResponseNames(t *testing.T) {
	t.Parallel()

	doc, report := astparser.ParseGraphqlDocumentString(`query { storefront { displayName: name } }`)
	require.False(t, report.HasErrors(), report.Error())
	rootSetRef := doc.OperationDefinitions[0].SelectionSet
	storefrontRef, ok := findFieldInSelectionSet(&doc, rootSetRef, "storefront")
	require.True(t, ok)
	require.True(t, doc.Fields[storefrontRef].HasSelections)

	nameRef, ok := findFieldInSelectionSet(&doc, doc.Fields[storefrontRef].SelectionSet, "displayName")
	require.True(t, ok)
	assert.Equal(t, "displayName", doc.FieldAliasOrNameString(nameRef))

	_, ok = findFieldInSelectionSet(&doc, rootSetRef, "missing")
	assert.False(t, ok)
}
