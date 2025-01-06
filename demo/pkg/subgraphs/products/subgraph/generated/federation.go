// Code generated by github.com/99designs/gqlgen, DO NOT EDIT.

package generated

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/99designs/gqlgen/plugin/federation/fedruntime"
)

var (
	ErrUnknownType  = errors.New("unknown type")
	ErrTypeNotFound = errors.New("type not found")
)

func (ec *executionContext) __resolve__service(ctx context.Context) (fedruntime.Service, error) {
	if ec.DisableIntrospection {
		return fedruntime.Service{}, errors.New("federated introspection disabled")
	}

	var sdl []string

	for _, src := range sources {
		if src.BuiltIn {
			continue
		}
		sdl = append(sdl, src.Input)
	}

	return fedruntime.Service{
		SDL: strings.Join(sdl, "\n"),
	}, nil
}

func (ec *executionContext) __resolve_entities(ctx context.Context, representations []map[string]interface{}) []fedruntime.Entity {
	list := make([]fedruntime.Entity, len(representations))

	repsMap := map[string]struct {
		i []int
		r []map[string]interface{}
	}{}

	// We group entities by typename so that we can parallelize their resolution.
	// This is particularly helpful when there are entity groups in multi mode.
	buildRepresentationGroups := func(reps []map[string]interface{}) {
		for i, rep := range reps {
			typeName, ok := rep["__typename"].(string)
			if !ok {
				// If there is no __typename, we just skip the representation;
				// we just won't be resolving these unknown types.
				ec.Error(ctx, errors.New("__typename must be an existing string"))
				continue
			}

			_r := repsMap[typeName]
			_r.i = append(_r.i, i)
			_r.r = append(_r.r, rep)
			repsMap[typeName] = _r
		}
	}

	isMulti := func(typeName string) bool {
		switch typeName {
		default:
			return false
		}
	}

	resolveEntity := func(ctx context.Context, typeName string, rep map[string]interface{}, idx []int, i int) (err error) {
		// we need to do our own panic handling, because we may be called in a
		// goroutine, where the usual panic handling can't catch us
		defer func() {
			if r := recover(); r != nil {
				err = ec.Recover(ctx, r)
			}
		}()

		switch typeName {
		case "Consultancy":
			resolverName, err := entityResolverNameForConsultancy(ctx, rep)
			if err != nil {
				return fmt.Errorf(`finding resolver for Entity "Consultancy": %w`, err)
			}
			switch resolverName {

			case "findConsultancyByUpc":
				id0, err := ec.unmarshalNID2string(ctx, rep["upc"])
				if err != nil {
					return fmt.Errorf(`unmarshalling param 0 for findConsultancyByUpc(): %w`, err)
				}
				entity, err := ec.resolvers.Entity().FindConsultancyByUpc(ctx, id0)
				if err != nil {
					return fmt.Errorf(`resolving Entity "Consultancy": %w`, err)
				}

				list[idx[i]] = entity
				return nil
			}
		case "Cosmo":
			resolverName, err := entityResolverNameForCosmo(ctx, rep)
			if err != nil {
				return fmt.Errorf(`finding resolver for Entity "Cosmo": %w`, err)
			}
			switch resolverName {

			case "findCosmoByUpc":
				id0, err := ec.unmarshalNID2string(ctx, rep["upc"])
				if err != nil {
					return fmt.Errorf(`unmarshalling param 0 for findCosmoByUpc(): %w`, err)
				}
				entity, err := ec.resolvers.Entity().FindCosmoByUpc(ctx, id0)
				if err != nil {
					return fmt.Errorf(`resolving Entity "Cosmo": %w`, err)
				}

				list[idx[i]] = entity
				return nil
			}
		case "Employee":
			resolverName, err := entityResolverNameForEmployee(ctx, rep)
			if err != nil {
				return fmt.Errorf(`finding resolver for Entity "Employee": %w`, err)
			}
			switch resolverName {

			case "findEmployeeByID":
				id0, err := ec.unmarshalNInt2int(ctx, rep["id"])
				if err != nil {
					return fmt.Errorf(`unmarshalling param 0 for findEmployeeByID(): %w`, err)
				}
				entity, err := ec.resolvers.Entity().FindEmployeeByID(ctx, id0)
				if err != nil {
					return fmt.Errorf(`resolving Entity "Employee": %w`, err)
				}

				list[idx[i]] = entity
				return nil
			}

		}
		return fmt.Errorf("%w: %s", ErrUnknownType, typeName)
	}

	resolveManyEntities := func(ctx context.Context, typeName string, reps []map[string]interface{}, idx []int) (err error) {
		// we need to do our own panic handling, because we may be called in a
		// goroutine, where the usual panic handling can't catch us
		defer func() {
			if r := recover(); r != nil {
				err = ec.Recover(ctx, r)
			}
		}()

		switch typeName {

		default:
			return errors.New("unknown type: " + typeName)
		}
	}

	resolveEntityGroup := func(typeName string, reps []map[string]interface{}, idx []int) {
		if isMulti(typeName) {
			err := resolveManyEntities(ctx, typeName, reps, idx)
			if err != nil {
				ec.Error(ctx, err)
			}
		} else {
			// if there are multiple entities to resolve, parallelize (similar to
			// graphql.FieldSet.Dispatch)
			var e sync.WaitGroup
			e.Add(len(reps))
			for i, rep := range reps {
				i, rep := i, rep
				go func(i int, rep map[string]interface{}) {
					err := resolveEntity(ctx, typeName, rep, idx, i)
					if err != nil {
						ec.Error(ctx, err)
					}
					e.Done()
				}(i, rep)
			}
			e.Wait()
		}
	}
	buildRepresentationGroups(representations)

	switch len(repsMap) {
	case 0:
		return list
	case 1:
		for typeName, reps := range repsMap {
			resolveEntityGroup(typeName, reps.r, reps.i)
		}
		return list
	default:
		var g sync.WaitGroup
		g.Add(len(repsMap))
		for typeName, reps := range repsMap {
			go func(typeName string, reps []map[string]interface{}, idx []int) {
				resolveEntityGroup(typeName, reps, idx)
				g.Done()
			}(typeName, reps.r, reps.i)
		}
		g.Wait()
		return list
	}
}

func entityResolverNameForConsultancy(ctx context.Context, rep map[string]interface{}) (string, error) {
	for {
		var (
			m   map[string]interface{}
			val interface{}
			ok  bool
		)
		_ = val
		// if all of the KeyFields values for this resolver are null,
		// we shouldn't use use it
		allNull := true
		m = rep
		val, ok = m["upc"]
		if !ok {
			break
		}
		if allNull {
			allNull = val == nil
		}
		if allNull {
			break
		}
		return "findConsultancyByUpc", nil
	}
	return "", fmt.Errorf("%w for Consultancy", ErrTypeNotFound)
}

func entityResolverNameForCosmo(ctx context.Context, rep map[string]interface{}) (string, error) {
	for {
		var (
			m   map[string]interface{}
			val interface{}
			ok  bool
		)
		_ = val
		// if all of the KeyFields values for this resolver are null,
		// we shouldn't use use it
		allNull := true
		m = rep
		val, ok = m["upc"]
		if !ok {
			break
		}
		if allNull {
			allNull = val == nil
		}
		if allNull {
			break
		}
		return "findCosmoByUpc", nil
	}
	return "", fmt.Errorf("%w for Cosmo", ErrTypeNotFound)
}

func entityResolverNameForEmployee(ctx context.Context, rep map[string]interface{}) (string, error) {
	for {
		var (
			m   map[string]interface{}
			val interface{}
			ok  bool
		)
		_ = val
		// if all of the KeyFields values for this resolver are null,
		// we shouldn't use use it
		allNull := true
		m = rep
		val, ok = m["id"]
		if !ok {
			break
		}
		if allNull {
			allNull = val == nil
		}
		if allNull {
			break
		}
		return "findEmployeeByID", nil
	}
	return "", fmt.Errorf("%w for Employee", ErrTypeNotFound)
}
