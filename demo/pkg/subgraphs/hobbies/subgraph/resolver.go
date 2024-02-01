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

// FindDetailsByID is the resolver for the findDetailsByID field.
func (r *Resolver) FindDetailsByID(id int) (*model.Details, error) {
	for _, employee := range employees {
		if id == employee.ID {
			return &model.Details{
				ID:      employee.ID,
				Hobbies: employee.Hobbies,
			}, nil
		}
	}

	return nil, nil
}

func (r *Resolver) Employees(hobby model.Hobby) ([]*model.Employee, error) {
	var res []*model.Employee
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
