package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
)

// Helper function to get project history for an employee (grouped by time periods)
func GetProjectHistoryByEmployeeId(employeeId int32) *projects.ListOfListOfProject {
	// Create mock historical project assignments grouped by years
	// In a real system, this would come from a database with historical records

	var historicalGroups []*projects.ListOfProject

	switch employeeId {
	case 1: // Senior Infrastructure Engineer
		// 2021-2022: Early cloud projects
		period1 := &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[0]}, // Cloud Migration
			},
		}
		// 2023-2024: DevOps transformation
		period2 := &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[3]}, // DevOps Transformation
			},
		}
		historicalGroups = []*projects.ListOfProject{period1, period2}

	case 2: // Cloud Solutions Architect
		// 2020-2021: Legacy system work
		period1 := &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[0]}, // Cloud Migration
			},
		}
		// 2022-2023: Microservices era
		period2 := &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[1]}, // Microservices Revolution
			},
		}
		// 2024: Security focus
		period3 := &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[4]}, // Security Overhaul
			},
		}
		historicalGroups = []*projects.ListOfProject{period1, period2, period3}

	case 5: // Data Scientist
		// 2022-2023: AI projects
		period1 := &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[2]}, // AI-Powered Analytics
			},
		}
		// 2024: Data infrastructure
		period2 := &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[6]}, // Data Lake Implementation
			},
		}
		historicalGroups = []*projects.ListOfProject{period1, period2}

	case 7, 8: // Microservices team
		// 2021-2023: Microservices focus
		period1 := &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[1]}, // Microservices Revolution
			},
		}
		historicalGroups = []*projects.ListOfProject{period1}

	case 11: // Frontend developer
		// 2022-2023: Mobile app work
		period1 := &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[5]}, // Mobile App Development
			},
		}
		historicalGroups = []*projects.ListOfProject{period1}

	case 12: // Backend developer
		// 2023-2024: Data infrastructure
		period1 := &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[6]}, // Data Lake Implementation
			},
		}
		historicalGroups = []*projects.ListOfProject{period1}

	default:
		// For other employees, return empty history
		historicalGroups = []*projects.ListOfProject{}
	}

	return &projects.ListOfListOfProject{
		List: &projects.ListOfListOfProject_List{Items: historicalGroups},
	}
}

var Employees = []*projects.Employee{
	{
		Id: 1,
		Projects: &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[0], ServiceProjects[3]},
			},
		},
		AssignedTasks:  GetAssignedTasksByEmployeeId(1),
		CompletedTasks: GetCompletedTasksByEmployeeId(1),
		// New nullable and nested list fields
		Skills: &projects.ListOfString{
			List: &projects.ListOfString_List{
				Items: []string{"AWS", "Kubernetes", "Infrastructure"},
			},
		},
		Certifications: &projects.ListOfString{
			List: &projects.ListOfString_List{
				Items: []string{"AWS Solutions Architect", "CKA"},
			},
		},
		ProjectHistory: GetProjectHistoryByEmployeeId(1), // populated project history
	},
	{
		Id: 2,
		Projects: &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[0], ServiceProjects[1], ServiceProjects[4]},
			},
		},
		AssignedTasks:  GetAssignedTasksByEmployeeId(2),
		CompletedTasks: GetCompletedTasksByEmployeeId(2),
		// New fields with nullable examples
		Skills: nil, // nullable list example
		Certifications: &projects.ListOfString{
			List: &projects.ListOfString_List{
				Items: []string{"GCP Professional Cloud Architect"},
			},
		},
		ProjectHistory: GetProjectHistoryByEmployeeId(2),
	},
	{
		Id: 3,
		Projects: &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[0], ServiceProjects[5]},
			},
		},
		AssignedTasks:  GetAssignedTasksByEmployeeId(3),
		CompletedTasks: GetCompletedTasksByEmployeeId(3),
		// New fields
		Skills: &projects.ListOfString{
			List: &projects.ListOfString_List{
				Items: []string{"Networking", "Security", "Monitoring"},
			},
		},
		Certifications: &projects.ListOfString{
			List: &projects.ListOfString_List{
				Items: []string{"CISSP", "CCNA"},
			},
		},
		ProjectHistory: GetProjectHistoryByEmployeeId(3),
	},
	{
		Id: 4,
		Projects: &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[1]},
			},
		},
		AssignedTasks:  GetAssignedTasksByEmployeeId(4),
		CompletedTasks: GetCompletedTasksByEmployeeId(4),
		Skills: &projects.ListOfString{
			List: &projects.ListOfString_List{
				Items: []string{"Java", "Spring", "Microservices"},
			},
		},
		Certifications: &projects.ListOfString{
			List: &projects.ListOfString_List{
				Items: []string{"Oracle Certified Professional Java SE"},
			},
		},
		ProjectHistory: GetProjectHistoryByEmployeeId(4),
	},
	{
		Id: 5,
		Projects: &projects.ListOfProject{List: &projects.ListOfProject_List{
			Items: []*projects.Project{ServiceProjects[2], ServiceProjects[6]},
		}},
		AssignedTasks:  GetAssignedTasksByEmployeeId(5),
		CompletedTasks: GetCompletedTasksByEmployeeId(5),
		Skills: &projects.ListOfString{
			List: &projects.ListOfString_List{
				Items: []string{"Python", "Machine Learning", "Data Science"},
			},
		},
		Certifications: &projects.ListOfString{
			List: &projects.ListOfString_List{
				Items: []string{"Google Professional Data Engineer"},
			},
		},
		ProjectHistory: GetProjectHistoryByEmployeeId(5),
	},
	{
		Id: 6,
		Projects: &projects.ListOfProject{
			List: &projects.ListOfProject_List{
				Items: []*projects.Project{ServiceProjects[2]},
			},
		},
		AssignedTasks:  GetAssignedTasksByEmployeeId(6),
		CompletedTasks: GetCompletedTasksByEmployeeId(6),
		Skills: &projects.ListOfString{
			List: &projects.ListOfString_List{
				Items: []string{"TensorFlow", "PyTorch", "Computer Vision"},
			},
		},
		Certifications: &projects.ListOfString{
			List: &projects.ListOfString_List{
				Items: []string{"AWS Certified Machine Learning"},
			},
		},
		ProjectHistory: GetProjectHistoryByEmployeeId(6),
	},
	{
		Id: 7,
		Projects: &projects.ListOfProject{List: &projects.ListOfProject_List{
			Items: []*projects.Project{ServiceProjects[1]},
		}},
		AssignedTasks:  GetAssignedTasksByEmployeeId(7),
		CompletedTasks: GetCompletedTasksByEmployeeId(7),
		Skills: &projects.ListOfString{List: &projects.ListOfString_List{
			Items: []string{"System Architecture", "Distributed Systems"},
		}},
		Certifications: &projects.ListOfString{List: &projects.ListOfString_List{
			Items: []string{"TOGAF 9 Certified"},
		}},
		ProjectHistory: GetProjectHistoryByEmployeeId(7),
	},
	{
		Id: 8,
		Projects: &projects.ListOfProject{List: &projects.ListOfProject_List{
			Items: []*projects.Project{ServiceProjects[1]},
		}},
		AssignedTasks:  GetAssignedTasksByEmployeeId(8),
		CompletedTasks: GetCompletedTasksByEmployeeId(8),
		Skills: &projects.ListOfString{List: &projects.ListOfString_List{
			Items: []string{"Node.js", "GraphQL", "REST APIs"},
		}},
		Certifications: &projects.ListOfString{List: &projects.ListOfString_List{
			Items: []string{"MongoDB Certified Developer"},
		}},
		ProjectHistory: GetProjectHistoryByEmployeeId(8),
	},
	{
		Id: 9,
		Projects: &projects.ListOfProject{List: &projects.ListOfProject_List{
			Items: []*projects.Project{ServiceProjects[3], ServiceProjects[4]},
		}},
		AssignedTasks:  GetAssignedTasksByEmployeeId(9),
		CompletedTasks: GetCompletedTasksByEmployeeId(9),
		Skills: &projects.ListOfString{List: &projects.ListOfString_List{
			Items: []string{"DevOps", "Terraform", "Ansible"},
		}},
		Certifications: &projects.ListOfString{List: &projects.ListOfString_List{
			Items: []string{"HashiCorp Certified Terraform Associate"},
		}},
		ProjectHistory: GetProjectHistoryByEmployeeId(9),
	},
	{
		Id: 10,
		Projects: &projects.ListOfProject{List: &projects.ListOfProject_List{
			Items: []*projects.Project{ServiceProjects[4]},
		}},
		AssignedTasks:  GetAssignedTasksByEmployeeId(10),
		CompletedTasks: GetCompletedTasksByEmployeeId(10),
		Skills: &projects.ListOfString{List: &projects.ListOfString_List{
			Items: []string{"Backend", "Go", "Docker"},
		}},
		Certifications: &projects.ListOfString{List: &projects.ListOfString_List{
			Items: []string{"HashiCorp Certified Terraform Associate"},
		}},
		ProjectHistory: GetProjectHistoryByEmployeeId(10),
	},
	{
		Id: 11,
		Projects: &projects.ListOfProject{List: &projects.ListOfProject_List{
			Items: []*projects.Project{ServiceProjects[5]},
		}},
		AssignedTasks:  GetAssignedTasksByEmployeeId(11),
		CompletedTasks: GetCompletedTasksByEmployeeId(11),
		Skills: &projects.ListOfString{List: &projects.ListOfString_List{
			Items: []string{"Frontend", "React", "TypeScript"},
		}},
		Certifications: nil,
		ProjectHistory: GetProjectHistoryByEmployeeId(11),
	},
	{
		Id: 12,
		Projects: &projects.ListOfProject{List: &projects.ListOfProject_List{
			Items: []*projects.Project{ServiceProjects[6]},
		}},
		AssignedTasks:  GetAssignedTasksByEmployeeId(12),
		CompletedTasks: GetCompletedTasksByEmployeeId(12),
		Skills: &projects.ListOfString{List: &projects.ListOfString_List{
			Items: []string{"Backend", "Go", "Docker"},
		}},
		Certifications: &projects.ListOfString{List: &projects.ListOfString_List{
			Items: []string{"HashiCorp Certified Terraform Associate"},
		}},
		ProjectHistory: GetProjectHistoryByEmployeeId(12),
	},
}

// Helper function to get employee by ID
func GetEmployeeById(id int32) *projects.Employee {
	for _, employee := range Employees {
		if employee.Id == id {
			return employee
		}
	}
	return nil
}

// Helper function to get assigned tasks by employee ID
func GetAssignedTasksByEmployeeId(employeeId int32) []*projects.Task {
	var tasks []*projects.Task
	for _, task := range ServiceTasks {
		if task.AssigneeId != nil && task.AssigneeId.Value == employeeId &&
			task.Status != projects.TaskStatus_TASK_STATUS_COMPLETED {
			tasks = append(tasks, task)
		}
	}
	return tasks
}

// Helper function to get completed tasks by employee ID
func GetCompletedTasksByEmployeeId(employeeId int32) []*projects.Task {
	var tasks []*projects.Task
	for _, task := range ServiceTasks {
		if task.AssigneeId != nil && task.AssigneeId.Value == employeeId &&
			task.Status == projects.TaskStatus_TASK_STATUS_COMPLETED {
			tasks = append(tasks, task)
		}
	}
	return tasks
}

// Helper function to get employee by ID
func GetEmployeeByID(id int32) *projects.Employee {
	for _, employee := range Employees {
		if employee.Id == id {
			return employee
		}
	}
	return nil
}
