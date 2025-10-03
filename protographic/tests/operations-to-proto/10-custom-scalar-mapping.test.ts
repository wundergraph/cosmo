import { describe, expect, test } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';
import { expectValidProto } from '../util';

const SDL = `
  scalar DateTime
  scalar JSON
  scalar Upload
  scalar UUID
  scalar EmailAddress
  scalar URL
  scalar BigInt
  scalar Decimal

  type Query {
    employee(id: Int!): Employee
    event(id: UUID!): Event
    searchByEmail(email: EmailAddress!): Employee
    getMetadata(format: JSON): Metadata
  }

  type Mutation {
    updateEmployeeTag(id: Int!, tag: String!): Employee
    uploadFile(file: Upload!): FileInfo
    createEvent(input: EventInput!): Event
    processPayment(amount: Decimal!, currency: String!): PaymentResult
  }

  type Employee {
    id: Int!
    uuid: UUID!
    tag: String!
    email: EmailAddress
    createdAt: DateTime!
    updatedAt: DateTime
    metadata: JSON
    salary: Decimal
    isAvailable: Boolean!
  }

  type Event {
    id: UUID!
    title: String!
    startTime: DateTime!
    endTime: DateTime
    metadata: JSON
    createdAt: DateTime!
  }

  type FileInfo {
    id: UUID!
    filename: String!
    size: BigInt!
    uploadedAt: DateTime!
    url: URL!
    metadata: JSON
  }

  type Metadata {
    version: String!
    schema: JSON!
    lastModified: DateTime!
    size: BigInt!
  }

  type PaymentResult {
    id: UUID!
    amount: Decimal!
    processedAt: DateTime!
    status: String!
    metadata: JSON
  }

  input EventInput {
    title: String!
    startTime: DateTime!
    endTime: DateTime
    metadata: JSON
  }

  input FileUploadInput {
    filename: String!
    size: BigInt!
    metadata: JSON
  }
`;

describe('Operations to Proto - Custom Scalar Mapping', () => {
  describe('Basic Custom Scalar Operations', () => {
    test('should handle DateTime scalars in queries', () => {
      const operation = {
        name: 'GetEmployeeDates',
        content: `
          query GetEmployeeDates($id: Int!) {
            employee(id: $id) {
              id
              createdAt
              updatedAt
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should map DateTime to string in proto
      expect(proto).toContain('string created_at = 2;');
      expect(proto).toContain('google.protobuf.StringValue updated_at = 3;');
    });

    test('should handle UUID scalars in queries', () => {
      const operation = {
        name: 'GetEventById',
        content: `
          query GetEventById($eventId: UUID!) {
            event(id: $eventId) {
              id
              title
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should map UUID to string in proto
      expect(proto).toContain('string event_id = 1;');
      expect(proto).toContain('string id = 1;');
    });

    test('should handle JSON scalars in queries', () => {
      const operation = {
        name: 'GetMetadataInfo',
        content: `
          query GetMetadataInfo($format: JSON) {
            getMetadata(format: $format) {
              version
              schema
              lastModified
            }
            employee(id: 1) {
              metadata
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should map JSON to string in proto with wrapper for nullable
      expect(proto).toContain('google.protobuf.StringValue format = 1;');
      expect(proto).toContain('string schema = 2;');
      expect(proto).toContain('google.protobuf.StringValue metadata = 1;');
    });

    test('should handle BigInt scalars in queries', () => {
      const operation = {
        name: 'GetFileInfo',
        content: `
          mutation UploadFile($file: Upload!) {
            uploadFile(file: $file) {
              id
              size
              uploadedAt
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should map BigInt to int64 in proto
      expect(proto).toContain('int64 size = 2;');
      // Should map Upload to string (or bytes)
      expect(proto).toContain('string file = 1;');
    });
  });

  describe('Complex Custom Scalar Operations', () => {
    test('should handle multiple custom scalars in complex queries', () => {
      const operation = {
        name: 'GetEmployeeDetails',
        content: `
          query GetEmployeeDetails($id: Int!) {
            employee(id: $id) {
              uuid
              email
              createdAt
              updatedAt
              salary
              metadata
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should map various custom scalars to appropriate proto types
      expect(proto).toContain('string uuid = 1;');
      expect(proto).toContain('google.protobuf.StringValue email = 2;');
      expect(proto).toContain('string created_at = 3;');
      expect(proto).toContain('google.protobuf.StringValue updated_at = 4;');
      expect(proto).toContain('google.protobuf.StringValue salary = 5;');
      expect(proto).toContain('google.protobuf.StringValue metadata = 6;');
    });

    test('should handle custom scalars in nested objects', () => {
      const operation = {
        name: 'GetEventWithMetadata',
        content: `
          query GetEventWithMetadata($eventId: UUID!) {
            event(id: $eventId) {
              id
              startTime
              endTime
              metadata
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should handle custom scalars in nested structures
      expect(proto).toContain('string id = 1;');
      expect(proto).toContain('string start_time = 2;');
      expect(proto).toContain('google.protobuf.StringValue end_time = 3;');
      expect(proto).toContain('google.protobuf.StringValue metadata = 4;');
    });
  });

  describe('Custom Scalars in Mutations', () => {
    test('should handle custom scalar inputs in mutations', () => {
      const operation = {
        name: 'CreateEventMutation',
        content: `
          mutation CreateEventMutation($input: EventInput!) {
            createEvent(input: $input) {
              id
              title
              startTime
              endTime
              metadata
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate input message with custom scalar fields
      expect(proto).toContain('message EventInput {');
      expect(proto).toContain('string title = 1;');
      expect(proto).toContain('string start_time = 2;');
      expect(proto).toContain('google.protobuf.StringValue end_time = 3;');
      expect(proto).toContain('google.protobuf.StringValue metadata = 4;');
    });

    test('should handle file upload with custom scalars', () => {
      const operation = {
        name: 'FileUploadMutation',
        content: `
          mutation FileUploadMutation($file: Upload!) {
            uploadFile(file: $file) {
              id
              filename
              size
              uploadedAt
              url
              metadata
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should handle Upload scalar and other custom scalars in response
      expect(proto).toContain('string file = 1;'); // Upload mapped to string
      expect(proto).toContain('string id = 1;'); // UUID
      expect(proto).toContain('int64 size = 3;'); // BigInt
      expect(proto).toContain('string uploaded_at = 4;'); // DateTime
      expect(proto).toContain('string url = 5;'); // URL
      expect(proto).toContain('google.protobuf.StringValue metadata = 6;'); // JSON
    });

    test('should handle payment processing with decimal scalars', () => {
      const operation = {
        name: 'ProcessPaymentMutation',
        content: `
          mutation ProcessPaymentMutation($amount: Decimal!, $currency: String!) {
            processPayment(amount: $amount, currency: $currency) {
              id
              amount
              processedAt
              status
              metadata
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should handle decimal-related custom scalars
      expect(proto).toContain('string amount = 1;'); // Decimal mapped to string
      expect(proto).toContain('string currency = 2;');
      expect(proto).toContain('string id = 1;'); // UUID
      expect(proto).toContain('string amount = 2;'); // Decimal in response
      expect(proto).toContain('string processed_at = 3;'); // DateTime
      expect(proto).toContain('google.protobuf.StringValue metadata = 5;'); // JSON
    });
  });

  describe('Custom Scalar Type Mapping', () => {
    test('should use default mapping for custom scalars', () => {
      const operation = {
        name: 'CustomMappingTest',
        content: `
          query CustomMappingTest {
            employee(id: 1) {
              uuid
              createdAt
              salary
              email
            }
          }
        `,
      };

      // This test verifies the default scalar mappings
      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should use default mappings for custom scalars
      expect(proto).toContain('string uuid = 1;'); // UUID -> string
      expect(proto).toContain('string created_at = 2;'); // DateTime -> string
      expect(proto).toContain('google.protobuf.StringValue salary = 3;'); // Decimal -> string
      expect(proto).toContain('google.protobuf.StringValue email = 4;'); // EmailAddress -> string
    });

    test('should handle unknown custom scalars with default mapping', () => {
      const sdlWithUnknownScalar = `
        scalar UnknownCustomScalar
        
        type Query {
          test: UnknownCustomScalar
        }
      `;

      const operation = {
        name: 'UnknownScalarTest',
        content: `
          query UnknownScalarTest {
            test
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(sdlWithUnknownScalar, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should default to string for unknown custom scalars (with wrapper for nullable)
      expect(proto).toContain('google.protobuf.StringValue test = 1;');
    });
  });

  describe('Performance with Many Custom Scalars', () => {
    test('should efficiently handle operations with many custom scalar fields', () => {
      const operation = {
        name: 'ManyCustomScalars',
        content: `
          query ManyCustomScalars {
            employee(id: 1) {
              uuid
              createdAt
              updatedAt
              metadata
              salary
              email
            }
            event(id: "test-uuid") {
              id
              startTime
              endTime
              metadata
              createdAt
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should efficiently generate proto with many custom scalar mappings
      expect(proto).toContain('message ManyCustomScalarsEmployee {');
      expect(proto).toContain('message ManyCustomScalarsEvent {');
      
      // Verify all custom scalars are properly mapped
      const customScalarFields = [
        'uuid', 'created_at', 'updated_at', 'metadata', 'salary', 'email',
        'id', 'start_time', 'end_time'
      ];
      
      customScalarFields.forEach(field => {
        expect(proto).toContain(`${field} =`);
      });
    });
  });
});