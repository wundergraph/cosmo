package subgraph

import (
	"reflect"

	"github.com/nats-io/nats.go"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/hobbies/subgraph/model"
)

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

type Resolver struct {
	NC *nats.Conn
}

func (r *Resolver) Details(hobby *model.Hobby) ([]*model.Details, error) {
	var res []*model.Details
	for _, employee := range employees {
		for _, curHobby := range employee.Hobbies {
			if isSameType(hobby, curHobby) {
				res = append(res, employee)
			}
		}
	}
	return res, nil
}

func isSameType(a, b any) bool {
	typeOfA := reflect.TypeOf(a)
	typeOfB := reflect.TypeOf(b)

	// If either type is a pointer, get the type it points to
	if typeOfA.Kind() == reflect.Ptr {
		typeOfA = typeOfA.Elem()
	}
	if typeOfB.Kind() == reflect.Ptr {
		typeOfB = typeOfB.Elem()
	}

	return typeOfA == typeOfB
}
