package core

import (
	"github.com/wundergraph/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
)

// Arguments allow access to GraphQL field arguments used by clients.
type Arguments struct {
	// mapping maps "fieldPath.argumentName" to "variableName".
	// For example: {"user.posts.limit": "a", "user.id": "userId"}
	mapping astnormalization.FieldArgumentMapping

	// variables contains the JSON-parsed variables from the request.
	variables *astjson.Value
}

// NewArguments creates an Arguments instance.
func NewArguments(
	mapping astnormalization.FieldArgumentMapping,
	variables *astjson.Value,
) Arguments {
	return Arguments{
		mapping:   mapping,
		variables: variables,
	}
}

// Get will return the value of the field argument at path.
//
// To access a specific field argument you need to provide
// the path in it's GraphQL operation via dot notation,
// prefixed by the root levels type.
//
//	Get("rootfield_operation_type.rootfield_name.other.fields.argument_name")
//
// To access the storeId field argument of the operation
//
//	subscription {
//	    orderUpdated(storeId: 1) {
//	        id
//	        status
//	    }
//	}
//
// you need to call Get("subscription.orderUpdated.storeId") .
// You can also access deeper nested fields.
// For example you can access the categoryId field of the operation
//
//	subscription {
//	    orderUpdated(storeId: 1) {
//	        lineItems(categoryId: 2) {
//	            id
//	            name
//	        }
//	    }
//	}
//
// by calling Get("subscription.orderUpdated.lineItems.categoryId") .
//
// If you use aliases in operation you need to provide the alias name
// instead of the field name.
//
//	query {
//	    a: user(id: "1") { name }
//	    b: user(id: "2") { name }
//	}
//
// You need to call Get("query.a.id") or Get("query.b.id") respectively.
//
// If you want to access field arguments of fragments, you need to
// access it on one of the fields where the fragment is resolved.
//
//	fragment GoldTrophies on RaceDrivers {
//	    trophies(color:"gold") {
//	        title
//	    }
//	}
//
//	subscription {
//	    driversFinish {
//	        name
//	        ... GoldTrophies
//	    }
//	}
//
// If you want to access the "color" field argument, you need to
// call Get("subscription.driversFinish.trophies.color") .
// The same concept applies to inline fragments.
//
// If fa is nil, or f or a cannot be found, nil is returned.
func (fa *Arguments) Get(path string) *astjson.Value {
	if fa == nil || len(fa.mapping) == 0 || fa.variables == nil {
		return nil
	}

	// Look up variable name from field argument map
	varName, ok := fa.mapping[path]
	if !ok {
		return nil
	}

	// Use the name to get the actual value from
	// the operation contexts variables.
	return fa.variables.Get(varName)
}
