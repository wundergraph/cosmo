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

describe('Operations to Proto - Complex Nested Lists', () => {
  describe('Multi-dimensional Arrays', () => {
    test.skip('should handle 2D arrays correctly', () => {
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
      expect(proto).toContain('repeated GetMatrix2DGetMatrixData2D data2_d = 4;');
      expect(proto).toContain('message GetMatrix2DGetMatrixData2D {');
      expect(proto).toContain('repeated float values = 1;'); // Inner array
    });

    test.skip('should handle 3D arrays correctly', () => {
      const operation = {
        name: 'GetMatrix3D',
        content: `
          query GetMatrix3D {
            getMatrix {
              id
              name
              data3D
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate nested message structure for 3D arrays
      expect(proto).toContain('repeated GetMatrix3DGetMatrixData3D data3_d = 3;');
      expect(proto).toContain('message GetMatrix3DGetMatrixData3D {');
      expect(proto).toContain('repeated GetMatrix3DGetMatrixData3DValues values = 1;');
      expect(proto).toContain('message GetMatrix3DGetMatrixData3DValues {');
      expect(proto).toContain('repeated float items = 1;'); // Innermost array
    });

    test.skip('should handle nullable multi-dimensional arrays', () => {
      const operation = {
        name: 'GetMatrixWithNullable',
        content: `
          query GetMatrixWithNullable {
            getMatrix {
              id
              metadata
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should handle nullable 3D arrays with wrapper types
      expect(proto).toContain('import "google/protobuf/wrappers.proto";');
      expect(proto).toContain('repeated GetMatrixWithNullableGetMatrixMetadata metadata = 2;');
      expect(proto).toContain('message GetMatrixWithNullableGetMatrixMetadata {');
      expect(proto).toContain('repeated GetMatrixWithNullableGetMatrixMetadataValues values = 1;');
      expect(proto).toContain('message GetMatrixWithNullableGetMatrixMetadataValues {');
      expect(proto).toContain('repeated google.protobuf.StringValue items = 1;');
    });
  });

  describe('Deeply Nested Object Hierarchies', () => {
    test.skip('should handle 4-level deep nested structures', () => {
      const operation = {
        name: 'GetNestedData',
        content: `
          query GetNestedData {
            getNestedData {
              id
              levels {
                id
                items {
                  id
                  children {
                    id
                    data
                    nested {
                      id
                      final
                    }
                  }
                  values
                }
                tags
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate all nested message types
      expect(proto).toContain('message GetNestedDataGetNestedData {');
      expect(proto).toContain('message GetNestedDataGetNestedDataLevels {');
      expect(proto).toContain('message GetNestedDataGetNestedDataLevelsItems {');
      expect(proto).toContain('message GetNestedDataGetNestedDataLevelsItemsChildren {');
      expect(proto).toContain('message GetNestedDataGetNestedDataLevelsItemsChildrenNested {');

      // Should handle arrays at each level
      expect(proto).toContain('repeated GetNestedDataGetNestedDataLevels levels = 2;');
      expect(proto).toContain('repeated GetNestedDataGetNestedDataLevelsItems items = 2;');
      expect(proto).toContain('repeated GetNestedDataGetNestedDataLevelsItemsChildren children = 2;');
      expect(proto).toContain('repeated GetNestedDataGetNestedDataLevelsItemsChildrenNested nested = 3;');
    });

    test.skip('should handle recursive structures with lists', () => {
      const operation = {
        name: 'GetEmployeeHierarchy',
        content: `
          query GetEmployeeHierarchy($id: Int!) {
            employee(id: $id) {
              id
              tag
              teamMembers {
                id
                tag
                teamMembers {
                  id
                  tag
                  skills
                }
                skills
              }
              projects {
                id
                name
                contributors {
                  id
                  tag
                  skills
                }
                milestones {
                  id
                  title
                  tasks {
                    id
                    description
                    assignees {
                      id
                      tag
                    }
                    subtasks {
                      id
                      description
                      labels
                    }
                    labels
                  }
                  dependencies {
                    id
                    title
                  }
                }
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate all necessary nested messages
      expect(proto).toContain('message GetEmployeeHierarchyEmployee {');
      expect(proto).toContain('message GetEmployeeHierarchyEmployeeTeamMembers {');
      expect(proto).toContain('message GetEmployeeHierarchyEmployeeTeamMembersTeamMembers {');
      expect(proto).toContain('message GetEmployeeHierarchyEmployeeProjects {');
      expect(proto).toContain('message GetEmployeeHierarchyEmployeeProjectsContributors {');
      expect(proto).toContain('message GetEmployeeHierarchyEmployeeProjectsMilestones {');
      expect(proto).toContain('message GetEmployeeHierarchyEmployeeProjectsMilestonesTasks {');
      expect(proto).toContain('message GetEmployeeHierarchyEmployeeProjectsMilestonesTasksAssignees {');
      expect(proto).toContain('message GetEmployeeHierarchyEmployeeProjectsMilestonesTasksSubtasks {');
      expect(proto).toContain('message GetEmployeeHierarchyEmployeeProjectsMilestonesDependencies {');
    });
  });

  describe('Complex Input Structures', () => {
    test.skip('should handle multi-dimensional input arrays', () => {
      const operation = {
        name: 'UpdateMatrix',
        content: `
          mutation UpdateMatrix($input: MatrixInput!) {
            updateMatrix(input: $input) {
              id
              name
              dimensions
              data2D
              data3D
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate input message with nested array structures
      expect(proto).toContain('message MatrixInput {');
      expect(proto).toContain('repeated int32 dimensions = 2;');
      expect(proto).toContain('repeated MatrixInputData2D data2_d = 3;');
      expect(proto).toContain('repeated MatrixInputData3D data3_d = 4;');
      expect(proto).toContain('repeated MatrixInputMetadata metadata = 5;');

      // Should generate nested input message types
      expect(proto).toContain('message MatrixInputData2D {');
      expect(proto).toContain('repeated float values = 1;');
      expect(proto).toContain('message MatrixInputData3D {');
      expect(proto).toContain('repeated MatrixInputData3DValues values = 1;');
      expect(proto).toContain('message MatrixInputData3DValues {');
      expect(proto).toContain('repeated float items = 1;');
    });

    test.skip('should handle deeply nested input structures', () => {
      const operation = {
        name: 'CreateNestedStructure',
        content: `
          mutation CreateNestedStructure($input: NestedStructureInput!) {
            createNestedStructure(input: $input) {
              id
              levels {
                id
                items {
                  id
                  children {
                    id
                    data
                  }
                }
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate all nested input message types
      expect(proto).toContain('message NestedStructureInput {');
      expect(proto).toContain('message Level1Input {');
      expect(proto).toContain('message Level2Input {');
      expect(proto).toContain('message Level3Input {');
      expect(proto).toContain('message Level4Input {');

      // Should handle arrays in input structures
      expect(proto).toContain('repeated Level1Input levels = 1;');
      expect(proto).toContain('repeated Level2Input items = 1;');
      expect(proto).toContain('repeated Level3Input children = 1;');
      expect(proto).toContain('repeated string data = 1;');
      expect(proto).toContain('repeated Level4Input nested = 2;');
    });

    test.skip('should handle batch operations with complex inputs', () => {
      const operation = {
        name: 'BatchUpdateEmployees',
        content: `
          mutation BatchUpdateEmployees($updates: [EmployeeUpdateInput!]!) {
            batchUpdateEmployees(updates: $updates) {
              id
              tag
              skills
              projects {
                id
                name
                contributors {
                  id
                  tag
                }
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should handle array of input objects
      expect(proto).toContain('repeated EmployeeUpdateInput updates = 1;');
      expect(proto).toContain('message EmployeeUpdateInput {');
      expect(proto).toContain('repeated string skills = 2;');
      expect(proto).toContain('repeated int32 project_ids = 3;');
      expect(proto).toContain('repeated int32 team_member_ids = 4;');

      // Should generate response with nested arrays
      expect(proto).toContain('repeated BatchUpdateEmployeesBatchUpdateEmployees batch_update_employees = 1;');
      expect(proto).toContain('repeated string skills = 3;');
      expect(proto).toContain('repeated BatchUpdateEmployeesBatchUpdateEmployeesProjects projects = 4;');
    });
  });

  describe('Game Board and 2D Structures', () => {
    test.skip('should handle 2D game board structures', () => {
      const operation = {
        name: 'GetGameBoard',
        content: `
          query GetGameBoard {
            getGameBoard {
              id
              width
              height
              cells {
                x
                y
                value
                neighbors {
                  x
                  y
                  value
                }
              }
              players {
                id
                name
                positions {
                  x
                  y
                }
                inventory {
                  id
                  name
                  properties {
                    key
                    value
                  }
                }
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate 2D array structure for cells
      expect(proto).toContain('repeated GetGameBoardGetGameBoardCells cells = 4;');
      expect(proto).toContain('message GetGameBoardGetGameBoardCells {');
      expect(proto).toContain('repeated GetGameBoardGetGameBoardCellsValues values = 1;');
      expect(proto).toContain('message GetGameBoardGetGameBoardCellsValues {');
      expect(proto).toContain('int32 x = 1;');
      expect(proto).toContain('int32 y = 2;');
      expect(proto).toContain('google.protobuf.StringValue value = 3;');

      // Should handle recursive cell neighbors
      expect(proto).toContain('repeated GetGameBoardGetGameBoardCellsValuesNeighbors neighbors = 4;');
      expect(proto).toContain('message GetGameBoardGetGameBoardCellsValuesNeighbors {');

      // Should handle player arrays with nested structures
      expect(proto).toContain('repeated GetGameBoardGetGameBoardPlayers players = 5;');
      expect(proto).toContain('repeated GetGameBoardGetGameBoardPlayersPositions positions = 3;');
      expect(proto).toContain('repeated GetGameBoardGetGameBoardPlayersInventory inventory = 4;');
      expect(proto).toContain('repeated GetGameBoardGetGameBoardPlayersInventoryProperties properties = 3;');
    });
  });

  describe('Performance with Large Nested Structures', () => {
    test.skip('should efficiently handle operations with many nested arrays', () => {
      const operation = {
        name: 'LargeNestedQuery',
        content: `
          query LargeNestedQuery {
            employees {
              id
              tag
              skills
              projects {
                id
                name
                tags
                milestones {
                  id
                  title
                  tasks {
                    id
                    description
                    labels
                    assignees {
                      id
                      tag
                      skills
                    }
                    subtasks {
                      id
                      description
                      labels
                    }
                  }
                }
                contributors {
                  id
                  tag
                  skills
                  teamMembers {
                    id
                    tag
                    skills
                  }
                }
              }
              teamMembers {
                id
                tag
                skills
                projects {
                  id
                  name
                  tags
                }
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate all necessary message types efficiently
      const messageCount = (proto.match(/message \w+/g) || []).length;
      expect(messageCount).toBeGreaterThan(10); // Should generate many nested messages
      expect(messageCount).toBeLessThan(50); // But not excessively many

      // Should maintain proper field numbering throughout
      expect(proto).toContain('repeated LargeNestedQueryEmployees employees = 1;');
      expect(proto).toContain('repeated string skills = 3;');
      expect(proto).toContain('repeated LargeNestedQueryEmployeesProjects projects = 4;');
    });

    test.skip('should handle edge case with empty arrays', () => {
      const operation = {
        name: 'EmptyArraysQuery',
        content: `
          query EmptyArraysQuery {
            employees {
              id
              skills
              projects {
                id
                tags
                milestones {
                  id
                  tasks {
                    id
                    labels
                  }
                }
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should handle empty arrays gracefully
      expect(proto).toContain('repeated string skills = 2;');
      expect(proto).toContain('repeated EmptyArraysQueryEmployeesProjects projects = 3;');
      expect(proto).toContain('repeated string tags = 2;');
      expect(proto).toContain('repeated EmptyArraysQueryEmployeesProjectsMilestones milestones = 3;');
      expect(proto).toContain('repeated EmptyArraysQueryEmployeesProjectsMilestonesTasks tasks = 2;');
      expect(proto).toContain('repeated string labels = 2;');
    });
  });
});