package service

import (
	service "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/src/data"
)

// Helper functions to populate relationships
func (p *ProjectsService) populateProjectRelationships(project *service.Project) *service.Project {
	// Create a copy to avoid modifying the original
	populatedProject := &service.Project{
		Id:           project.Id,
		Name:         project.Name,
		Description:  project.Description,
		Status:       project.Status,
		StartDate:    project.StartDate,
		EndDate:      project.EndDate,
		MilestoneIds: project.MilestoneIds,
		Progress:     project.Progress,
		// Populate relationships with populated versions
		Milestones:      p.populateMilestonesList(data.GetMilestonesByProjectID(project.Id)),
		Tasks:           p.populateTasksList(data.GetTasksByProjectID(project.Id)),
		TeamMembers:     data.GetTeamMembersByProjectId(project.Id),
		RelatedProducts: p.getRelatedProductsByProjectId(project.Id),
		// Populate all new fields with helper functions
		Tags:                project.Tags, // Keep original tags
		AlternativeProjects: data.GetAlternativeProjects(project.Id),
		Dependencies:        data.GetProjectDependencies(project.Id),
		ResourceGroups:      data.GetResourceGroups(project.Id),
		TasksByPhase:        data.GetTasksByPhase(project.Id),
		MilestoneGroups:     data.GetMilestoneGroups(project.Id),
		PriorityMatrix:      data.GetPriorityMatrix(project.Id),
	}

	return populatedProject
}

// Helper function to populate a list of milestones with their relationships
func (p *ProjectsService) populateMilestonesList(milestones []*service.Milestone) []*service.Milestone {
	var populatedMilestones []*service.Milestone
	for _, milestone := range milestones {
		populatedMilestones = append(populatedMilestones, data.PopulateMilestoneRelationships(milestone))
	}
	return populatedMilestones
}

// Helper function to populate a list of tasks with their relationships
func (p *ProjectsService) populateTasksList(tasks []*service.Task) []*service.Task {
	var populatedTasks []*service.Task
	for _, task := range tasks {
		populatedTasks = append(populatedTasks, data.PopulateTaskRelationships(task))
	}
	return populatedTasks
}

func (p *ProjectsService) populateProjectUpdateRelationships(update *service.ProjectUpdate) *service.ProjectUpdate {
	// ProjectUpdate now only has ID references - no nested objects to populate
	return update
}

func (p *ProjectsService) getRelatedProductsByProjectId(projectId string) []*service.Product {
	var products []*service.Product

	// Use the configurable mapping instead of hardcoded switch-case
	if productUpcs, exists := projectToProductMap[projectId]; exists {
		for _, upc := range productUpcs {
			if product := data.GetProductByUpc(upc); product != nil {
				products = append(products, product)
			}
		}
	}

	return products
}
