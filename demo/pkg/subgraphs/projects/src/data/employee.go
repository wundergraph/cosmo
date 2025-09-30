package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
)

var Employees = []*projects.Employee{
	{
		Id:             1,
		Projects:       []*projects.Project{ServiceProjects[0], ServiceProjects[3]},
		AssignedTasks:  GetAssignedTasksByEmployeeId(1),
		CompletedTasks: GetCompletedTasksByEmployeeId(1),
	},
	{
		Id:             2,
		Projects:       []*projects.Project{ServiceProjects[0], ServiceProjects[1], ServiceProjects[4]},
		AssignedTasks:  GetAssignedTasksByEmployeeId(2),
		CompletedTasks: GetCompletedTasksByEmployeeId(2),
	},
	{
		Id:             3,
		Projects:       []*projects.Project{ServiceProjects[0], ServiceProjects[5]},
		AssignedTasks:  GetAssignedTasksByEmployeeId(3),
		CompletedTasks: GetCompletedTasksByEmployeeId(3),
	},
	{
		Id:             4,
		Projects:       []*projects.Project{ServiceProjects[3]},
		AssignedTasks:  GetAssignedTasksByEmployeeId(4),
		CompletedTasks: GetCompletedTasksByEmployeeId(4),
	},
	{
		Id:             5,
		Projects:       []*projects.Project{ServiceProjects[2], ServiceProjects[6]},
		AssignedTasks:  GetAssignedTasksByEmployeeId(5),
		CompletedTasks: GetCompletedTasksByEmployeeId(5),
	},
	{
		Id:             7,
		Projects:       []*projects.Project{ServiceProjects[2], ServiceProjects[1]},
		AssignedTasks:  GetAssignedTasksByEmployeeId(7),
		CompletedTasks: GetCompletedTasksByEmployeeId(7),
	},
	{
		Id:             8,
		Projects:       []*projects.Project{ServiceProjects[1]},
		AssignedTasks:  GetAssignedTasksByEmployeeId(8),
		CompletedTasks: GetCompletedTasksByEmployeeId(8),
	},
	{
		Id:             10,
		Projects:       []*projects.Project{ServiceProjects[4]},
		AssignedTasks:  GetAssignedTasksByEmployeeId(10),
		CompletedTasks: GetCompletedTasksByEmployeeId(10),
	},
	{
		Id:             11,
		Projects:       []*projects.Project{ServiceProjects[5]},
		AssignedTasks:  GetAssignedTasksByEmployeeId(11),
		CompletedTasks: GetCompletedTasksByEmployeeId(11),
	},
	{
		Id:             12,
		Projects:       []*projects.Project{ServiceProjects[6]},
		AssignedTasks:  GetAssignedTasksByEmployeeId(12),
		CompletedTasks: GetCompletedTasksByEmployeeId(12),
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
