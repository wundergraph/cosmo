package subgraph

// This file will be automatically regenerated based on the schema, any resolver implementations
// will be copied through when generating and any unknown code will be moved to the end.
// Code generated by github.com/99designs/gqlgen version v0.17.39

import (
	"context"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/products/subgraph/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/products/subgraph/model"
)

// FindEmployeeByID is the resolver for the findEmployeeByID field.
func (r *entityResolver) FindEmployeeByID(ctx context.Context, id int) (*model.Employee, error) {
	switch id {
	// Dustin, Nithin, Suvij
	case 2, 7, 8:
		return &model.Employee{
			Products: []model.ProductNames{
				model.ProductNamesCloud,
				model.ProductNamesCosmo,
				model.ProductNamesSdk,
			},
		}, nil
	// Stefan,
	case 3:
		return &model.Employee{
			Products: []model.ProductNames{
				model.ProductNamesMarketing,
			},
		}, nil
	// Björn
	case 4:
		return &model.Employee{
			Products: []model.ProductNames{
				model.ProductNamesFinance,
				model.ProductNamesHumanResources,
				model.ProductNamesMarketing,
			},
		}, nil
	// Sergiy
	case 5:
		return &model.Employee{
			Products: []model.ProductNames{
				model.ProductNamesEngine,
				model.ProductNamesSdk,
			},
		}, nil
	// Alexandra
	case 11:
		return &model.Employee{
			Products: []model.ProductNames{
				model.ProductNamesFinance,
			},
		}, nil
	// Alberto, David
	case 9, 12:
		return &model.Employee{
			Products: model.AllProductNames,
		}, nil
	// Eelco
	case 10:
		return &model.Employee{
			Products: []model.ProductNames{
				model.ProductNamesCloud,
				model.ProductNamesSdk,
			},
		}, nil
	// Jens
	default:
		return &model.Employee{
			Products: []model.ProductNames{
				model.ProductNamesCosmo,
				model.ProductNamesEngine,
				model.ProductNamesSdk,
			},
		}, nil
	}
}

// Entity returns generated1.EntityResolver implementation.
func (r *Resolver) Entity() generated.EntityResolver { return &entityResolver{r} }

type entityResolver struct{ *Resolver }
