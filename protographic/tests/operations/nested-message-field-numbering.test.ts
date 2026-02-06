import { describe, expect, test } from 'vitest';
import { compileOperationsToProto } from '../../src/index.js';
import { expectValidProto } from '../util.js';

describe('Nested Message Field Numbering', () => {
  test('should assign field numbers starting from 1 in a simple nested message', () => {
    const schema = `
      type Query {
        getEmployee: Employee
      }
      
      type Employee {
        details: EmployeeDetails
      }
      
      type EmployeeDetails {
        forename: String
        surname: String
      }
    `;

    const operation = `
      query GetEmployee {
        getEmployee {
          details {
            forename
            surname
          }
        }
      }
    `;

    const { proto, lockData } = compileOperationsToProto(operation, schema);

    expectValidProto(proto);

    expect(proto).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      service DefaultService {
        rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse) {}
      }

      message GetEmployeeRequest {
      }

      message GetEmployeeResponse {
        message GetEmployee {
          message Details {
            google.protobuf.StringValue forename = 1;
            google.protobuf.StringValue surname = 2;
          }
          Details details = 1;
        }
        GetEmployee get_employee = 1;
      }
      "
    `);

    // Verify lock file uses dot notation for nested message path
    expect(lockData).toBeDefined();
    expect(lockData!.messages['GetEmployeeResponse.GetEmployee.Details']).toMatchInlineSnapshot(`
      {
        "fields": {
          "forename": 1,
          "surname": 2,
        },
      }
    `);
  });

  test('should not share field number counters between sibling nested messages with same name', () => {
    const schema = `
      type Query {
        getData: GetData
      }
      
      type GetData {
        userInfo: UserInfo
        productInfo: ProductInfo
      }
      
      type UserInfo {
        details: UserDetails
      }
      
      type UserDetails {
        name: String
        email: String
      }
      
      type ProductInfo {
        details: ProductDetails
      }
      
      type ProductDetails {
        title: String
        price: Float
      }
    `;

    const operation = `
      query GetData {
        getData {
          userInfo {
            details {
              name
              email
            }
          }
          productInfo {
            details {
              title
              price
            }
          }
        }
      }
    `;

    const { proto, lockData } = compileOperationsToProto(operation, schema);

    expectValidProto(proto);

    expect(proto).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      service DefaultService {
        rpc GetData(GetDataRequest) returns (GetDataResponse) {}
      }

      message GetDataRequest {
      }

      message GetDataResponse {
        message GetData {
          message UserInfo {
            message Details {
              google.protobuf.StringValue name = 1;
              google.protobuf.StringValue email = 2;
            }
            Details details = 1;
          }
          message ProductInfo {
            message Details {
              google.protobuf.StringValue title = 1;
              google.protobuf.DoubleValue price = 2;
            }
            Details details = 1;
          }
          UserInfo user_info = 1;
          ProductInfo product_info = 2;
        }
        GetData get_data = 1;
      }
      "
    `);

    // Verify both Details messages have independent field numbering in lock file
    // Each starts from 1 because they're tracked separately using full dot-notation paths
    expect(lockData!.messages['GetDataResponse.GetData.UserInfo.Details']).toMatchInlineSnapshot(`
      {
        "fields": {
          "email": 2,
          "name": 1,
        },
      }
    `);
    expect(lockData!.messages['GetDataResponse.GetData.ProductInfo.Details']).toMatchInlineSnapshot(`
      {
        "fields": {
          "price": 2,
          "title": 1,
        },
      }
    `);
  });

  test('should preserve existing field numbers when adding new fields to nested messages', () => {
    const schema1 = `
      type Query {
        getEmployee: GetEmployee
      }
      
      type GetEmployee {
        employee: Employee
      }
      
      type Employee {
        details: EmployeeDetails
      }
      
      type EmployeeDetails {
        name: String
      }
    `;

    const operation1 = `
      query GetEmployee {
        getEmployee {
          employee {
            details {
              name
            }
          }
        }
      }
    `;

    const result1 = compileOperationsToProto(operation1, schema1);

    // Now add a field to the nested Details message
    const schema2 = `
      type Query {
        getEmployee: GetEmployee
      }
      
      type GetEmployee {
        employee: Employee
      }
      
      type Employee {
        details: EmployeeDetails
      }
      
      type EmployeeDetails {
        name: String
        email: String
      }
    `;

    const operation2 = `
      query GetEmployee {
        getEmployee {
          employee {
            details {
              name
              email
            }
          }
        }
      }
    `;

    const result2 = compileOperationsToProto(operation2, schema2, { lockData: result1.lockData });

    expectValidProto(result2.proto);

    expect(result2.proto).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      service DefaultService {
        rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse) {}
      }

      message GetEmployeeRequest {
      }

      message GetEmployeeResponse {
        message GetEmployee {
          message Employee {
            message Details {
              google.protobuf.StringValue name = 1;
              google.protobuf.StringValue email = 2;
            }
            Details details = 1;
          }
          Employee employee = 1;
        }
        GetEmployee get_employee = 1;
      }
      "
    `);

    // Verify field numbers are stable: name keeps 1, email gets 2
    expect(result2.lockData!.messages['GetEmployeeResponse.GetEmployee.Employee.Details']).toMatchInlineSnapshot(`
      {
        "fields": {
          "email": 2,
          "name": 1,
        },
      }
    `);
  });

  test('should mark removed field numbers as reserved in nested messages', () => {
    const schema1 = `
      type Query {
        getEmployee: GetEmployee
      }
      
      type GetEmployee {
        employee: Employee
      }
      
      type Employee {
        details: EmployeeDetails
      }
      
      type EmployeeDetails {
        name: String
        email: String
        phone: String
      }
    `;

    const operation1 = `
      query GetEmployee {
        getEmployee {
          employee {
            details {
              name
              email
              phone
            }
          }
        }
      }
    `;

    const result1 = compileOperationsToProto(operation1, schema1);

    // Remove the email field
    const schema2 = `
      type Query {
        getEmployee: GetEmployee
      }
      
      type GetEmployee {
        employee: Employee
      }
      
      type Employee {
        details: EmployeeDetails
      }
      
      type EmployeeDetails {
        name: String
        phone: String
      }
    `;

    const operation2 = `
      query GetEmployee {
        getEmployee {
          employee {
            details {
              name
              phone
            }
          }
        }
      }
    `;

    const result2 = compileOperationsToProto(operation2, schema2, { lockData: result1.lockData });

    expectValidProto(result2.proto);

    expect(result2.proto).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      service DefaultService {
        rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse) {}
      }

      message GetEmployeeRequest {
      }

      message GetEmployeeResponse {
        message GetEmployee {
          message Employee {
            message Details {
              google.protobuf.StringValue name = 1;
              google.protobuf.StringValue phone = 3;
            }
            Details details = 1;
          }
          Employee employee = 1;
        }
        GetEmployee get_employee = 1;
      }
      "
    `);

    // Verify field number 2 (email) is reserved for backward compatibility
    expect(result2.lockData!.messages['GetEmployeeResponse.GetEmployee.Employee.Details']).toMatchInlineSnapshot(`
      {
        "fields": {
          "name": 1,
          "phone": 3,
        },
        "reservedNumbers": [
          2,
        ],
      }
    `);
  });

  test('should correctly track field numbers in deeply nested message hierarchies (5+ levels)', () => {
    const schema = `
      type Query {
        getDeep: Level1
      }
      
      type Level1 {
        level2: Level2
      }
      
      type Level2 {
        level3: Level3
      }
      
      type Level3 {
        level4: Level4
      }
      
      type Level4 {
        level5: Level5
      }
      
      type Level5 {
        value: String
      }
    `;

    const operation = `
      query GetDeep {
        getDeep {
          level2 {
            level3 {
              level4 {
                level5 {
                  value
                }
              }
            }
          }
        }
      }
    `;

    const { proto, lockData } = compileOperationsToProto(operation, schema);

    expectValidProto(proto);

    expect(proto).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      service DefaultService {
        rpc GetDeep(GetDeepRequest) returns (GetDeepResponse) {}
      }

      message GetDeepRequest {
      }

      message GetDeepResponse {
        message GetDeep {
          message Level2 {
            message Level3 {
              message Level4 {
                message Level5 {
                  google.protobuf.StringValue value = 1;
                }
                Level5 level_5 = 1;
              }
              Level4 level_4 = 1;
            }
            Level3 level_3 = 1;
          }
          Level2 level_2 = 1;
        }
        GetDeep get_deep = 1;
      }
      "
    `);

    // Verify the deepest nested message uses full dot-notation path in lock file
    expect(lockData!.messages['GetDeepResponse.GetDeep.Level2.Level3.Level4.Level5']).toMatchInlineSnapshot(`
      {
        "fields": {
          "value": 1,
        },
      }
    `);
  });
});
