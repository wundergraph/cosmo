# $foo  Plugin - Cosmo gRPC Subgraph Example

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

- `src/` - Contains the plugin source code
  - `main.go` - The gRPC service implementation with methods that replace GraphQL resolvers
  - `schema.graphql` - The GraphQL schema defining the API contract
- `generated/` - Contains generated code from the plugin schema
- `bin/` - Contains compiled binaries of the plugin

## GraphQL to gRPC Mapping

The plugin shows how GraphQL operations map to gRPC methods:

| GraphQL Operation | gRPC Method |
|-------------------|-------------|
| `query { user }` | `QueryUser()` |
| `query { usersByRole }` | `QueryUsersByRole()` |
| `mutation { createUser }` | `MutationCreateUser()` |
| `mutation { deleteUser }` | `MutationDeleteUser()` |
| `mutation { updateUserRole }` | `MutationUpdateUserRole()` |

## GraphQL Schema

```graphql
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
```

## Getting Started

1. **Build the plugin**

   ```
   wgc plugin build <plugin-directory>
   ```

2. **Compose your supergraph with your gRPC subgraph**

   config.yaml
   ```yaml
   subgraphs:
     - name: <plugin-name>
       plugin:
         version: 0.0.1
         directory: <plugin-directory>/<plugin-name>
   ```

3. **Build the federated graph**

    ```bash
    wgc router compose config.yaml
    ```

4. **Start the router**

   ```yaml
   execution_config:
    file:
        path: ./config.yaml
   plugins:
    - <plugin-directory>
   ```

3. **Query and mutate user data**

   Once running, you can perform GraphQL operations like:
   
   ```graphql
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
   ```

## Further Steps

- Change the plugin code in `src/main.go` and rebuild the plugin
- Change the GraphQL schema in `src/schema.graphql` and rebuild the plugin

## Learn More

For more information about Cosmo and building subgraph plugins, visit the [Cosmo documentation](https://cosmo-docs.wundergraph.com).