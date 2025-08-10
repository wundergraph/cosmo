package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

var ServiceProjects = []*projects.Project{
	{
		Id:                  "1",
		Name:                "Cloud Migration Overhaul",
		Description:         &wrapperspb.StringValue{Value: "Migrate legacy systems to cloud-native architecture"},
		Status:              projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:           &wrapperspb.StringValue{Value: "2021-01-01"},
		EndDate:             &wrapperspb.StringValue{Value: "2025-08-20"},
		TeamMembers:         []*projects.Employee{},
		RelatedProducts:     []*projects.Product{}, // Will be resolved by GraphQL resolvers
		MilestoneIds:        &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"1", "2", "3"}}},
		Milestones:          GetMilestonesByProjectID("1"),
		Tasks:               GetTasksByProjectID("1"),
		Progress:            &wrapperspb.DoubleValue{Value: 65.0},
		Tags:                &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"cloud", "migration", "priority"}}},
		AlternativeProjects: &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}}, // nullable list of nullable projects
		Dependencies:        &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}}, // will be populated by helper function
		ResourceGroups:      &projects.ListOfListOfProjectResource{},                                                   // will be populated by helper function
		TasksByPhase:        &projects.ListOfListOfTask{},                                                              // will be populated by helper function
		MilestoneGroups:     &projects.ListOfListOfMilestone{},                                                         // nullable nested list
		PriorityMatrix:      &projects.ListOfListOfListOfTask{},                                                        // triple nested
	},
	{
		Id:                  "2",
		Name:                "Microservices Revolution",
		Description:         &wrapperspb.StringValue{Value: "Break down monolith into microservices"},
		Status:              projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:           &wrapperspb.StringValue{Value: "2021-01-01"},
		EndDate:             &wrapperspb.StringValue{Value: "2025-08-20"},
		TeamMembers:         []*projects.Employee{},
		RelatedProducts:     []*projects.Product{},
		MilestoneIds:        &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"4", "5", "6"}}},
		Milestones:          GetMilestonesByProjectID("2"),
		Tasks:               GetTasksByProjectID("2"),
		Progress:            &wrapperspb.DoubleValue{Value: 75.0},
		Tags:                &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"microservices", "architecture"}}},
		AlternativeProjects: &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		Dependencies:        &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		ResourceGroups:      &projects.ListOfListOfProjectResource{},
		TasksByPhase:        &projects.ListOfListOfTask{},
		MilestoneGroups:     &projects.ListOfListOfMilestone{},
		PriorityMatrix:      &projects.ListOfListOfListOfTask{},
	},
	{
		Id:                  "3",
		Name:                "AI-Powered Analytics",
		Description:         &wrapperspb.StringValue{Value: "Implement machine learning for business intelligence"},
		Status:              projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:           &wrapperspb.StringValue{Value: "2021-01-01"},
		EndDate:             &wrapperspb.StringValue{Value: "2025-08-20"},
		TeamMembers:         []*projects.Employee{},
		RelatedProducts:     []*projects.Product{},
		MilestoneIds:        &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{}}},
		Milestones:          GetMilestonesByProjectID("3"),
		Tasks:               GetTasksByProjectID("3"),
		Progress:            &wrapperspb.DoubleValue{Value: 45.0},
		Tags:                nil, // nullable list example
		AlternativeProjects: &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		Dependencies:        &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		ResourceGroups:      &projects.ListOfListOfProjectResource{},
		TasksByPhase:        &projects.ListOfListOfTask{},
		MilestoneGroups:     nil, // nullable nested list example
		PriorityMatrix:      &projects.ListOfListOfListOfTask{},
	},
	{
		Id:                  "4",
		Name:                "DevOps Transformation",
		Description:         &wrapperspb.StringValue{Value: "Implement CI/CD and infrastructure as code"},
		Status:              projects.ProjectStatus_PROJECT_STATUS_PLANNING,
		StartDate:           &wrapperspb.StringValue{Value: "2023-03-01"},
		EndDate:             &wrapperspb.StringValue{Value: "2024-12-31"},
		TeamMembers:         []*projects.Employee{},
		RelatedProducts:     []*projects.Product{},
		MilestoneIds:        &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{}}},
		Milestones:          GetMilestonesByProjectID("4"),
		Tasks:               GetTasksByProjectID("4"),
		Progress:            &wrapperspb.DoubleValue{Value: 10.0},
		Tags:                &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"devops", "ci-cd", "infrastructure"}}},
		AlternativeProjects: &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		Dependencies:        &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		ResourceGroups:      &projects.ListOfListOfProjectResource{},
		TasksByPhase:        &projects.ListOfListOfTask{},
		MilestoneGroups:     &projects.ListOfListOfMilestone{},
		PriorityMatrix:      &projects.ListOfListOfListOfTask{},
	},
	{
		Id:                  "5",
		Name:                "Security Overhaul",
		Description:         &wrapperspb.StringValue{Value: "Implement zero-trust security architecture"},
		Status:              projects.ProjectStatus_PROJECT_STATUS_ON_HOLD,
		StartDate:           &wrapperspb.StringValue{Value: "2023-06-01"},
		EndDate:             &wrapperspb.StringValue{Value: "2024-06-30"},
		TeamMembers:         []*projects.Employee{},
		RelatedProducts:     []*projects.Product{},
		MilestoneIds:        &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{}}},
		Milestones:          GetMilestonesByProjectID("5"),
		Tasks:               GetTasksByProjectID("5"),
		Progress:            &wrapperspb.DoubleValue{Value: 5.0},
		Tags:                &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"security", "zero-trust"}}},
		AlternativeProjects: &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		Dependencies:        &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		ResourceGroups:      &projects.ListOfListOfProjectResource{},
		TasksByPhase:        &projects.ListOfListOfTask{},
		MilestoneGroups:     &projects.ListOfListOfMilestone{},
		PriorityMatrix:      &projects.ListOfListOfListOfTask{},
	},
	{
		Id:                  "6",
		Name:                "Mobile App Development",
		Description:         &wrapperspb.StringValue{Value: "Build native mobile applications for iOS and Android"},
		Status:              projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:           &wrapperspb.StringValue{Value: "2023-09-01"},
		EndDate:             &wrapperspb.StringValue{Value: "2024-09-30"},
		TeamMembers:         []*projects.Employee{},
		RelatedProducts:     []*projects.Product{},
		MilestoneIds:        &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"7", "8"}}},
		Milestones:          GetMilestonesByProjectID("6"),
		Tasks:               GetTasksByProjectID("6"),
		Progress:            &wrapperspb.DoubleValue{Value: 30.0},
		Tags:                &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"mobile", "ios", "android"}}},
		AlternativeProjects: &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		Dependencies:        &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		ResourceGroups:      &projects.ListOfListOfProjectResource{},
		TasksByPhase:        &projects.ListOfListOfTask{},
		MilestoneGroups:     &projects.ListOfListOfMilestone{},
		PriorityMatrix:      &projects.ListOfListOfListOfTask{},
	},
	{
		Id:                  "7",
		Name:                "Data Lake Implementation",
		Description:         &wrapperspb.StringValue{Value: "Build enterprise data lake for analytics"},
		Status:              projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:           &wrapperspb.StringValue{Value: "2023-01-01"},
		EndDate:             &wrapperspb.StringValue{Value: "2024-12-31"},
		TeamMembers:         []*projects.Employee{},
		RelatedProducts:     []*projects.Product{},
		MilestoneIds:        &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"9", "10"}}},
		Milestones:          GetMilestonesByProjectID("7"),
		Tasks:               GetTasksByProjectID("7"),
		Progress:            &wrapperspb.DoubleValue{Value: 40.0},
		Tags:                &projects.ListOfString{List: &projects.ListOfString_List{Items: []string{"data", "analytics", "lake"}}},
		AlternativeProjects: &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		Dependencies:        &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{}}},
		ResourceGroups:      &projects.ListOfListOfProjectResource{},
		TasksByPhase:        &projects.ListOfListOfTask{},
		MilestoneGroups:     &projects.ListOfListOfMilestone{},
		PriorityMatrix:      &projects.ListOfListOfListOfTask{},
	},
}

// Helper function to get project by ID
func GetProjectByID(id string) *projects.Project {
	for _, project := range ServiceProjects {
		if project.Id == id {
			return project
		}
	}
	return nil
}

// Helper function to get milestones by project ID
func GetMilestonesByProjectID(projectID string) []*projects.Milestone {
	var milestones []*projects.Milestone
	for _, milestone := range ServiceMilestones {
		if milestone.ProjectId == projectID {
			milestones = append(milestones, milestone)
		}
	}
	return milestones
}

// Helper function to get tasks by project ID
func GetTasksByProjectID(projectID string) []*projects.Task {
	var tasks []*projects.Task
	for _, task := range ServiceTasks {
		if task.ProjectId == projectID {
			tasks = append(tasks, task)
		}
	}
	return tasks
}

// Helper function to get tasks by milestone ID
func GetTasksByMilestoneID(milestoneID string) []*projects.Task {
	var tasks []*projects.Task
	for _, task := range ServiceTasks {
		if task.MilestoneId != nil && task.MilestoneId.Value == milestoneID {
			tasks = append(tasks, task)
		}
	}
	return tasks
}

// Helper function to get project updates by project ID
func GetProjectUpdatesByProjectID(projectID string) []*projects.ProjectUpdate {
	var updates []*projects.ProjectUpdate
	for _, update := range ServiceProjectUpdates {
		if update.ProjectId == projectID {
			updates = append(updates, update)
		}
	}
	return updates
}

func GetTeamMembersByProjectId(projectID string) []*projects.Employee {
	var teamMembers []*projects.Employee
	for _, employee := range Employees {
		if employee.Projects != nil && employee.Projects.List != nil {
			for _, project := range employee.Projects.List.Items {
				if project.Id == projectID {
					teamMembers = append(teamMembers, employee)
				}
			}
		}
	}

	return teamMembers
}

// Helper function to get all unique project tags
func GetAllProjectTags() *projects.ListOfString {
	tagSet := make(map[string]bool)
	var allTags []string

	for _, project := range ServiceProjects {
		if project.Tags != nil && project.Tags.List != nil {
			for _, tag := range project.Tags.List.Items {
				if !tagSet[tag] {
					tagSet[tag] = true
					allTags = append(allTags, tag)
				}
			}
		}
	}

	// Add some nullable tags for testing
	allTags = append(allTags, "", "nullable-tag") // "" represents a nullable string

	return &projects.ListOfString{List: &projects.ListOfString_List{Items: allTags}}
}

// Helper function to get archived projects (for testing nullable list of nullable projects)
func GetArchivedProjects() []*projects.Project {
	var archived []*projects.Project

	// Add completed projects as archived
	for _, project := range ServiceProjects {
		if project.Status == projects.ProjectStatus_PROJECT_STATUS_COMPLETED {
			archived = append(archived, project)
		}
	}

	// Add nil for testing nullable list of nullable projects
	archived = append(archived, nil)

	return archived
}

// Helper function to get project dependencies
func GetProjectDependencies(projectID string) *projects.ListOfProject {
	dependencies := []*projects.Project{}

	// Simple dependency logic for testing
	switch projectID {
	case "2": // Microservices depends on Cloud Migration
		dependencies = append(dependencies, GetProjectByID("1"))
	case "3": // AI Analytics depends on both previous projects
		dependencies = append(dependencies, GetProjectByID("1"), GetProjectByID("2"))
	case "7": // Data Lake depends on AI Analytics
		dependencies = append(dependencies, GetProjectByID("3"))
	}

	// Add nil dependency for testing nullable items
	if len(dependencies) > 0 {
		dependencies = append(dependencies, nil)
	}

	return &projects.ListOfProject{List: &projects.ListOfProject_List{Items: dependencies}}
}

// Helper function to get alternative projects
func GetAlternativeProjects(projectID string) *projects.ListOfProject {
	alternatives := []*projects.Project{}

	// Simple alternative logic for testing
	switch projectID {
	case "1": // Cloud Migration alternatives
		alternatives = append(alternatives, GetProjectByID("4")) // DevOps could be alternative
	case "2": // Microservices alternatives
		alternatives = append(alternatives, GetProjectByID("1")) // Cloud Migration could be alternative
	case "5": // Security alternatives
		alternatives = append(alternatives, GetProjectByID("4")) // DevOps could address some security needs
	}

	return &projects.ListOfProject{List: &projects.ListOfProject_List{Items: alternatives}}
}

// Helper function to get tasks grouped by phase (status)
func GetTasksByPhase(projectID string) *projects.ListOfListOfTask {
	tasks := GetTasksByProjectID(projectID)

	todoTasks := []*projects.Task{}
	inProgressTasks := []*projects.Task{}
	reviewTasks := []*projects.Task{}
	completedTasks := []*projects.Task{}
	blockedTasks := []*projects.Task{}

	for _, task := range tasks {
		switch task.Status {
		case projects.TaskStatus_TASK_STATUS_TODO:
			todoTasks = append(todoTasks, task)
		case projects.TaskStatus_TASK_STATUS_IN_PROGRESS:
			inProgressTasks = append(inProgressTasks, task)
		case projects.TaskStatus_TASK_STATUS_REVIEW:
			reviewTasks = append(reviewTasks, task)
		case projects.TaskStatus_TASK_STATUS_COMPLETED:
			completedTasks = append(completedTasks, task)
		case projects.TaskStatus_TASK_STATUS_BLOCKED:
			blockedTasks = append(blockedTasks, task)
		}
	}

	phases := []*projects.ListOfTask{
		{List: &projects.ListOfTask_List{Items: todoTasks}},
		{List: &projects.ListOfTask_List{Items: inProgressTasks}},
		{List: &projects.ListOfTask_List{Items: reviewTasks}},
		{List: &projects.ListOfTask_List{Items: completedTasks}},
		{List: &projects.ListOfTask_List{Items: blockedTasks}},
	}

	// Add nullable list for testing
	if len(tasks) > 0 {
		phases = append(phases, nil)
	}

	return &projects.ListOfListOfTask{
		List: &projects.ListOfListOfTask_List{Items: phases},
	}
}

// Helper function to get milestone groups
func GetMilestoneGroups(projectID string) *projects.ListOfListOfMilestone {
	milestones := GetMilestonesByProjectID(projectID)

	if len(milestones) == 0 {
		return nil // nullable list for projects with no milestones
	}

	// Group by status
	pendingMilestones := []*projects.Milestone{}
	inProgressMilestones := []*projects.Milestone{}
	completedMilestones := []*projects.Milestone{}
	delayedMilestones := []*projects.Milestone{}

	for _, milestone := range milestones {
		switch milestone.Status {
		case projects.MilestoneStatus_MILESTONE_STATUS_PENDING:
			pendingMilestones = append(pendingMilestones, milestone)
		case projects.MilestoneStatus_MILESTONE_STATUS_IN_PROGRESS:
			inProgressMilestones = append(inProgressMilestones, milestone)
		case projects.MilestoneStatus_MILESTONE_STATUS_COMPLETED:
			completedMilestones = append(completedMilestones, milestone)
		case projects.MilestoneStatus_MILESTONE_STATUS_DELAYED:
			delayedMilestones = append(delayedMilestones, milestone)
		}
	}

	groups := []*projects.ListOfMilestone{
		{List: &projects.ListOfMilestone_List{Items: pendingMilestones}},
		{List: &projects.ListOfMilestone_List{Items: inProgressMilestones}},
		{List: &projects.ListOfMilestone_List{Items: completedMilestones}},
		{List: &projects.ListOfMilestone_List{Items: delayedMilestones}},
	}

	return &projects.ListOfListOfMilestone{
		List: &projects.ListOfListOfMilestone_List{Items: groups},
	}
}

// Helper function to get priority matrix (triple nested lists)
func GetPriorityMatrix(projectID string) *projects.ListOfListOfListOfTask {
	tasks := GetTasksByProjectID(projectID)

	if len(tasks) == 0 {
		return &projects.ListOfListOfListOfTask{} // empty but not null
	}

	// Build the triple nested structure
	var priorityGroups []*projects.ListOfListOfTask

	// Low priority group
	lowStatusGroups := []*projects.ListOfTask{}
	mediumStatusGroups := []*projects.ListOfTask{}
	highStatusGroups := []*projects.ListOfTask{}
	urgentStatusGroups := []*projects.ListOfTask{}

	for _, task := range tasks {
		switch task.Priority {
		case projects.TaskPriority_TASK_PRIORITY_LOW:
			lowStatusGroups = append(lowStatusGroups, &projects.ListOfTask{List: &projects.ListOfTask_List{Items: []*projects.Task{task}}})
		case projects.TaskPriority_TASK_PRIORITY_MEDIUM:
			mediumStatusGroups = append(mediumStatusGroups, &projects.ListOfTask{List: &projects.ListOfTask_List{Items: []*projects.Task{task}}})
		case projects.TaskPriority_TASK_PRIORITY_HIGH:
			highStatusGroups = append(highStatusGroups, &projects.ListOfTask{List: &projects.ListOfTask_List{Items: []*projects.Task{task}}})
		case projects.TaskPriority_TASK_PRIORITY_URGENT:
			urgentStatusGroups = append(urgentStatusGroups, &projects.ListOfTask{List: &projects.ListOfTask_List{Items: []*projects.Task{task}}})
		}
	}

	priorityGroups = append(priorityGroups, &projects.ListOfListOfTask{
		List: &projects.ListOfListOfTask_List{Items: lowStatusGroups},
	})

	priorityGroups = append(priorityGroups, &projects.ListOfListOfTask{
		List: &projects.ListOfListOfTask_List{Items: mediumStatusGroups},
	})

	priorityGroups = append(priorityGroups, &projects.ListOfListOfTask{
		List: &projects.ListOfListOfTask_List{Items: highStatusGroups},
	})

	priorityGroups = append(priorityGroups, &projects.ListOfListOfTask{
		List: &projects.ListOfListOfTask_List{Items: urgentStatusGroups},
	})

	return &projects.ListOfListOfListOfTask{
		List: &projects.ListOfListOfListOfTask_List{Items: priorityGroups},
	}
}

// Helper function to get resource groups
func GetResourceGroups(projectID string) *projects.ListOfListOfProjectResource {
	var resourceGroups []*projects.ListOfProjectResource

	// Group 1: Human resources (team members)
	teamMembers := GetTeamMembersByProjectId(projectID)
	humanResources := []*projects.ProjectResource{}
	for _, member := range teamMembers {
		humanResources = append(humanResources, &projects.ProjectResource{
			Value: &projects.ProjectResource_Employee{Employee: member},
		})
	}
	if len(humanResources) > 0 {
		resourceGroups = append(resourceGroups, &projects.ListOfProjectResource{List: &projects.ListOfProjectResource_List{Items: humanResources}})
	}

	// Group 2: Milestone resources
	milestones := GetMilestonesByProjectID(projectID)
	milestoneResources := []*projects.ProjectResource{}
	for _, milestone := range milestones {
		milestoneResources = append(milestoneResources, &projects.ProjectResource{
			Value: &projects.ProjectResource_Milestone{Milestone: milestone},
		})
	}
	if len(milestoneResources) > 0 {
		resourceGroups = append(resourceGroups, &projects.ListOfProjectResource{List: &projects.ListOfProjectResource_List{Items: milestoneResources}})
	}

	// Group 3: Task resources (first 3 tasks only for testing)
	tasks := GetTasksByProjectID(projectID)
	taskResources := []*projects.ProjectResource{}
	for i, task := range tasks {
		if i >= 3 { // Limit to 3 tasks for testing
			break
		}
		taskResources = append(taskResources, &projects.ProjectResource{
			Value: &projects.ProjectResource_Task{Task: task},
		})
	}
	if len(taskResources) > 0 {
		resourceGroups = append(resourceGroups, &projects.ListOfProjectResource{List: &projects.ListOfProjectResource_List{Items: taskResources}})
	}

	return &projects.ListOfListOfProjectResource{
		List: &projects.ListOfListOfProjectResource_List{Items: resourceGroups},
	}
}
