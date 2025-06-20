package integration

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestGRPCSubgraph(t *testing.T) {
	t.Parallel()

	t.Run("Should successfully start the subgraph and make requests", func(t *testing.T) {
		t.Parallel()
		tests := []struct {
			query    string
			expected string
		}{
			{
				query:    `query { projects { id name } }`,
				expected: `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul"},{"id":"2","name":"Microservices Revolution"},{"id":"3","name":"AI-Powered Analytics"},{"id":"4","name":"DevOps Transformation"},{"id":"5","name":"Security Overhaul"},{"id":"6","name":"Mobile App Redesign"},{"id":"7","name":"Data Lake Implementation"}]}}`,
			},
			{
				query:    `query { project(id: 1) { id name description status }}`,
				expected: `{"data":{"project":{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"}}}`,
			},
			{
				query:    `query { project(id: 1) { description teamMembers { details { forename surname }}}}`,
				expected: `{"data":{"project":{"description":"Migrate legacy systems to cloud-native architecture","teamMembers":[{"details":{"forename":"Jens","surname":"Neuse"}},{"details":{"forename":"Dustin","surname":"Deus"}},{"details":{"forename":"Stefan","surname":"Avram"}}]}}}`,
			},
			{
				query:    `query { projects { id name milestoneIds teamMembers { id notes currentMood } } }`,
				expected: `{"data":{"projects":[{"id":"1","name":"Cloud Migration Overhaul","milestoneIds":["1","2","3"],"teamMembers":[{"id":1,"notes":"Jens notes resolved by products","currentMood":"HAPPY"},{"id":2,"notes":"Dustin notes resolved by products","currentMood":"HAPPY"},{"id":3,"notes":"Stefan notes resolved by products","currentMood":"HAPPY"}]},{"id":"2","name":"Microservices Revolution","milestoneIds":["4","5","6"],"teamMembers":[{"id":7,"notes":"Suvij notes resolved by products","currentMood":"HAPPY"},{"id":8,"notes":"Nithin notes resolved by products","currentMood":"HAPPY"}]},{"id":"3","name":"AI-Powered Analytics","milestoneIds":null,"teamMembers":[{"id":5,"notes":"Sergiy notes resolved by products","currentMood":"HAPPY"},{"id":7,"notes":"Suvij notes resolved by products","currentMood":"HAPPY"}]},{"id":"4","name":"DevOps Transformation","milestoneIds":null,"teamMembers":[{"id":1,"notes":"Jens notes resolved by products","currentMood":"HAPPY"},{"id":4,"notes":"Björn notes resolved by products","currentMood":"HAPPY"}]},{"id":"5","name":"Security Overhaul","milestoneIds":null,"teamMembers":[{"id":2,"notes":"Dustin notes resolved by products","currentMood":"HAPPY"},{"id":10,"notes":"Eelco notes resolved by products","currentMood":"HAPPY"}]},{"id":"6","name":"Mobile App Redesign","milestoneIds":["1","4","5","6"],"teamMembers":[{"id":3,"notes":"Stefan notes resolved by products","currentMood":"HAPPY"},{"id":11,"notes":"Alexandra notes resolved by products","currentMood":"HAPPY"}]},{"id":"7","name":"Data Lake Implementation","milestoneIds":["1","2","3","4","5","6"],"teamMembers":[{"id":5,"notes":"Sergiy notes resolved by products","currentMood":"HAPPY"},{"id":12,"notes":"David notes resolved by products","currentMood":"HAPPY"}]}]}}`,
			},
			{
				query:    `query  {employees {id details { forename surname } projects { id name description status }}}`,
				expected: `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"4","name":"DevOps Transformation","description":"Implement CI/CD and infrastructure as code","status":"PLANNING"}]},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"},{"id":"5","name":"Security Overhaul","description":"Implement zero-trust security architecture","status":"ON_HOLD"}]},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"projects":[{"id":"1","name":"Cloud Migration Overhaul","description":"Migrate legacy systems to cloud-native architecture","status":"ACTIVE"},{"id":"6","name":"Mobile App Redesign","description":"Modernize mobile applications with Flutter","status":"COMPLETED"}]},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"projects":[{"id":"4","name":"DevOps Transformation","description":"Implement CI/CD and infrastructure as code","status":"PLANNING"}]},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"projects":[{"id":"3","name":"AI-Powered Analytics","description":"Implement machine learning for business intelligence","status":"ACTIVE"},{"id":"7","name":"Data Lake Implementation","description":"Build enterprise data lake for analytics","status":"ACTIVE"}]},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"projects":[{"id":"3","name":"AI-Powered Analytics","description":"Implement machine learning for business intelligence","status":"ACTIVE"},{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"}]},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"projects":[{"id":"2","name":"Microservices Revolution","description":"Break down monolith into microservices","status":"ACTIVE"}]},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"projects":[{"id":"5","name":"Security Overhaul","description":"Implement zero-trust security architecture","status":"ON_HOLD"}]},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"projects":[{"id":"6","name":"Mobile App Redesign","description":"Modernize mobile applications with Flutter","status":"COMPLETED"}]},{"id":12,"details":{"forename":"David","surname":"Stutt"},"projects":[{"id":"7","name":"Data Lake Implementation","description":"Build enterprise data lake for analytics","status":"ACTIVE"}]}]}}`,
			},
		}
		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithGRPCJSONTemplate,
			EnableGRPC:               true,
		},
			func(t *testing.T, xEnv *testenv.Environment) {
				for _, test := range tests {
					response := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query: test.query,
					})

					require.Equal(t, test.expected, response.Body)
				}
			})
	})

}
