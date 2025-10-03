import { describe, expect, test } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';
import { expectValidProto } from '../util';

const SDL = `
  type Query {
    employee(id: Int!): Employee
    employees: [Employee]
    getMatrix: Matrix
    getNestedData: NestedData
    getGameBoard: GameBoard
  }

  type Mutation {
    updateMatrix(input: MatrixInput!): Matrix
    batchUpdateEmployees(updates: [EmployeeUpdateInput!]!): [Employee!]!
    createNestedStructure(input: NestedStructureInput!): NestedData
  }

  type Employee {
    id: Int!
    tag: String!
    skills: [String!]!
    projects: [Project!]!
    teamMembers: [Employee!]
  }

  type Project {
    id: Int!
    name: String!
    tags: [String!]!
    milestones: [Milestone!]!
    contributors: [Employee!]!
  }

  type Milestone {
    id: Int!
    title: String!
    tasks: [Task!]!
    dependencies: [Milestone!]
  }

  type Task {
    id: Int!
    description: String!
    assignees: [Employee!]!
    subtasks: [Task!]
    labels: [String!]!
  }

  # Multi-dimensional array structures
  type Matrix {
    id: Int!
    name: String!
    dimensions: [Int!]!
    data2D: [[Float!]!]!
    data3D: [[[Float!]!]!]!
    metadata: [[[String]]]
  }

  type NestedData {
    id: Int!
    levels: [Level1!]!
  }

  type Level1 {
    id: Int!
    items: [Level2!]!
    tags: [String!]!
  }

  type Level2 {
    id: Int!
    children: [Level3!]!
    values: [Int!]!
  }

  type Level3 {
    id: Int!
    data: [String!]!
    nested: [Level4]
  }

  type Level4 {
    id: Int!
    final: [String]
  }

  # Game board with 2D structure
  type GameBoard {
    id: Int!
    width: Int!
    height: Int!
    cells: [[Cell!]!]!
    players: [Player!]!
  }

  type Cell {
    x: Int!
    y: Int!
    value: String
    neighbors: [Cell!]
  }

  type Player {
    id: Int!
    name: String!
    positions: [Position!]!
    inventory: [Item!]!
  }

  type Position {
    x: Int!
    y: Int!
  }

  type Item {
    id: Int!
    name: String!
    properties: [Property!]!
  }

  type Property {
    key: String!
    value: String!
  }

  # Input types for complex nested structures
  input MatrixInput {
    name: String!
    dimensions: [Int!]!
    data2D: [[Float!]!]!
    data3D: [[[Float!]!]!]!
    metadata: [[[String]]]
  }

  input EmployeeUpdateInput {
    id: Int!
    skills: [String!]
    projectIds: [Int!]
    teamMemberIds: [Int!]
  }

  input NestedStructureInput {
    levels: [Level1Input!]!
  }

  input Level1Input {
    items: [Level2Input!]!
    tags: [String!]!
  }

  input Level2Input {
    children: [Level3Input!]!
    values: [Int!]!
  }

  input Level3Input {
    data: [String!]!
    nested: [Level4Input]
  }

  input Level4Input {
    final: [String]
  }

  input GameBoardInput {
    width: Int!
    height: Int!
    cells: [[CellInput!]!]!
    players: [PlayerInput!]!
  }

  input CellInput {
    x: Int!
    y: Int!
    value: String
  }

  input PlayerInput {
    name: String!
    positions: [PositionInput!]!
    inventory: [ItemInput!]!
  }

  input PositionInput {
    x: Int!
    y: Int!
  }

  input ItemInput {
    name: String!
    properties: [PropertyInput!]!
  }

  input PropertyInput {
    key: String!
    value: String!
  }
`;

describe.skip('Operations to Proto - Complex Nested Lists', () => {
  describe('Multi-dimensional Arrays', () => {
    test('should handle 2D arrays correctly', () => {
      const operation = {
        name: 'GetMatrix2D',
        content: `
          query GetMatrix2D {
            getMatrix {
              id
              name
              dimensions
              data2D
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate proper repeated fields for 2D arrays
      expect(proto).toContain('message GetMatrix2DGetMatrix {');
      expect(proto).toContain('repeated int32 dimensions = 3;');
      expect(proto).toContain('repeated GetMatrix2DGetMatrixData2D data_2_d = 4;');
      expect(proto).toContain('message GetMatrix2DGetMatrixData2D {');
      expect(proto).toContain('repeated double values = 1;'); // Inner array
    });

  });
});