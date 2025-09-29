package generated

import (
	"context"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph/model"
)

// PopulateConsultancyRequires is the requires populator for the Consultancy entity.
func (ec *executionContext) PopulateConsultancyRequires(ctx context.Context, entity *model.Consultancy, reps map[string]any) error {
	if lead, ok := reps["lead"].(map[string]interface{}); ok {
		if isAvailable, ok := lead["isAvailable"].(bool); ok {
			entity.IsLeadAvailable = &isAvailable
		}
	}
	return nil
}

// PopulateCosmoRequires is the requires populator for the Cosmo entity.
func (ec *executionContext) PopulateCosmoRequires(ctx context.Context, entity *model.Cosmo, reps map[string]any) error {
	if lead, ok := reps["lead"].(map[string]interface{}); ok {
		if isAvailable, ok := lead["isAvailable"].(bool); ok {
			entity.IsLeadAvailable = &isAvailable
		}
	}
	return nil
}

// PopulateEmployeeRequires is the requires populator for the Employee entity.
func (ec *executionContext) PopulateEmployeeRequires(ctx context.Context, entity *model.Employee, reps map[string]any) error {
	if mood, ok := reps["currentMood"].(string); ok {
		entity.DerivedMood = model.Mood(mood)
	}
	return nil
}
