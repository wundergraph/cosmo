package subgraph

import (
	"context"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph/model"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"reflect"
	"sync"
)

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

type Resolver struct {
	mux                sync.Mutex
	PubSubBySourceName map[string]pubsub_datasource.PubSub
}

func (r *Resolver) Employees(ctx context.Context, obj model.RoleType) ([]*model.Employee, error) {
	var res []*model.Employee
	for _, employee := range employees {
		if isSameType(employee.Role, obj) {
			res = append(res, employee)
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
