package core

import (
	"errors"
	"fmt"
	"reflect"
	"sync"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	"github.com/wundergraph/cosmo/router/internal/graphcodec"
)

// transferredPlan is the root of what a plan worker sends back to the router.
type transferredPlan struct {
	Plan plan.Plan
}

// planCodec transfers query plans between a plan worker and the router.
//
// Plans are not designed to be serialized. They reference live data sources, and some
// of their types keep unexported state or closures. The codec transfers what it can
// reproduce exactly and rejects everything else, in which case the router plans the
// operation itself. Today, that leaves out:
//
//   - subscriptions, their triggers hold a subscription client
//   - fetches against anything but a GraphQL subgraph over HTTP (gRPC, EDFS, introspection),
//     their data sources are built per operation or hold state we can't see
//   - plans with a cost calculator, its cost tree is unexported
//   - custom scalar resolvers and introspection's deprecation filter, which are code
//
// Data sources are not part of the encoding. The router restores them from the data
// source ID of each fetch, see restorePlanDataSources.
var planCodec = sync.OnceValue(func() *graphcodec.Codec {
	b := graphcodec.NewBuilder().Register(
		// plan.Plan
		&plan.SynchronousResponsePlan{},
		&plan.DeferResponsePlan{},
		// resolve.Node
		&resolve.Object{},
		&resolve.EmptyObject{},
		&resolve.Array{},
		&resolve.EmptyArray{},
		&resolve.Null{},
		&resolve.String{},
		&resolve.StaticString{},
		&resolve.Boolean{},
		&resolve.Integer{},
		&resolve.Float{},
		&resolve.BigInt{},
		&resolve.Scalar{},
		&resolve.Enum{},
		// resolve.Fetch
		&resolve.SingleFetch{},
		&resolve.EntityFetch{},
		&resolve.BatchEntityFetch{},
		&resolve.MultiEntityFetch{},
		// resolve.Variable
		&resolve.ContextVariable{},
		&resolve.ObjectVariable{},
		&resolve.HeaderVariable{},
		&resolve.ResolvableObjectVariable{},
		// resolve.VariableRenderer
		&resolve.JSONVariableRenderer{},
		&resolve.PlainVariableRenderer{},
		&resolve.GraphQLVariableRenderer{},
		&resolve.CSVVariableRenderer{},
		&resolve.GraphQLVariableResolveRenderer{},
	)
	graphcodec.OmitInterface(b, func(ds resolve.DataSource) error {
		if _, ok := ds.(*graphql_datasource.Source); ok {
			return nil
		}
		return fmt.Errorf("fetches using a %T data source can only be planned by the router", ds)
	})
	return b.Build(reflect.TypeFor[transferredPlan]())
})

func encodePlan(p plan.Plan) ([]byte, error) {
	return planCodec().Marshal(&transferredPlan{Plan: p})
}

// decodePlan decodes a plan produced by encodePlan. The fetches of the returned plan
// have no data sources yet. The number of data sources that have to be restored is
// returned along with the plan.
func decodePlan(data []byte) (_ plan.Plan, dataSources int, _ error) {
	var out transferredPlan
	dataSources, err := planCodec().Unmarshal(data, &out)
	if err != nil {
		return nil, 0, err
	}
	if out.Plan == nil {
		return nil, 0, errors.New("decoded plan is empty")
	}
	return out.Plan, dataSources, nil
}

// restorePlanDataSources attaches a data source to every fetch of a decoded plan.
// The lookup returns false for data sources the router can't provide.
//
// A fetch without a data source fails when it is executed. To make sure none is left
// behind, expected is the number of data sources decodePlan reported as missing. If
// we find more or less fetches than that, the plan has fetches in a place we don't
// know about and must not be used.
func restorePlanDataSources(p plan.Plan, expected int, lookup func(dataSourceID string) (resolve.DataSource, bool)) error {
	restored := make(map[resolve.Fetch]struct{})
	err := forEachPlanFetch(p, func(fetch resolve.Fetch) error {
		if _, ok := restored[fetch]; ok {
			return nil
		}
		restored[fetch] = struct{}{}
		info := fetch.FetchInfo()
		if info == nil {
			return errors.New("fetch has no info to identify its data source")
		}
		ds, ok := lookup(info.DataSourceID)
		if !ok {
			return fmt.Errorf("no transferable data source with ID %q", info.DataSourceID)
		}
		switch f := fetch.(type) {
		case *resolve.SingleFetch:
			f.DataSource = ds
		case *resolve.EntityFetch:
			f.DataSource = ds
		case *resolve.BatchEntityFetch:
			f.DataSource = ds
		case *resolve.MultiEntityFetch:
			f.DataSource = ds
		default:
			return fmt.Errorf("unknown fetch type %T", fetch)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if len(restored) != expected {
		return fmt.Errorf("plan needs %d data sources, but %d fetches were found", expected, len(restored))
	}
	return nil
}

// forEachPlanFetch calls fn for every fetch of the plan.
func forEachPlanFetch(p plan.Plan, fn func(resolve.Fetch) error) error {
	switch p := p.(type) {
	case *plan.SynchronousResponsePlan:
		return forEachResponseFetch(p.Response, fn)
	case *plan.DeferResponsePlan:
		if p.Response == nil {
			return nil
		}
		if err := forEachResponseFetch(p.Response.Response, fn); err != nil {
			return err
		}
		// The postprocessor moves the deferred groups from the list into the tree.
		// Both are visited, in case that is disabled or changes.
		visited := make(map[*resolve.DeferFetchGroup]struct{})
		visit := func(group *resolve.DeferFetchGroup) error {
			if group == nil {
				return nil
			}
			if _, ok := visited[group]; ok {
				return nil
			}
			visited[group] = struct{}{}
			return forEachTreeFetch(group.Fetches, fn)
		}
		for _, group := range p.Response.Defers {
			if err := visit(group); err != nil {
				return err
			}
		}
		return forEachDeferTreeGroup(p.Response.DeferTree, visit)
	}
	return fmt.Errorf("unknown plan type %T", p)
}

func forEachResponseFetch(response *resolve.GraphQLResponse, fn func(resolve.Fetch) error) error {
	if response == nil {
		return nil
	}
	for _, item := range response.RawFetches {
		if item == nil || item.Fetch == nil {
			continue
		}
		if err := fn(item.Fetch); err != nil {
			return err
		}
	}
	return forEachTreeFetch(response.Fetches, fn)
}

func forEachDeferTreeGroup(node *resolve.DeferTreeNode, fn func(*resolve.DeferFetchGroup) error) error {
	if node == nil {
		return nil
	}
	if err := fn(node.Item); err != nil {
		return err
	}
	for _, child := range node.ChildNodes {
		if err := forEachDeferTreeGroup(child, fn); err != nil {
			return err
		}
	}
	return nil
}

func forEachTreeFetch(node *resolve.FetchTreeNode, fn func(resolve.Fetch) error) error {
	if node == nil {
		return nil
	}
	if node.Item != nil && node.Item.Fetch != nil {
		if err := fn(node.Item.Fetch); err != nil {
			return err
		}
	}
	if err := forEachTreeFetch(node.Trigger, fn); err != nil {
		return err
	}
	for _, child := range node.ChildNodes {
		if err := forEachTreeFetch(child, fn); err != nil {
			return err
		}
	}
	return nil
}
