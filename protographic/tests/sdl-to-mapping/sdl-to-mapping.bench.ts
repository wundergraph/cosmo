import { bench, describe } from 'vitest';
import { compileGraphQLToMapping } from '../../src';
import { buildSchema } from 'graphql';

// Simple schema for benchmarking
const simpleSchema = `
  type Query {
    hello: String
    user(id: ID!): User
  }

  type User {
    id: ID!
    name: String!
    email: String
    posts: [Post!]
  }

  type Post {
    id: ID!
    title: String!
    content: String
    author: User!
  }
`;

// More complex schema to test scaling
const complexSchema = `
  type Query {
    users: [User!]!
    user(id: ID!): User
    posts: [Post!]!
    post(id: ID!): Post
    comments: [Comment!]!
    products: [Product!]!
    orders: [Order!]!
  }

  type Mutation {
    createUser(input: CreateUserInput!): User!
    updateUser(id: ID!, input: UpdateUserInput!): User!
    deleteUser(id: ID!): Boolean!
    createPost(input: CreatePostInput!): Post!
  }

  input CreateUserInput {
    name: String!
    email: String!
  }

  input UpdateUserInput {
    name: String
    email: String
  }

  input CreatePostInput {
    title: String!
    content: String!
    authorId: ID!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    posts: [Post!]
    comments: [Comment!]
    orders: [Order!]
    createdAt: String!
    updatedAt: String!
  }

  type Post {
    id: ID!
    title: String!
    content: String!
    author: User!
    comments: [Comment!]
    tags: [String!]
    createdAt: String!
    updatedAt: String!
  }

  type Comment {
    id: ID!
    content: String!
    author: User!
    post: Post!
    createdAt: String!
  }

  type Product {
    id: ID!
    name: String!
    description: String
    price: Float!
    inventory: Int!
    categories: [String!]
  }

  type OrderItem {
    id: ID!
    product: Product!
    quantity: Int!
    price: Float!
  }

  type Order {
    id: ID!
    user: User!
    items: [OrderItem!]!
    total: Float!
    status: OrderStatus!
    createdAt: String!
  }

  enum OrderStatus {
    PENDING
    PROCESSING
    SHIPPED
    DELIVERED
    CANCELLED
  }
`;

describe('GraphQL to Proto Benchmarks', () => {
  const simpleSchemaObj = buildSchema(simpleSchema);

  bench('Simple Schema - compileGraphQLToMapping', () => {
    compileGraphQLToMapping(simpleSchemaObj);
  });

  const complexSchemaObj = buildSchema(complexSchema);

  bench('Complex Schema - compileGraphQLToMapping', () => {
    compileGraphQLToMapping(complexSchemaObj);
  });
});
