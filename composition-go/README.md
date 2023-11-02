Composition
===========

This packages implements federation composition for GraphQL and static router configuration generation.

## Composition


Use `Federate` to produce a federated subgraph from the a set of subgraphs:

```go

package main

import (
	"fmt"
	"log"

	"github.com/wundergraph/cosmo/composition-go"
)

func main() {
	federated, err := composition.Federate(&composition.Subgraph{
		Name: "A",
		Schema: `type Query {
			query: Nested @shareable
		  }

		  type Nested @shareable {
			nest: Nested2
		  }

		  type Nested2 @shareable {
			nest: Nested3
		  }

		  type Nested3 @shareable {
			nest: Nested4
		  }

		  type Nested4 {
			name: String
		  }`,
	}, &composition.Subgraph{
		Name: "B",
		Schema: `type Query {
			query: Nested @shareable
		  }

		  type Nested @shareable {
			nest: Nested2
		  }

		  type Nested2 @shareable {
			nest: Nested3
		  }

		  type Nested3 @shareable {
			nest: Nested4
		  }

		  type Nested4 {
			age: Int
		  }`,
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(federated.SDL)
}

```

## Router configuration generation

Use `BuildRouterConfiguration` to produce generate a static data source configuration for the router:

```go

package main

import (
	"fmt"
	"log"

	"github.com/wundergraph/cosmo/composition-go"
)

func main() {
	config, err := composition.BuildRouterConfiguration(&composition.Subgraph{
		Name: "A",
		Schema: `type Query {
			query: Nested @shareable
		  }

		  type Nested @shareable {
			nest: Nested2
		  }

		  type Nested2 @shareable {
			nest: Nested3
		  }

		  type Nested3 @shareable {
			nest: Nested4
		  }

		  type Nested4 {
			name: String
		  }`,
	}, &composition.Subgraph{
		Name: "B",
		Schema: `type Query {
			query: Nested @shareable
		  }

		  type Nested @shareable {
			nest: Nested2
		  }

		  type Nested2 @shareable {
			nest: Nested3
		  }

		  type Nested3 @shareable {
			nest: Nested4
		  }

		  type Nested4 {
			age: Int
		  }`,
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(config)
}
```

## Contributing

The composition-go library uses code from [composition](../composition) and [shared](../shared), which
is bundled into [index.global.js](index.global.js). To keep this code up to date, run `go generate`
within this package.

## Performance considerations

By default, this package uses the [goja] runtime to run the composition algorithm. This has no
dependencies and supports all platforms, but depending on your inputs it can be too slow.

For better performance, a [V8] backend is also available using the `wg_composition_v8` build
tag, which is ~50x times faster. This uses the V8 JS engine to run the algorithm, but it increases the
binary size and doesn't work on Windows, so it's not enabled by default. To enable it, use
`go build -tags wg_composition_v8` when compiling.

[goja]: https://github.com/dop251/goja
[V8]: https://github.com/rogchap/v8go
