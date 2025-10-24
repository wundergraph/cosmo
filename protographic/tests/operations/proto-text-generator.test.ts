import { describe, expect, test } from 'vitest';
import * as protobuf from 'protobufjs';
import {
  rootToProtoText,
  serviceToProtoText,
  messageToProtoText,
  enumToProtoText,
  formatField,
} from '../../src/operations/proto-text-generator';
import { expectValidProto } from '../util';

describe('Proto Text Generator', () => {
  describe('rootToProtoText', () => {
    test('should generate valid proto text with service and messages', () => {
      const root = new protobuf.Root();
      
      // Create a service
      const service = new protobuf.Service('TestService');
      const method = new protobuf.Method('GetUser', 'rpc', 'GetUserRequest', 'GetUserResponse');
      service.add(method);
      root.add(service);
      
      // Create messages
      const requestMsg = new protobuf.Type('GetUserRequest');
      requestMsg.add(new protobuf.Field('id', 1, 'string'));
      root.add(requestMsg);
      
      const responseMsg = new protobuf.Type('GetUserResponse');
      responseMsg.add(new protobuf.Field('name', 1, 'string'));
      root.add(responseMsg);
      
      const protoText = rootToProtoText(root);
      
      // Should be valid proto
      expectValidProto(protoText);
      
      // Should contain basic structure
      expect(protoText).toContain('syntax = "proto3"');
      expect(protoText).toContain('package service.v1');
      expect(protoText).toContain('service TestService');
      expect(protoText).toContain('message GetUserRequest');
      expect(protoText).toContain('message GetUserResponse');
    });

    test('should include custom package name', () => {
      const root = new protobuf.Root();
      const service = new protobuf.Service('MyService');
      root.add(service);
      
      const protoText = rootToProtoText(root, {
        packageName: 'custom.v1',
      });
      
      expect(protoText).toContain('package custom.v1');
    });

    test('should include go_package option when provided', () => {
      const root = new protobuf.Root();
      const service = new protobuf.Service('MyService');
      root.add(service);
      
      const protoText = rootToProtoText(root, {
        goPackage: 'github.com/example/api/v1',
      });
      
      expect(protoText).toContain('option go_package = "github.com/example/api/v1"');
    });

    test('should include custom imports', () => {
      const root = new protobuf.Root();
      const service = new protobuf.Service('MyService');
      root.add(service);
      
      const protoText = rootToProtoText(root, {
        imports: ['google/protobuf/timestamp.proto'],
      });
      
      expect(protoText).toContain('import "google/protobuf/timestamp.proto"');
    });

    test('should always include wrappers import', () => {
      const root = new protobuf.Root();
      const service = new protobuf.Service('MyService');
      root.add(service);
      
      const protoText = rootToProtoText(root);
      
      expect(protoText).toContain('import "google/protobuf/wrappers.proto"');
    });
  });

  describe('serviceToProtoText', () => {
    test('should generate service definition', () => {
      const service = new protobuf.Service('UserService');
      const method1 = new protobuf.Method('GetUser', 'rpc', 'GetUserRequest', 'GetUserResponse');
      const method2 = new protobuf.Method('ListUsers', 'rpc', 'ListUsersRequest', 'ListUsersResponse');
      service.add(method1);
      service.add(method2);
      
      const lines = serviceToProtoText(service);
      const text = lines.join('\n');
      
      expect(text).toContain('service UserService {');
      expect(text).toContain('rpc GetUser(GetUserRequest) returns (GetUserResponse) {}');
      expect(text).toContain('rpc ListUsers(ListUsersRequest) returns (ListUsersResponse) {}');
      expect(text).toContain('}');
    });

    test('should include service comment when includeComments is true', () => {
      const service = new protobuf.Service('UserService');
      service.comment = 'User management service';
      const method = new protobuf.Method('GetUser', 'rpc', 'GetUserRequest', 'GetUserResponse');
      service.add(method);
      
      const lines = serviceToProtoText(service, { includeComments: true });
      const text = lines.join('\n');
      
      expect(text).toContain('// User management service');
    });

    test('should sort methods alphabetically', () => {
      const service = new protobuf.Service('UserService');
      service.add(new protobuf.Method('UpdateUser', 'rpc', 'UpdateUserRequest', 'UpdateUserResponse'));
      service.add(new protobuf.Method('CreateUser', 'rpc', 'CreateUserRequest', 'CreateUserResponse'));
      service.add(new protobuf.Method('DeleteUser', 'rpc', 'DeleteUserRequest', 'DeleteUserResponse'));
      
      const lines = serviceToProtoText(service);
      const text = lines.join('\n');
      
      const createIndex = text.indexOf('CreateUser');
      const deleteIndex = text.indexOf('DeleteUser');
      const updateIndex = text.indexOf('UpdateUser');
      
      expect(createIndex).toBeLessThan(deleteIndex);
      expect(deleteIndex).toBeLessThan(updateIndex);
    });
  });

  describe('messageToProtoText', () => {
    test('should generate message definition', () => {
      const message = new protobuf.Type('User');
      message.add(new protobuf.Field('id', 1, 'string'));
      message.add(new protobuf.Field('name', 2, 'string'));
      message.add(new protobuf.Field('age', 3, 'int32'));
      
      const lines = messageToProtoText(message);
      const text = lines.join('\n');
      
      expect(text).toContain('message User {');
      expect(text).toContain('string id = 1;');
      expect(text).toContain('string name = 2;');
      expect(text).toContain('int32 age = 3;');
      expect(text).toContain('}');
    });

    test('should handle repeated fields', () => {
      const message = new protobuf.Type('UserList');
      const field = new protobuf.Field('users', 1, 'User');
      field.repeated = true;
      message.add(field);
      
      const lines = messageToProtoText(message);
      const text = lines.join('\n');
      
      expect(text).toContain('repeated User users = 1;');
    });

    test('should include nested messages', () => {
      const message = new protobuf.Type('User');
      const addressMsg = new protobuf.Type('Address');
      addressMsg.add(new protobuf.Field('street', 1, 'string'));
      message.add(addressMsg);
      message.add(new protobuf.Field('address', 1, 'Address'));
      
      const lines = messageToProtoText(message);
      const text = lines.join('\n');
      
      expect(text).toContain('message User {');
      expect(text).toContain('message Address {');
      expect(text).toContain('string street = 1;');
    });

    test('should include nested enums', () => {
      const message = new protobuf.Type('User');
      const statusEnum = new protobuf.Enum('Status');
      statusEnum.add('ACTIVE', 0);
      statusEnum.add('INACTIVE', 1);
      message.add(statusEnum);
      message.add(new protobuf.Field('status', 1, 'Status'));
      
      const lines = messageToProtoText(message);
      const text = lines.join('\n');
      
      expect(text).toContain('enum Status {');
      expect(text).toContain('ACTIVE = 0;');
      expect(text).toContain('INACTIVE = 1;');
    });

    test('should handle indentation for nested types', () => {
      const message = new protobuf.Type('Outer');
      const inner = new protobuf.Type('Inner');
      inner.add(new protobuf.Field('value', 1, 'string'));
      message.add(inner);
      
      const lines = messageToProtoText(message);
      const text = lines.join('\n');
      
      // Nested message should be indented
      expect(text).toMatch(/\s{2}message Inner/);
      expect(text).toMatch(/\s{4}string value = 1;/);
    });

    test('should include message comment when includeComments is true', () => {
      const message = new protobuf.Type('User');
      message.comment = 'Represents a user in the system';
      message.add(new protobuf.Field('id', 1, 'string'));
      
      const lines = messageToProtoText(message, { includeComments: true });
      const text = lines.join('\n');
      
      expect(text).toContain('// Represents a user in the system');
    });
  });

  describe('enumToProtoText', () => {
    test('should generate enum definition', () => {
      const enumType = new protobuf.Enum('Status');
      enumType.add('UNSPECIFIED', 0);
      enumType.add('ACTIVE', 1);
      enumType.add('INACTIVE', 2);
      
      const lines = enumToProtoText(enumType);
      const text = lines.join('\n');
      
      expect(text).toContain('enum Status {');
      expect(text).toContain('UNSPECIFIED = 0;');
      expect(text).toContain('ACTIVE = 1;');
      expect(text).toContain('INACTIVE = 2;');
      expect(text).toContain('}');
    });

    test('should include enum comment when includeComments is true', () => {
      const enumType = new protobuf.Enum('Status');
      enumType.comment = 'User status enumeration';
      enumType.add('UNSPECIFIED', 0);
      enumType.add('ACTIVE', 1);
      
      const lines = enumToProtoText(enumType, { includeComments: true });
      const text = lines.join('\n');
      
      expect(text).toContain('// User status enumeration');
    });

    test('should handle indentation for nested enums', () => {
      const enumType = new protobuf.Enum('Status');
      enumType.add('ACTIVE', 0);
      
      const lines = enumToProtoText(enumType, undefined, 1);
      const text = lines.join('\n');
      
      // Should be indented
      expect(text).toMatch(/\s{2}enum Status/);
    });
  });

  describe('formatField', () => {
    test('should format simple field', () => {
      const field = new protobuf.Field('name', 1, 'string');
      
      const lines = formatField(field);
      const text = lines.join('\n');
      
      expect(text).toContain('string name = 1;');
    });

    test('should format repeated field', () => {
      const field = new protobuf.Field('tags', 1, 'string');
      field.repeated = true;
      
      const lines = formatField(field);
      const text = lines.join('\n');
      
      expect(text).toContain('repeated string tags = 1;');
    });

    test('should include field comment when includeComments is true', () => {
      const field = new protobuf.Field('name', 1, 'string');
      field.comment = 'The user name';
      
      const lines = formatField(field, { includeComments: true });
      const text = lines.join('\n');
      
      expect(text).toContain('// The user name');
      expect(text).toContain('string name = 1;');
    });

    test('should handle custom indentation', () => {
      const field = new protobuf.Field('name', 1, 'string');
      
      const lines = formatField(field, undefined, 2);
      const text = lines.join('\n');
      
      expect(text).toMatch(/\s{4}string name = 1;/);
    });
  });

  describe('integration tests', () => {
    test('should generate complete valid proto file', () => {
      const root = new protobuf.Root();
      
      // Create service with multiple methods
      const service = new protobuf.Service('BookService');
      service.add(new protobuf.Method('GetBook', 'rpc', 'GetBookRequest', 'GetBookResponse'));
      service.add(new protobuf.Method('ListBooks', 'rpc', 'ListBooksRequest', 'ListBooksResponse'));
      root.add(service);
      
      // Create request/response messages
      const getBookReq = new protobuf.Type('GetBookRequest');
      getBookReq.add(new protobuf.Field('id', 1, 'string'));
      root.add(getBookReq);
      
      const getBookRes = new protobuf.Type('GetBookResponse');
      getBookRes.add(new protobuf.Field('title', 1, 'string'));
      getBookRes.add(new protobuf.Field('author', 2, 'string'));
      root.add(getBookRes);
      
      const listBooksReq = new protobuf.Type('ListBooksRequest');
      root.add(listBooksReq);
      
      const listBooksRes = new protobuf.Type('ListBooksResponse');
      const bookField = new protobuf.Field('books', 1, 'Book');
      bookField.repeated = true;
      listBooksRes.add(bookField);
      root.add(listBooksRes);
      
      // Create Book message
      const bookMsg = new protobuf.Type('Book');
      bookMsg.add(new protobuf.Field('id', 1, 'string'));
      bookMsg.add(new protobuf.Field('title', 2, 'string'));
      root.add(bookMsg);
      
      const protoText = rootToProtoText(root, {
        packageName: 'books.v1',
        goPackage: 'github.com/example/books/v1',
      });
      
      // Validate the generated proto
      expectValidProto(protoText);
      
      // Verify structure
      expect(protoText).toContain('syntax = "proto3"');
      expect(protoText).toContain('package books.v1');
      expect(protoText).toContain('option go_package = "github.com/example/books/v1"');
      expect(protoText).toContain('service BookService');
      expect(protoText).toContain('message Book');
      expect(protoText).toContain('repeated Book books = 1;');
    });
  });
});

