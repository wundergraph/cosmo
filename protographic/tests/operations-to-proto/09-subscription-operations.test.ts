import { describe, expect, test } from 'vitest';
import { OperationToProtoVisitor } from '../../src/operations-to-proto-visitor';
import { expectValidProto } from '../util';

const SDL = `
  type Query {
    employee(id: Int!): Employee
    employees: [Employee]
    currentTime: Time!
  }

  type Mutation {
    updateEmployeeTag(id: Int!, tag: String!): Employee
    updateAvailability(employeeID: Int!, isAvailable: Boolean!): Employee!
  }

  type Subscription {
    currentTime: Time!
    countEmp(max: Int!, intervalMilliseconds: Int!): Int!
    countEmp2(max: Int!, intervalMilliseconds: Int!): Int!
    countFor(count: Int!): Int!
    countHob(max: Int!, intervalMilliseconds: Int!): Int!
    employeeUpdated(id: Int): Employee
    employeeStatusChanged: EmployeeStatusUpdate!
    realTimeMetrics(filter: MetricsFilter): Metrics!
    chatMessages(roomId: String!): ChatMessage!
    notifications(userId: String!): Notification!
  }

  enum Department {
    ENGINEERING
    MARKETING
    OPERATIONS
  }

  interface Identifiable {
    id: Int!
  }

  type Details {
    forename: String!
    surname: String!
    hasChildren: Boolean!
    nationality: Nationality!
  }

  enum Mood {
    HAPPY
    SAD
  }

  enum Nationality {
    AMERICAN
    DUTCH
    ENGLISH
    GERMAN
    INDIAN
    SPANISH
    UKRAINIAN
  }

  type Employee implements Identifiable {
    details: Details
    id: Int!
    tag: String!
    notes: String
    updatedAt: String!
    startDate: String!
    currentMood: Mood!
    isAvailable: Boolean!
    department: Department!
  }

  type Time {
    unixTime: Int!
    timeStamp: String!
  }

  type EmployeeStatusUpdate {
    employee: Employee!
    previousStatus: Boolean!
    newStatus: Boolean!
    timestamp: String!
    updatedBy: String!
  }

  input MetricsFilter {
    department: Department
    timeRange: TimeRange
    includeInactive: Boolean
  }

  input TimeRange {
    start: String!
    end: String!
  }

  type Metrics {
    totalEmployees: Int!
    activeEmployees: Int!
    departmentBreakdown: [DepartmentMetric!]!
    timestamp: String!
  }

  type DepartmentMetric {
    department: Department!
    count: Int!
    activeCount: Int!
  }

  type ChatMessage {
    id: String!
    content: String!
    author: Employee!
    timestamp: String!
    roomId: String!
    mentions: [Employee!]
  }

  type Notification {
    id: String!
    type: NotificationType!
    title: String!
    message: String!
    timestamp: String!
    read: Boolean!
    data: NotificationData
  }

  enum NotificationType {
    EMPLOYEE_UPDATE
    SYSTEM_ALERT
    CHAT_MESSAGE
    TASK_ASSIGNMENT
  }

  union NotificationData = EmployeeNotificationData | SystemNotificationData | ChatNotificationData

  type EmployeeNotificationData {
    employee: Employee!
    action: String!
  }

  type SystemNotificationData {
    severity: String!
    component: String!
  }

  type ChatNotificationData {
    roomId: String!
    messageId: String!
    author: Employee!
  }
`;

describe('Operations to Proto - Subscription Operations', () => {
  describe('Basic Subscription Operations', () => {
    test('should handle simple subscription operations', () => {
      const operation = {
        name: 'CurrentTimeSubscription',
        content: `
          subscription CurrentTimeSubscription {
            currentTime {
              unixTime
              timeStamp
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate subscription service method
      expect(proto).toContain('rpc CurrentTimeSubscription(CurrentTimeSubscriptionRequest) returns (stream CurrentTimeSubscriptionResponse) {}');
      
      // Should generate request and response messages
      expect(proto).toContain('message CurrentTimeSubscriptionRequest {');
      expect(proto).toContain('message CurrentTimeSubscriptionResponse {');
      expect(proto).toContain('CurrentTimeSubscriptionCurrentTime current_time = 1;');
      
      // Should generate nested message for subscription data
      expect(proto).toContain('message CurrentTimeSubscriptionCurrentTime {');
      expect(proto).toContain('int32 unix_time = 1;');
      expect(proto).toContain('string time_stamp = 2;');
    });

    test('should handle subscription operations with arguments', () => {
      const operation = {
        name: 'CountEmployees',
        content: `
          subscription CountEmployees($max: Int!, $interval: Int!) {
            countEmp(max: $max, intervalMilliseconds: $interval)
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate streaming service method
      expect(proto).toContain('rpc CountEmployees(CountEmployeesRequest) returns (stream CountEmployeesResponse) {}');
      
      // Should include arguments in request message
      expect(proto).toContain('message CountEmployeesRequest {');
      expect(proto).toContain('int32 max = 1;');
      expect(proto).toContain('int32 interval = 2;');
      
      // Should generate response with scalar return type
      expect(proto).toContain('message CountEmployeesResponse {');
      expect(proto).toContain('int32 count_emp = 1;');
    });

    test('should handle subscription operations with optional arguments', () => {
      const operation = {
        name: 'EmployeeUpdates',
        content: `
          subscription EmployeeUpdates($employeeId: Int) {
            employeeUpdated(id: $employeeId) {
              id
              tag
              currentMood
              isAvailable
              updatedAt
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should handle optional arguments with wrapper types
      expect(proto).toContain('import "google/protobuf/wrappers.proto";');
      expect(proto).toContain('message EmployeeUpdatesRequest {');
      expect(proto).toContain('google.protobuf.Int32Value employee_id = 1;');
      
      // Should generate streaming response
      expect(proto).toContain('rpc EmployeeUpdates(EmployeeUpdatesRequest) returns (stream EmployeeUpdatesResponse) {}');
    });
  });

  describe('Complex Subscription Operations', () => {
    test('should handle subscription operations with complex object responses', () => {
      const operation = {
        name: 'EmployeeStatusUpdates',
        content: `
          subscription EmployeeStatusUpdates {
            employeeStatusChanged {
              employee {
                id
                tag
                details {
                  forename
                  surname
                }
                department
              }
              previousStatus
              newStatus
              timestamp
              updatedBy
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate nested messages for complex subscription data
      expect(proto).toContain('message EmployeeStatusUpdatesEmployeeStatusChanged {');
      expect(proto).toContain('EmployeeStatusUpdatesEmployeeStatusChangedEmployee employee = 1;');
      expect(proto).toContain('bool previous_status = 2;');
      expect(proto).toContain('bool new_status = 3;');
      
      // Should handle nested object selections
      expect(proto).toContain('message EmployeeStatusUpdatesEmployeeStatusChangedEmployee {');
      expect(proto).toContain('EmployeeStatusUpdatesEmployeeStatusChangedEmployeeDetails details = 3;');
      expect(proto).toContain('Department department = 4;');
    });

    test('should handle subscription operations with input filters', () => {
      const operation = {
        name: 'RealTimeMetrics',
        content: `
          subscription RealTimeMetrics($filter: MetricsFilter) {
            realTimeMetrics(filter: $filter) {
              totalEmployees
              activeEmployees
              departmentBreakdown {
                department
                count
                activeCount
              }
              timestamp
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate input message for filter
      expect(proto).toContain('message MetricsFilter {');
      expect(proto).toContain('Department department = 1;');
      expect(proto).toContain('TimeRange time_range = 2;');
      
      // Should handle nested input types
      expect(proto).toContain('message TimeRange {');
      expect(proto).toContain('string start = 1;');
      expect(proto).toContain('string end = 2;');
      
      // Should generate streaming response with complex data
      expect(proto).toContain('repeated RealTimeMetricsRealTimeMetricsDepartmentBreakdown department_breakdown = 3;');
    });

    test('should handle subscription operations with union types', () => {
      const operation = {
        name: 'NotificationStream',
        content: `
          subscription NotificationStream($userId: String!) {
            notifications(userId: $userId) {
              id
              type
              title
              message
              timestamp
              read
              data {
                ... on EmployeeNotificationData {
                  employee {
                    id
                    tag
                  }
                  action
                }
                ... on SystemNotificationData {
                  severity
                  component
                }
                ... on ChatNotificationData {
                  roomId
                  messageId
                  author {
                    id
                    tag
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

      // Should handle union types in subscription responses
      expect(proto).toContain('message NotificationStreamNotificationsData {');
      expect(proto).toContain('oneof type_specific {');
      expect(proto).toContain('NotificationStreamNotificationsDataEmployeeNotificationData employeenotificationdata = 1;');
      expect(proto).toContain('NotificationStreamNotificationsDataSystemNotificationData systemnotificationdata = 2;');
      expect(proto).toContain('NotificationStreamNotificationsDataChatNotificationData chatnotificationdata = 3;');
    });
  });

  describe('Multiple Subscription Operations', () => {
    test('should handle multiple subscription operations in single service', () => {
      const operations = [
        {
          name: 'TimeUpdates',
          content: `
            subscription TimeUpdates {
              currentTime {
                unixTime
                timeStamp
              }
            }
          `,
        },
        {
          name: 'EmployeeCounter',
          content: `
            subscription EmployeeCounter($max: Int!) {
              countEmp(max: $max, intervalMilliseconds: 1000)
            }
          `,
        },
        {
          name: 'ChatStream',
          content: `
            subscription ChatStream($roomId: String!) {
              chatMessages(roomId: $roomId) {
                id
                content
                author {
                  id
                  tag
                }
                timestamp
              }
            }
          `,
        },
      ];

      const visitor = new OperationToProtoVisitor(SDL, operations);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should generate multiple streaming service methods
      expect(proto).toContain('rpc TimeUpdates(TimeUpdatesRequest) returns (stream TimeUpdatesResponse) {}');
      expect(proto).toContain('rpc EmployeeCounter(EmployeeCounterRequest) returns (stream EmployeeCounterResponse) {}');
      expect(proto).toContain('rpc ChatStream(ChatStreamRequest) returns (stream ChatStreamResponse) {}');
      
      // Should generate separate request/response messages for each
      expect(proto).toContain('message TimeUpdatesRequest {');
      expect(proto).toContain('message EmployeeCounterRequest {');
      expect(proto).toContain('message ChatStreamRequest {');
    });
  });

  describe('Subscription Error Handling', () => {
    test('should handle subscription operations with validation errors', () => {
      const operation = {
        name: 'InvalidSubscription',
        content: `
          subscription InvalidSubscription {
            nonExistentField {
              someData
            }
          }
        `,
      };

      expect(() => {
        const visitor = new OperationToProtoVisitor(SDL, [operation]);
        visitor.visit();
      }).toThrow('Field \'nonExistentField\' not found on type \'Subscription\'');
    });
  });

  describe('Subscription with Fragments', () => {
    test('should handle subscription operations with inline fragments', () => {
      const operation = {
        name: 'NotificationsWithFragments',
        content: `
          subscription NotificationsWithFragments($userId: String!) {
            notifications(userId: $userId) {
              id
              type
              title
              data {
                ... on EmployeeNotificationData {
                  employee {
                    id
                    tag
                    details {
                      forename
                    }
                  }
                  action
                }
                ... on ChatNotificationData {
                  roomId
                  author {
                    id
                    tag
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

      // Should handle inline fragments in subscription responses
      expect(proto).toContain('oneof type_specific {');
      expect(proto).toContain('message NotificationsWithFragmentsNotificationsDataEmployeeNotificationData {');
      expect(proto).toContain('message NotificationsWithFragmentsNotificationsDataChatNotificationData {');
    });

    test('should handle subscription operations with named fragments', () => {
      const operation = {
        name: 'ChatWithNamedFragments',
        content: `
          fragment AuthorInfo on Employee {
            id
            tag
            details {
              forename
              surname
            }
          }

          subscription ChatWithNamedFragments($roomId: String!) {
            chatMessages(roomId: $roomId) {
              id
              content
              author {
                ...AuthorInfo
              }
              mentions {
                ...AuthorInfo
              }
              timestamp
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should handle named fragments in subscription responses
      expect(proto).toContain('message ChatWithNamedFragmentsChatMessagesAuthor {');
      expect(proto).toContain('message ChatWithNamedFragmentsChatMessagesMentions {');
      // Both should have the same fields from the AuthorInfo fragment
      expect(proto).toContain('int32 id = 1;');
      expect(proto).toContain('string tag = 2;');
    });
  });

  describe('Subscription Performance and Scalability', () => {
    test('should handle subscription operations with large response objects', () => {
      const operation = {
        name: 'ComprehensiveEmployeeUpdates',
        content: `
          subscription ComprehensiveEmployeeUpdates {
            employeeUpdated {
              id
              tag
              notes
              updatedAt
              startDate
              currentMood
              isAvailable
              department
              details {
                forename
                surname
                hasChildren
                nationality
              }
            }
          }
        `,
      };

      const visitor = new OperationToProtoVisitor(SDL, [operation]);
      const proto = visitor.visit();

      expectValidProto(proto);

      // Should efficiently handle large response objects
      expect(proto).toContain('message ComprehensiveEmployeeUpdatesEmployeeUpdated {');
      expect(proto).toContain('ComprehensiveEmployeeUpdatesEmployeeUpdatedDetails details = 9;');
    });

    test('should handle subscription operations with deeply nested selections', () => {
      const operation = {
        name: 'DeepNestedSubscription',
        content: `
          subscription DeepNestedSubscription($userId: String!) {
            notifications(userId: $userId) {
              data {
                ... on ChatNotificationData {
                  author {
                    details {
                      forename
                      surname
                    }
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

      // Should handle deeply nested message structures
      expect(proto).toContain('message DeepNestedSubscriptionNotificationsDataChatNotificationDataAuthor {');
      expect(proto).toContain('message DeepNestedSubscriptionNotificationsDataChatNotificationDataAuthorDetails {');
    });
  });
});