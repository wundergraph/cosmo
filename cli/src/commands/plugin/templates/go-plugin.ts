// We store the templates in code to avoid dealing with file system issues when
// building for bun and transpiling TypeScript.

export const goMod = `
module {modulePath}

go 1.24.1

require (
	github.com/hashicorp/go-plugin v1.6.3
	google.golang.org/grpc v1.72.0
	google.golang.org/protobuf v1.36.5
)

replace github.com/wundergraph/cosmo/router-plugin => ../../../router-plugin
`;

export const mainGo = `package main

import (
	"context"
	"log"
	"strconv"

	service "github.com/wundergraph/cosmo/plugin/generated"

	routerplugin "github.com/wundergraph/cosmo/router-plugin"
	"google.golang.org/grpc"
)

func main() {
	pl, err := routerplugin.NewRouterPlugin(func(s *grpc.Server) {
		s.RegisterService(&service.{serviceName}_ServiceDesc, &{serviceName}{
			users:  make(map[string]*service.User),
			nextID: 1,
		})
	})

	if err != nil {
		log.Fatalf("failed to create router plugin: %v", err)
	}

	pl.Serve()
}

type {serviceName} struct {
	service.Unimplemented{serviceName}Server
	users  map[string]*service.User
	nextID int
}

func (s *{serviceName}) QueryUser(ctx context.Context, req *service.QueryUserRequest) (*service.QueryUserResponse, error) {
	user, exists := s.users[req.Id]
	if !exists {
		// Return a default user if not found (for demo purposes)
		return &service.QueryUserResponse{
			User: &service.User{
				Id:   req.Id,
				Name: "Demo User",
				Role: service.UserRole_USER_ROLE_USER, // Default role
			},
		}, nil
	}

	return &service.QueryUserResponse{
		User: user,
	}, nil
}

func (s *{serviceName}) QueryUsersByRole(ctx context.Context, req *service.QueryUsersByRoleRequest) (*service.QueryUsersByRoleResponse, error) {
	var filteredUsers []*service.User

	for _, user := range s.users {
		if user.Role == req.Role {
			filteredUsers = append(filteredUsers, user)
		}
	}

	return &service.QueryUsersByRoleResponse{
		UsersByRole: filteredUsers,
	}, nil
}

func (s *{serviceName}) MutationCreateUser(ctx context.Context, req *service.MutationCreateUserRequest) (*service.MutationCreateUserResponse, error) {
	id := strconv.Itoa(s.nextID)
	s.nextID++

	// Use provided role or default to USER
	role := req.Role
	if role == service.UserRole_USER_ROLE_UNSPECIFIED {
		role = service.UserRole_USER_ROLE_USER
	}

	user := &service.User{
		Id:   id,
		Name: req.Name,
		Role: role,
	}

	s.users[id] = user

	return &service.MutationCreateUserResponse{
		CreateUser: user,
	}, nil
}

func (s *{serviceName}) MutationDeleteUser(ctx context.Context, req *service.MutationDeleteUserRequest) (*service.MutationDeleteUserResponse, error) {
	user, exists := s.users[req.Id]

	// If user doesn't exist, just return a canned response for demo purposes
	if !exists {
		return &service.MutationDeleteUserResponse{
			DeleteUser: &service.User{
				Id:   req.Id,
				Name: "Demo User",
				Role: service.UserRole_USER_ROLE_USER, // Default role
			},
		}, nil
	}

	delete(s.users, req.Id)

	return &service.MutationDeleteUserResponse{
		DeleteUser: user,
	}, nil
}

func (s *{serviceName}) MutationUpdateUserRole(ctx context.Context, req *service.MutationUpdateUserRoleRequest) (*service.MutationUpdateUserRoleResponse, error) {
	user, exists := s.users[req.Id]

	// If user doesn't exist, return a canned response for demo purposes
	if !exists {
		return &service.MutationUpdateUserRoleResponse{
			UpdateUserRole: &service.User{
				Id:   req.Id,
				Name: "Demo User",
				Role: req.Role,
			},
		}, nil
	}

	// Update the user's role
	user.Role = req.Role
	s.users[req.Id] = user

	return &service.MutationUpdateUserRoleResponse{
		UpdateUserRole: user,
	}, nil
}
`;
export const readme = `# {name} Plugin - Cosmo gRPC Subgraph Example

This repository contains a demo Cosmo gRPC subgraph plugin that showcases how to design APIs with GraphQL but implement them using gRPC methods instead of traditional resolvers.

## What is this demo about?

This demo illustrates a key pattern in Cosmo subgraph development:
- **Design with GraphQL**: Define your API using GraphQL schema
- **Implement with gRPC**: Instead of writing GraphQL resolvers, implement gRPC service methods
- **Bridge the gap**: The Cosmo router connects GraphQL operations to your gRPC implementations

The plugin demonstrates:
- How GraphQL types and operations map to gRPC service methods
- Simple in-memory user service with CRUD operations
- Proper structure for a Cosmo gRPC subgraph plugin

## Plugin Structure

- \`src/\` - Contains the plugin source code
  - \`main.go\` - The gRPC service implementation with methods that replace GraphQL resolvers
  - \`schema.graphql\` - The GraphQL schema defining the API contract
- \`generated/\` - Contains generated code from the plugin schema
- \`bin/\` - Contains compiled binaries of the plugin

## GraphQL to gRPC Mapping

The plugin shows how GraphQL operations map to gRPC methods:

| GraphQL Operation | gRPC Method |
|-------------------|-------------|
| \`query { user }\` | \`QueryUser()\` |
| \`query { usersByRole }\` | \`QueryUsersByRole()\` |
| \`mutation { createUser }\` | \`MutationCreateUser()\` |
| \`mutation { deleteUser }\` | \`MutationDeleteUser()\` |
| \`mutation { updateUserRole }\` | \`MutationUpdateUserRole()\` |

## GraphQL Schema

\`\`\`graphql
enum UserRole {
  ADMIN
  USER
  GUEST
}

type User {
  id: ID!
  name: String!
  role: UserRole!
}

type Query {
  user(id: ID!): User
  usersByRole(role: UserRole!): [User!]!
}

type Mutation {
  createUser(name: String!, role: UserRole = USER): User
  deleteUser(id: ID!): User
  updateUserRole(id: ID!, role: UserRole!): User
}
\`\`\`

## Getting Started

1. **Build the plugin**

   \`\`\`
   wgc plugin build <plugin-directory>
   \`\`\`

2. **Compose your supergraph with your gRPC subgraph**

   config.yaml
   \`\`\`yaml
   subgraphs:
     - name: <plugin-name>
       plugin:
         version: 0.0.1
         directory: <plugin-directory>/<plugin-name>
   \`\`\`

3. **Build the federated graph**

    \`\`\`bash
    wgc router compose config.yaml
    \`\`\`

4. **Start the router**

   \`\`\`yaml
   execution_config:
    file:
        path: ./config.yaml
   plugins:
    - <plugin-directory>
   \`\`\`

3. **Query and mutate user data**

   Once running, you can perform GraphQL operations like:
   
   \`\`\`graphql
   # Create a user
   mutation {
     createUser(name: "John Doe") {
       id
       name
       role
     }
   }
   
   # Create a user with specific role
   mutation {
     createUser(name: "Admin User", role: ADMIN) {
       id
       name
       role
     }
   }
   
   # Query a user
   query {
     user(id: "1") {
       id
       name
       role
     }
   }
   
   # Query users by role
   query {
     usersByRole(role: ADMIN) {
       id
       name
     }
   }
   
   # Update a user's role
   mutation {
     updateUserRole(id: "1", role: GUEST) {
       id
       name
       role
     }
   }
   \`\`\`

## Further Steps

- Change the plugin code in \`src/main.go\` and rebuild the plugin
- Change the GraphQL schema in \`src/schema.graphql\` and rebuild the plugin

## Learn More

For more information about Cosmo and building subgraph plugins, visit the [Cosmo documentation](https://cosmo-docs.wundergraph.com).`;

export const schema = `enum UserRole {
  ADMIN
  USER
  GUEST
}

type User {
  id: ID!
  name: String!
  role: UserRole!
}

type Query {
  user(id: ID!): User
  usersByRole(role: UserRole!): [User!]!
}

type Mutation {
  createUser(name: String!, role: UserRole = USER): User
  deleteUser(id: ID!): User
  updateUserRole(id: ID!, role: UserRole!): User
}`;
