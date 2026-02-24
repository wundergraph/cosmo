package integration

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestGRPCSubgraph(t *testing.T) {
	t.Parallel()

	t.Run("Should successfully start the subgraph and make requests", func(t *testing.T) {
		t.Parallel()
		tests := []struct {
			name     string
			query    string
			expected string
		}{
			{
				name:     "query projects simple",
				query:    `query { projects { id name } }`,
				expected: `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Development"},{"id":"7","name":"Data Lake Implementation"}]}}`,
			},
			{
				name:     "query projects with argument",
				query:    `query { project(id: 1) { id name description status }}`,
				expected: `{"data":{"project":{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"}}}`,
			},
			{
				name:     "query project with nested field",
				query:    `query { project(id: 1) { description teamMembers { details { forename surname }}}}`,
				expected: `{"data":{"project":{"description":"Migrate legacy systems to cloud-native architecture","teamMembers":[{"details":{"forename":"Jens","surname":"Neuse"}},{"details":{"forename":"Dustin","surname":"Deus"}},{"details":{"forename":"Stefan","surname":"Avram"}}]}}}`,
			},
			{
				name:     "query project list with nested field",
				query:    `query { projects { id name milestoneIds teamMembers { id notes currentMood } } }`,
				expected: `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul","milestoneIds":["1","2","3"],"teamMembers":[{"id":1,"notes":"Jens notes resolved by products","currentMood":"HAPPY"},{"id":2,"notes":"Dustin notes resolved by products","currentMood":"HAPPY"},{"id":3,"notes":"Stefan notes resolved by products","currentMood":"HAPPY"}]},{"id":"2","name":"Microservices Revolution","milestoneIds":["4","5","6"],"teamMembers":[{"id":2,"notes":"Dustin notes resolved by products","currentMood":"HAPPY"},{"id":4,"notes":"Björn notes resolved by products","currentMood":"HAPPY"},{"id":7,"notes":"Suvij notes resolved by products","currentMood":"HAPPY"},{"id":8,"notes":"Nithin notes resolved by products","currentMood":"HAPPY"}]},{"id":"3","name":"AI-Powered Analytics","milestoneIds":[],"teamMembers":[{"id":5,"notes":"Sergiy notes resolved by products","currentMood":"HAPPY"},{"id":6,"notes":null,"currentMood":"HAPPY"}]},{"id":"4","name":"DevOps Transformation","milestoneIds":[],"teamMembers":[{"id":1,"notes":"Jens notes resolved by products","currentMood":"HAPPY"},{"id":9,"notes":null,"currentMood":"HAPPY"}]},{"id":"5","name":"Security Overhaul","milestoneIds":[],"teamMembers":[{"id":2,"notes":"Dustin notes resolved by products","currentMood":"HAPPY"},{"id":9,"notes":null,"currentMood":"HAPPY"},{"id":10,"notes":"Eelco notes resolved by products","currentMood":"HAPPY"}]},{"id":"6","name":"Mobile App Development","milestoneIds":["7","8"],"teamMembers":[{"id":3,"notes":"Stefan notes resolved by products","currentMood":"HAPPY"},{"id":11,"notes":"Alexandra notes resolved by products","currentMood":"HAPPY"}]},{"id":"7","name":"Data Lake Implementation","milestoneIds":["9","10"],"teamMembers":[{"id":5,"notes":"Sergiy notes resolved by products","currentMood":"HAPPY"},{"id":12,"notes":"David notes resolved by products","currentMood":"HAPPY"}]}]}}`,
			},
			{
				name:     "query employee list with nested field",
				query:    `query  {employees {id details { forename surname } projects { id name description status }}}`,
				expected: `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"4","name":"DevOps Transformation","description":"Implement CI/CD and infrastructure as code","status":"PLANNING"}]},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"},{"id":"5","name":"Security Overhaul","description":"Implement zero-trust security architecture","status":"ON_HOLD"}]},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"6","name":"Mobile App Development","description":"Build native mobile applications for iOS and Android","status":"ACTIVE"}]},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"projects":[{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"}]},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"projects":[{"id":"3","name":"AI-Powered Analytics","description":"Implement machine learning for business intelligence","status":"ACTIVE"},{"id":"7","name":"Data Lake Implementation","description":"Build enterprise data lake for analytics","status":"ACTIVE"}]},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"projects":[{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"}]},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"projects":[{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"}]},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"projects":[{"id":"5","name":"Security Overhaul","description":"Implement zero-trust security architecture","status":"ON_HOLD"}]},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"projects":[{"id":"6","name":"Mobile App Development","description":"Build native mobile applications for iOS and Android","status":"ACTIVE"}]},{"id":12,"details":{"forename":"David","surname":"Stutt"},"projects":[{"id":"7","name":"Data Lake Implementation","description":"Build enterprise data lake for analytics","status":"ACTIVE"}]}]}}`,
			},
			{
				name:     "query project resources with inline fragment",
				query:    `query { projectResources(projectId: "1") { __typename ... on Milestone { __typename id name }}}`,
				expected: `{"data":{"projectResources":[{"__typename":"Employee"},{"__typename":"Employee"},{"__typename":"Employee"},{"__typename":"Product"},{"__typename":"Milestone","id":"1","name":"Infrastructure Assessment"},{"__typename":"Milestone","id":"2","name":"Cloud Environment Setup"},{"__typename":"Milestone","id":"3","name":"Application Migration"},{"__typename":"Task"},{"__typename":"Task"},{"__typename":"Task"},{"__typename":"Task"}]}}`,
			},
			{
				name:     "query project resources with multiple inline fragments",
				query:    `query { projectResources(projectId: "1") { ... on Milestone { __typename id name } ... on Task { __typename projectId name description }} }`,
				expected: `{"data":{"projectResources":[{},{},{},{},{"__typename":"Milestone","id":"1","name":"Infrastructure Assessment"},{"__typename":"Milestone","id":"2","name":"Cloud Environment Setup"},{"__typename":"Milestone","id":"3","name":"Application Migration"},{"__typename":"Task","projectId":"1","name":"Current Infrastructure Audit","description":"Document existing servers, databases, and applications"},{"__typename":"Task","projectId":"1","name":"Cloud Provider Selection","description":"Evaluate AWS, Azure, and GCP options"},{"__typename":"Task","projectId":"1","name":"Network Setup","description":"Configure VPCs, subnets, and security groups"},{"__typename":"Task","projectId":"1","name":"Database Migration","description":"Migrate databases to cloud-managed services"}]}}`,
			},
			{
				name:     "query project resources with inline fragment and aliases",
				query:    `query { projectResources(projectId: 3){ ... on Task {  name oldID: projectId newID: projectId }}}`,
				expected: `{"data":{"projectResources":[{},{},{},{"name":"Machine Learning Model Research","oldID":"3","newID":"3"},{"name":"Data Pipeline Design","oldID":"3","newID":"3"}]}}`,
			},
			{
				name:     "query project with nullable list fields",
				query:    `query { project(id: "1") { id name tags alternativeProjects { id name } dependencies { id name } } }`,
				expected: `{"data":{"project":{"id":"1","name":"Cloud Migration Overhaul","tags":["cloud","migration","priority"],"alternativeProjects":[{"id":"4","name":"DevOps Transformation"}],"dependencies":[]}}}`,
			},
			{
				name:     "query project with null tags",
				query:    `query { project(id: "3") { id name tags } }`,
				expected: `{"data":{"project":{"id":"3","name":"AI-Powered Analytics","tags":null}}}`,
			},
			{
				name:     "query tasks by priority nested lists",
				query:    `query { tasksByPriority(projectId: "1") { __typename priority } }`,
				expected: `{"data":{"tasksByPriority":[[],[{"__typename":"Task","priority":"MEDIUM"}],[{"__typename":"Task","priority":"HIGH"},{"__typename":"Task","priority":"HIGH"},{"__typename":"Task","priority":"HIGH"}],[],[],null]}}`,
			},
			{
				name:     "query project tags simple list",
				query:    `query { projectTags }`,
				expected: `{"data":{"projectTags":["cloud","migration","priority","microservices","architecture","devops","ci-cd","infrastructure","security","zero-trust","mobile","ios","android","data","analytics","lake","","nullable-tag"]}}`,
			},
			{
				name:     "query archived projects non nullable list with empty item",
				query:    `query { archivedProjects { id name } }`,
				expected: `{"data":{"archivedProjects":[{"id":"","name":""}]}}`,
			},
			{
				name:     "query employee with list fields",
				query:    `query { employees { id skills certifications } }`,
				expected: `{"data":{"employees":[{"id":1,"skills":["AWS","Kubernetes","Infrastructure"],"certifications":["AWS Solutions Architect","CKA"]},{"id":2,"skills":null,"certifications":["GCP Professional Cloud Architect"]},{"id":3,"skills":["Networking","Security","Monitoring"],"certifications":["CISSP","CCNA"]},{"id":4,"skills":["Java","Spring","Microservices"],"certifications":["Oracle Certified Professional Java SE"]},{"id":5,"skills":["Python","Machine Learning","Data Science"],"certifications":["Google Professional Data Engineer"]},{"id":7,"skills":["System Architecture","Distributed Systems"],"certifications":["TOGAF 9 Certified"]},{"id":8,"skills":["Node.js","GraphQL","REST APIs"],"certifications":["MongoDB Certified Developer"]},{"id":10,"skills":["Backend","Go","Docker"],"certifications":["HashiCorp Certified Terraform Associate"]},{"id":11,"skills":["Frontend","React","TypeScript"],"certifications":null},{"id":12,"skills":["Backend","Go","Docker"],"certifications":["HashiCorp Certified Terraform Associate"]}]}}`,
			},
			{
				name:     "query employee project history nested lists",
				query:    `query { employees { id projectHistory { id name } } }`,
				expected: `{"data":{"employees":[{"id":1,"projectHistory":[[{"id":"1","name":"Cloud Migration Overhaul"}],[{"id":"4","name":"DevOps Transformation"}]]},{"id":2,"projectHistory":[[{"id":"1","name":"Cloud Migration Overhaul"}],[{"id":"2","name":"Microservices Revolution"}],[{"id":"5","name":"Security Overhaul"}]]},{"id":3,"projectHistory":[]},{"id":4,"projectHistory":[]},{"id":5,"projectHistory":[[{"id":"3","name":"AI-Powered Analytics"}],[{"id":"7","name":"Data Lake Implementation"}]]},{"id":7,"projectHistory":[[{"id":"2","name":"Microservices Revolution"}]]},{"id":8,"projectHistory":[[{"id":"2","name":"Microservices Revolution"}]]},{"id":10,"projectHistory":[]},{"id":11,"projectHistory":[[{"id":"6","name":"Mobile App Development"}]]},{"id":12,"projectHistory":[[{"id":"7","name":"Data Lake Implementation"}]]}]}}`,
			},
			{
				name:     "query tasks with list fields",
				query:    `query { tasks(projectId: "1") { id name labels attachmentUrls reviewerIds } }`,
				expected: `{"data":{"tasks":[{"id":"1","name":"Current Infrastructure Audit","labels":["audit","infrastructure","high-priority"],"attachmentUrls":["https://docs.company.com/audit-report.pdf","https://drive.company.com/infrastructure-map"],"reviewerIds":[2,3]},{"id":"2","name":"Cloud Provider Selection","labels":null,"attachmentUrls":["https://docs.company.com/cloud-comparison.xlsx"],"reviewerIds":[1,4]},{"id":"3","name":"Network Setup","labels":["networking","cloud","security"],"attachmentUrls":[],"reviewerIds":[2]},{"id":"14","name":"Database Migration","labels":null,"attachmentUrls":[],"reviewerIds":null}]}}`,
			},
			{
				name:     "query milestones with list fields",
				query:    `query { milestones(projectId: "1") { id name dependencies { id name } reviewers { id } } }`,
				expected: `{"data":{"milestones":[{"id":"1","name":"Infrastructure Assessment","dependencies":[],"reviewers":[{"id":1},{"id":2}]},{"id":"2","name":"Cloud Environment Setup","dependencies":[{"id":"1","name":"Infrastructure Assessment"},{"id":"","name":""}],"reviewers":[{"id":1},{"id":2}]},{"id":"3","name":"Application Migration","dependencies":[{"id":"2","name":"Cloud Environment Setup"},{"id":"","name":""}],"reviewers":[{"id":1},{"id":2}]}]}}`,
			},
			{
				name:     "query project with milestone groups nested lists",
				query:    `query { project(id: "1") { id milestoneGroups { id name status } } }`,
				expected: `{"data":{"project":{"id":"1","milestoneGroups":[[{"id":"3","name":"Application Migration","status":"PENDING"}],[{"id":"2","name":"Cloud Environment Setup","status":"IN_PROGRESS"}],[{"id":"1","name":"Infrastructure Assessment","status":"COMPLETED"}],[]]}}}`,
			},
			{
				name:     "query project with tasks by phase nested lists",
				query:    `query { project(id: "1") { id tasksByPhase { id name status } } }`,
				expected: `{"data":{"project":{"id":"1","tasksByPhase":[[{"id":"14","name":"Database Migration","status":"TODO"}],[{"id":"3","name":"Network Setup","status":"IN_PROGRESS"}],[],[{"id":"1","name":"Current Infrastructure Audit","status":"COMPLETED"},{"id":"2","name":"Cloud Provider Selection","status":"COMPLETED"}],[],null]}}}`,
			},
			{
				name:     "query resource matrix nested lists",
				query:    `query { resourceMatrix(projectId: "1") { __typename } }`,
				expected: `{"data":{"resourceMatrix":[[{"__typename":"Milestone"},{"__typename":"Milestone"},{"__typename":"Milestone"}],[{"__typename":"Task"},{"__typename":"Task"},{"__typename":"Task"},{"__typename":"Task"}],[{"__typename":"Employee"},{"__typename":"Employee"},{"__typename":"Employee"}],[{"__typename":"Product"}]]}}`,
			},
			{
				name:     "query project priority matrix triple nested lists",
				query:    `query { project(id: "1") { id priorityMatrix { id name priority } } }`,
				expected: `{"data":{"project":{"id":"1","priorityMatrix":[[],[[{"id":"3","name":"Network Setup","priority":"MEDIUM"}]],[[{"id":"1","name":"Current Infrastructure Audit","priority":"HIGH"}],[{"id":"2","name":"Cloud Provider Selection","priority":"HIGH"}],[{"id":"14","name":"Database Migration","priority":"HIGH"}]],[]]}}}`,
			},
			{
				name:     "query project subtasks for empty and nullable lists",
				query:    `query { projects { id tasks { id subtasks { id name } } } }`,
				expected: `{"data":{"projects":[{"id":"1","tasks":[{"id":"1","subtasks":[{"id":"1a","name":"Server Inventory"},{"id":"1b","name":"Database Inventory"},{"id":"","name":""}]},{"id":"2","subtasks":null},{"id":"3","subtasks":[{"id":"3a","name":"VPC Configuration"},{"id":"3b","name":"Security Groups"},{"id":"","name":""}]},{"id":"14","subtasks":[]}]},{"id":"2","tasks":[{"id":"4","subtasks":[]},{"id":"5","subtasks":[]}]},{"id":"3","tasks":[{"id":"6","subtasks":null},{"id":"7","subtasks":[]}]},{"id":"4","tasks":[{"id":"8","subtasks":[]}]},{"id":"5","tasks":[{"id":"9","subtasks":[]}]},{"id":"6","tasks":[{"id":"10","subtasks":null},{"id":"11","subtasks":[]}]},{"id":"7","tasks":[{"id":"12","subtasks":[]},{"id":"13","subtasks":[]}]}]}}`,
			},
			{
				name:     "query project with nullable fields and aliases",
				query:    `query { project(id: "1") { id name myDescription: description myStartDate: startDate myEndDate: endDate } }`,
				expected: `{"data":{"project":{"id":"1","name":"Cloud Migration Overhaul","myDescription":"Migrate legacy systems to cloud-native architecture","myStartDate":"2021-01-01","myEndDate":"2025-08-20"}}}`,
			},
			{
				name: "query projects on inline fragments with interfaces",
				query: `
				query {
					nodesById(id: 1) {
                        __typename
						... on Project {
							id
						}
						... on Milestone {
							id
						}
						... on Task {
							id
						}
						... on ProjectUpdate {
							id
						}
						... on Timestamped {
							... on Project {
								name
							}
							... on Milestone {
								name
							}
						}
					}
				}`,
				expected: `{"data":{"nodesById":[{"__typename":"Project","id":"1","name":"Cloud Migration Overhaul"},{"__typename":"Milestone","id":"1","name":"Infrastructure Assessment"},{"__typename":"Task","id":"1"},{"__typename":"ProjectUpdate","id":"1"}]}}`,
			},
			{
				name:     "query project with field resolver",
				query:    `query { project(id:1) { filteredTasks(limit: 3) { name status }}}`,
				expected: `{"data":{"project":{"filteredTasks":[{"name":"Current Infrastructure Audit","status":"COMPLETED"},{"name":"Cloud Provider Selection","status":"COMPLETED"},{"name":"Network Setup","status":"IN_PROGRESS"}]}}}`,
			},
			{
				name:     "query projects with multiple field resolvers",
				query:    `query { projects { name status completionRate(includeSubtasks: true) filteredTasks(limit: 3) { name status } } }`,
				expected: `{"data":{"projects":[{"name":"Cloud Migration Overhaul","status":"ACTIVE","completionRate":50,"filteredTasks":[{"name":"Current Infrastructure Audit","status":"COMPLETED"},{"name":"Cloud Provider Selection","status":"COMPLETED"},{"name":"Network Setup","status":"IN_PROGRESS"}]},{"name":"Microservices Revolution","status":"ACTIVE","completionRate":50,"filteredTasks":[{"name":"Domain Model Analysis","status":"COMPLETED"},{"name":"API Gateway Configuration","status":"IN_PROGRESS"}]},{"name":"AI-Powered Analytics","status":"ACTIVE","completionRate":0,"filteredTasks":[{"name":"Machine Learning Model Research","status":"IN_PROGRESS"},{"name":"Data Pipeline Design","status":"TODO"}]},{"name":"DevOps Transformation","status":"PLANNING","completionRate":0,"filteredTasks":[{"name":"CI/CD Pipeline Setup","status":"TODO"}]},{"name":"Security Overhaul","status":"ON_HOLD","completionRate":0,"filteredTasks":[{"name":"Security Assessment","status":"BLOCKED"}]},{"name":"Mobile App Development","status":"ACTIVE","completionRate":100,"filteredTasks":[{"name":"User Experience Testing","status":"COMPLETED"},{"name":"Flutter App Development","status":"COMPLETED"}]},{"name":"Data Lake Implementation","status":"ACTIVE","completionRate":50,"filteredTasks":[{"name":"Data Schema Design","status":"COMPLETED"},{"name":"Apache Spark Integration","status":"IN_PROGRESS"}]}]}}`,
			},
			{
				name:     "query employee current workload",
				query:    "query { employees { assignedTasks { name status } completedTasks { name status } currentWorkload(includeCompleted: false) } }",
				expected: `{"data":{"employees":[{"assignedTasks":[{"name":"CI/CD Pipeline Setup","status":"TODO"},{"name":"Database Migration","status":"TODO"}],"completedTasks":[{"name":"Current Infrastructure Audit","status":"COMPLETED"}],"currentWorkload":2},{"assignedTasks":[{"name":"Security Assessment","status":"BLOCKED"}],"completedTasks":[{"name":"Cloud Provider Selection","status":"COMPLETED"}],"currentWorkload":1},{"assignedTasks":[{"name":"Network Setup","status":"IN_PROGRESS"}],"completedTasks":[{"name":"User Experience Testing","status":"COMPLETED"}],"currentWorkload":1},{"assignedTasks":[],"completedTasks":[],"currentWorkload":0},{"assignedTasks":[],"completedTasks":[{"name":"Data Schema Design","status":"COMPLETED"}],"currentWorkload":0},{"assignedTasks":[{"name":"Data Pipeline Design","status":"TODO"}],"completedTasks":[{"name":"Domain Model Analysis","status":"COMPLETED"}],"currentWorkload":1},{"assignedTasks":[{"name":"API Gateway Configuration","status":"IN_PROGRESS"}],"completedTasks":[],"currentWorkload":1},{"assignedTasks":[],"completedTasks":[],"currentWorkload":0},{"assignedTasks":[],"completedTasks":[{"name":"Flutter App Development","status":"COMPLETED"}],"currentWorkload":0},{"assignedTasks":[{"name":"Apache Spark Integration","status":"IN_PROGRESS"}],"completedTasks":[],"currentWorkload":1}]}}`,
			},
			{
				name:     "query top priority item",
				query:    `query { project(id:1) { topPriorityItem(category: "milestone") { __typename ... on Milestone { name reviewers { id details{ forename surname } } } } } }`,
				expected: `{"data":{"project":{"topPriorityItem":{"__typename":"Milestone","name":"Application Migration","reviewers":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}}]}}}}`,
			},
			{
				name:     "query top priority item for task category",
				query:    `query { project(id:2) { topPriorityItem(category: "task") { __typename ... on Task { name priority assigneeId } } } }`,
				expected: `{"data":{"project":{"topPriorityItem":{"__typename":"Task","name":"API Gateway Configuration","priority":"HIGH","assigneeId":8}}}}`,
			},
			{
				name:     "query top priority item for project with only completed tasks",
				query:    `query { project(id:6) { topPriorityItem { __typename ... on Milestone { name status } } } }`,
				expected: `{"data":{"project":{"topPriorityItem":null}}}`,
			},
			{
				name:     "query critical deadline with large window to ensure deterministic results",
				query:    `query { project(id:1) { criticalDeadline(withinDays: 10000) { __typename ... on Milestone { name endDate status } ... on Project { name endDate } } } }`,
				expected: `{"data":{"project":{"criticalDeadline":{"__typename":"Milestone","name":"Application Migration","endDate":"2025-08-20","status":"PENDING"}}}}`,
			},
			{
				name:     "query critical deadline for project 2",
				query:    `query { project(id:2) { criticalDeadline(withinDays: 10000) { __typename ... on Milestone { id name status } } } }`,
				expected: `{"data":{"project":{"criticalDeadline":{"__typename":"Milestone","id":"6","name":"Service Deployment","status":"PENDING"}}}}`,
			},
			{
				name:     "query critical deadline returns project if no milestones",
				query:    `query { project(id:3) { criticalDeadline(withinDays: 10000) { __typename ... on Project { id name status endDate } } } }`,
				expected: `{"data":{"project":{"criticalDeadline":{"__typename":"Project","id":"3","name":"AI-Powered Analytics","status":"ACTIVE","endDate":"2025-08-20"}}}}`,
			},
			{
				name:     "query both field resolvers together",
				query:    `query { project(id:1) { id name topPriorityItem(category: "task") { __typename } completionRate(includeSubtasks: false) } }`,
				expected: `{"data":{"project":{"id":"1","name":"Cloud Migration Overhaul","topPriorityItem":{"__typename":"Task"},"completionRate":50}}}`,
			},
			{
				name:     "query multiple projects with field resolvers",
				query:    `query { projects { id topPriorityItem(category: "task") { __typename } } }`,
				expected: `{"data":{"projects":[{"id":"1","topPriorityItem":{"__typename":"Task"}},{"id":"2","topPriorityItem":{"__typename":"Task"}},{"id":"3","topPriorityItem":{"__typename":"Task"}},{"id":"4","topPriorityItem":{"__typename":"Task"}},{"id":"5","topPriorityItem":{"__typename":"Task"}},{"id":"6","topPriorityItem":null},{"id":"7","topPriorityItem":{"__typename":"Task"}}]}}`,
			},
			{
				name:     "query critical deadline with nested inline fragments on interface",
				query:    `query { project(id:7) { criticalDeadline(withinDays: 10000) { __typename ... on Timestamped { startDate endDate ... on Milestone { name projectId } ... on Project { description } } } } }`,
				expected: `{"data":{"project":{"criticalDeadline":{"__typename":"Milestone","startDate":"2023-07-01","endDate":"2024-12-31","name":"Data Ingestion Pipeline","projectId":"7"}}}}`,
			},
			{
				name:     "query top priority item with union inline fragments",
				query:    `query { project(id:1) { topPriorityItem(category: "") { __typename ... on Project { name projectStatus: status } ... on Milestone { name milstoneStatus: status } ... on Task { name priority taskStatus: status } } } }`,
				expected: `{"data":{"project":{"topPriorityItem":{"__typename":"Task","name":"Database Migration","priority":"HIGH","taskStatus":"TODO"}}}}`,
			},
			{
				name:     "query field resolvers with aliases",
				query:    `query { project(id:2) { urgent: topPriorityItem(category: "task") { __typename } nextDeadline: criticalDeadline(withinDays: 10000) { __typename } } }`,
				expected: `{"data":{"project":{"urgent":{"__typename":"Task"},"nextDeadline":{"__typename":"Milestone"}}}}`,
			},
			{
				name:     "query top priority item without category",
				query:    `query { project(id:1) { topPriorityItem { __typename ... on Task { name priority status } } } }`,
				expected: `{"data":{"project":{"topPriorityItem":{"__typename":"Task","name":"Database Migration","priority":"HIGH","status":"TODO"}}}}`,
			},
			{
				name:     "query project with recursive field resolver",
				query:    `query { project(id:1) { subProjects { id name status } } }`,
				expected: `{"data":{"project":{"subProjects":[{"id":"2","name":"Microservices Revolution","status":"ACTIVE"},{"id":"3","name":"AI-Powered Analytics","status":"ACTIVE"}]}}}`,
			},
			{
				name:     "query project with recursive field resolver with multiple levels of recursion",
				query:    `query { project(id:1) { subProjects { id name status subProjects { id status } } } }`,
				expected: `{"data":{"project":{"subProjects":[{"id":"2","name":"Microservices Revolution","status":"ACTIVE","subProjects":[{"id":"4","status":"PLANNING"},{"id":"5","status":"ON_HOLD"}]},{"id":"3","name":"AI-Powered Analytics","status":"ACTIVE","subProjects":[{"id":"6","status":"ACTIVE"},{"id":"7","status":"ACTIVE"}]}]}}}`,
			},
			{
				name:     "query project with normal and recursive field resolver and aliases",
				query:    `query { project(id:2) { id name urgent: topPriorityItem(category: "task") { __typename } nextDeadline: criticalDeadline(withinDays: 10000) { __typename } subsub: subProjects { id name status } } }`,
				expected: `{"data":{"project":{"id":"2","name":"Microservices Revolution","urgent":{"__typename":"Task"},"nextDeadline":{"__typename":"Milestone"},"subsub":[{"id":"4","name":"DevOps Transformation","status":"PLANNING"},{"id":"5","name":"Security Overhaul","status":"ON_HOLD"}]}}}`,
			},
			{
				name:     "query project with normal and recursive field resolver and aliases and multiple levels of recursion and aliases",
				query:    `{ project(id: 2) { id name urgent: topPriorityItem(category: "task") { __typename } nextDeadline: criticalDeadline(withinDays: 10000) { __typename } subsub: subProjects { id name status otherSubs: subProjects { id name } } } }`,
				expected: `{"data":{"project":{"id":"2","name":"Microservices Revolution","urgent":{"__typename":"Task"},"nextDeadline":{"__typename":"Milestone"},"subsub":[{"id":"4","name":"DevOps Transformation","status":"PLANNING","otherSubs":[{"id":"1","name":"Cloud Migration Overhaul"}]},{"id":"5","name":"Security Overhaul","status":"ON_HOLD","otherSubs":[{"id":"2","name":"Microservices Revolution"}]}]}}}`,
			},
		}
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
			EnableGRPC:               true,
		},
			func(t *testing.T, xEnv *testenv.Environment) {
				for _, test := range tests {
					t.Run(test.name, func(t *testing.T) {
						t.Parallel()

						response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
							Query: test.query,
						})

						require.Equal(t, test.expected, response.Body)
					})
				}
			})
	})

	t.Run("Should send http headers as gRPC metadata to subgraphs", func(t *testing.T) {
		t.Parallel()

		captureInterceptor := func(captured *metadata.MD) grpc.UnaryServerInterceptor {
			return func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
				md, _ := metadata.FromIncomingContext(ctx)
				*captured = md.Copy()
				return handler(ctx, req)
			}
		}

		t.Run("header arrives as metadata with correct value", func(t *testing.T) {
			// Assert that headers included in propagation rules are part
			// of gRPC metadata.
			t.Parallel()

			var captured metadata.MD

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
				EnableGRPC:               true,
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     "X-Tenant-Id",
								},
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     "X-Region-Name",
								},
							},
						},
					}),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Projects: testenv.SubgraphConfig{
						GRPCInterceptor: captureInterceptor(&captured),
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { projects { id name } }`,
					Header: http.Header{
						"X-Tenant-Id":   []string{"acme"},
						"X-Region-Name": []string{"frankfurt"},
					},
				})

				require.Equal(t, []string{"acme"}, captured.Get("x-tenant-id"))
				require.Equal(t, []string{"frankfurt"}, captured.Get("x-region-name"))
			})
		})

		t.Run("header not in propagation rules is absent from metadata", func(t *testing.T) {
			// Assert that headers not included in propagation rules are not part
			// of gRPC metadata.
			t.Parallel()

			var captured metadata.MD

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
				EnableGRPC:               true,
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     "X-Allowed",
								},
							},
						},
					}),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Projects: testenv.SubgraphConfig{
						GRPCInterceptor: captureInterceptor(&captured),
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { projects { id name } }`,
					Header: http.Header{
						"X-Allowed":     []string{"yes"},
						"X-Not-Allowed": []string{"secret"},
					},
				})

				require.Equal(t, []string{"yes"}, captured.Get("x-allowed"))
				require.Empty(t, captured.Get("x-not-allowed"))
			})
		})

		t.Run("header with multiple values arrives as multiple metadata values", func(t *testing.T) {
			// HTTP headers can be set with multiple values. They should appear with all values
			// on the gRPC metadata as well.
			t.Parallel()

			var captured metadata.MD

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
				EnableGRPC:               true,
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Named:     "X-Role",
								},
							},
						},
					}),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Projects: testenv.SubgraphConfig{
						GRPCInterceptor: captureInterceptor(&captured),
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { projects { id name } }`,
					Header: http.Header{
						"X-Role": []string{"admin", "editor"},
					},
				})

				require.Equal(t, []string{"admin", "editor"}, captured.Get("x-role"))
			})
		})

		t.Run("unsafe headers are absent from metadata", func(t *testing.T) {
			// The router avoids passing certain headers to datasources,
			// see router/core/header_rule_engine.go.
			// This test ensures grpc datasources are covered by this as well.
			t.Parallel()

			var captured metadata.MD

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
				EnableGRPC:               true,
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Matching:  ".*", // mark all headers as forwardable
								},
							},
						},
					}),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Projects: testenv.SubgraphConfig{
						GRPCInterceptor: captureInterceptor(&captured),
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { projects { id name } }`,
					Header: http.Header{
						// safe header — must arrive
						"X-Custom": []string{"value"},

						// handled by HTTP stack, never in r.Header
						"Host": []string{"evil.example.com"},

						// hop-by-hop / connection headers
						"Alt-Svc":             []string{"h3=\":443\""},
						"Connection":          []string{"keep-alive"},
						"Keep-Alive":          []string{"timeout=5"},
						"Proxy-Authenticate":  []string{"Basic"},
						"Proxy-Authorization": []string{"Basic dXNlcjpwYXNz"},
						"Proxy-Connection":    []string{"keep-alive"},
						"Te":                  []string{"trailers"},
						"Trailer":             []string{"Expires"},
						"Transfer-Encoding":   []string{"chunked"},
						"Upgrade":             []string{"websocket"},

						// content negotiation
						"Accept":           []string{"application/json"},
						"Accept-Charset":   []string{"utf-8"},
						"Accept-Encoding":  []string{"gzip, deflate"},
						"Content-Encoding": []string{"gzip"},
						"Content-Length":   []string{"42"},
						"Content-Type":     []string{"application/json"},

						// WebSocket upgrade
						"Sec-Websocket-Extensions": []string{"permessage-deflate"},
						"Sec-Websocket-Key":        []string{"dGhlIHNhbXBsZSBub25jZQ=="},
						"Sec-Websocket-Protocol":   []string{"chat"},
						"Sec-Websocket-Version":    []string{"13"},
					},
				})

				// custom header should arrive
				require.Equal(t, []string{"value"}, captured.Get("x-custom"))

				// ensure content-type is present with the correct value
				// even if the request headers have a different value
				require.Equal(t, []string{"application/grpc"}, captured.Get("content-type"))

				// host is handled by the HTTP stack and never forwarded
				require.Empty(t, captured.Get("host"))

				// hop-by-hop / connection headers
				require.Empty(t, captured.Get("alt-svc"))
				require.Empty(t, captured.Get("connection"))
				require.Empty(t, captured.Get("keep-alive"))
				require.Empty(t, captured.Get("proxy-authenticate"))
				require.Empty(t, captured.Get("proxy-authorization"))
				require.Empty(t, captured.Get("proxy-connection"))
				require.Empty(t, captured.Get("te"))
				require.Empty(t, captured.Get("trailer"))
				require.Empty(t, captured.Get("transfer-encoding"))
				require.Empty(t, captured.Get("upgrade"))

				// content negotiation
				require.Empty(t, captured.Get("accept"))
				require.Empty(t, captured.Get("accept-charset"))
				require.Empty(t, captured.Get("accept-encoding"))
				require.Empty(t, captured.Get("content-encoding"))
				require.Empty(t, captured.Get("content-length"))

				// WebSocket upgrade
				require.Empty(t, captured.Get("sec-websocket-extensions"))
				require.Empty(t, captured.Get("sec-websocket-key"))
				require.Empty(t, captured.Get("sec-websocket-protocol"))
				require.Empty(t, captured.Get("sec-websocket-version"))

				// gRPC client correctness:
				// HTTP/2 pseudo-headers — the gRPC transport explicitly whitelists
				// :authority and user-agent so they appear in metadata.
				require.NotEmpty(t, captured.Get(":authority"))
				require.NotEmpty(t, captured.Get("user-agent"))

				// gRPC client correctness:
				// All other pseudo-headers (:method, :path, :scheme) are classified
				// as reserved and stripped by the gRPC transport before reaching
				// user-space, so they never appear regardless of router rules.
				require.Empty(t, captured.Get(":method"))
				require.Empty(t, captured.Get(":path"))
				require.Empty(t, captured.Get(":scheme"))
			})
		})

		t.Run("grpc-reserved headers never reach the subgraph", func(t *testing.T) {
			// Headers prefixed with "grpc-" are reserved by the gRPC protocol spec.
			// Even when wildcard propagation is configured, they must never appear
			// on the subgraph.
			t.Parallel()

			var captured metadata.MD

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
				EnableGRPC:               true,
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Matching:  ".*",
								},
							},
						},
					}),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Projects: testenv.SubgraphConfig{
						GRPCInterceptor: captureInterceptor(&captured),
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { projects { id name } }`,
					Header: http.Header{
						"Grpc-ReservedHeader": []string{"should be ignored"},
					},
				})

				require.Empty(t, captured.Get("grpc-reservedheader"))
			})
		})

		t.Run("safe headers are present in metadata", func(t *testing.T) {
			// Ensure that http standard headers, which are safe and useful for subgraphs,
			// are included in the metadata unmodified.
			t.Parallel()

			var captured metadata.MD

			testenv.Run(t, &testenv.Config{
				RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
				EnableGRPC:               true,
				RouterOptions: []core.Option{
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								// Propagate each header explicitly so the test is
								// independent of any default propagation behaviour.
								{Operation: config.HeaderRuleOperationPropagate, Named: "Authorization"},
								{Operation: config.HeaderRuleOperationPropagate, Named: "Cookie"},
								{Operation: config.HeaderRuleOperationPropagate, Named: "Traceparent"},
								{Operation: config.HeaderRuleOperationPropagate, Named: "Tracestate"},
								{Operation: config.HeaderRuleOperationPropagate, Named: "Accept-Language"},
							},
						},
					}),
				},
				Subgraphs: testenv.SubgraphsConfig{
					Projects: testenv.SubgraphConfig{
						GRPCInterceptor: captureInterceptor(&captured),
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { projects { id name } }`,
					Header: http.Header{
						"Authorization":   []string{"Bearer eyJhbGciOiJSUzI1NiJ9"},
						"Cookie":          []string{"session=abc123; theme=dark"},
						"Traceparent":     []string{"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"},
						"Tracestate":      []string{"rojo=00f067aa0ba902b7"},
						"Accept-Language": []string{"de-DE,de;q=0.9,en;q=0.8"},
					},
				})

				require.Equal(t, []string{"Bearer eyJhbGciOiJSUzI1NiJ9"}, captured.Get("authorization"))
				require.Equal(t, []string{"session=abc123; theme=dark"}, captured.Get("cookie"))
				require.Equal(t, []string{"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"}, captured.Get("traceparent"))
				require.Equal(t, []string{"rojo=00f067aa0ba902b7"}, captured.Get("tracestate"))
				require.Equal(t, []string{"de-DE,de;q=0.9,en;q=0.8"}, captured.Get("accept-language"))
			})
		})
	})
}
