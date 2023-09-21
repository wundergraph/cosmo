package composition

import (
	"fmt"
	"testing"
)

var subgraphs = []Subgraph{
	{
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
	},
	{
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
	},
}

func TestFederateSubgraphs(t *testing.T) {
	sub, err := Federate(subgraphs...)
	fmt.Printf("%+v %s\n", sub, err)
}
