package generated

import (
	"context"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph/model"
)

// PopulateConsultancyRequires is the requires populator for the Consultancy entity.
func (ec *executionContext) PopulateConsultancyRequires(ctx context.Context, entity *model.Consultancy, reps map[string]interface{}) error {
	entity.IsLeadAvailable = &entity.Lead.IsAvailable
	return nil
}

// PopulateEmployeeRequires is the requires populator for the Employee entity.
func (ec *executionContext) PopulateEmployeeRequires(ctx context.Context, entity *model.Employee, reps map[string]interface{}) error {
	entity.DerivedID = entity.ID
	return nil
}
