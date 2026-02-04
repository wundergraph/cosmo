import { describe, expect, it } from 'vitest';
import { buildProtoMessage } from '../../src/proto-utils.js';
import { ProtoMessage, CompositeMessageKind } from '../../src/types.js';

describe('buildProtoMessage', () => {
  describe('basic message generation', () => {
    it('should generate a simple message with scalar fields', () => {
      const message: ProtoMessage = {
        messageName: 'User',
        fields: [
          { fieldName: 'id', typeName: 'string', fieldNumber: 1 },
          { fieldName: 'name', typeName: 'string', fieldNumber: 2 },
          { fieldName: 'age', typeName: 'int32', fieldNumber: 3 },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message User {
          string id = 1;
          string name = 2;
          int32 age = 3;
        }
        "
      `);
    });

    it('should generate a message with different field types', () => {
      const message: ProtoMessage = {
        messageName: 'Settings',
        fields: [
          { fieldName: 'enabled', typeName: 'bool', fieldNumber: 1 },
          { fieldName: 'count', typeName: 'int32', fieldNumber: 2 },
          { fieldName: 'ratio', typeName: 'double', fieldNumber: 3 },
          { fieldName: 'label', typeName: 'google.protobuf.StringValue', fieldNumber: 4 },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message Settings {
          bool enabled = 1;
          int32 count = 2;
          double ratio = 3;
          google.protobuf.StringValue label = 4;
        }
        "
      `);
    });

    it('should generate a message with repeated fields', () => {
      const message: ProtoMessage = {
        messageName: 'TagList',
        fields: [
          { fieldName: 'tags', typeName: 'string', fieldNumber: 1, isRepeated: true },
          { fieldName: 'scores', typeName: 'int32', fieldNumber: 2, isRepeated: true },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message TagList {
          repeated string tags = 1;
          repeated int32 scores = 2;
        }
        "
      `);
    });
  });

  describe('nested messages', () => {
    it('should generate a message with a nested message', () => {
      const message: ProtoMessage = {
        messageName: 'UserResponse',
        fields: [{ fieldName: 'address', typeName: 'Address', fieldNumber: 1 }],
        nestedMessages: [
          {
            messageName: 'Address',
            fields: [
              { fieldName: 'street', typeName: 'string', fieldNumber: 1 },
              { fieldName: 'city', typeName: 'string', fieldNumber: 2 },
            ],
          },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message UserResponse {
          message Address {
            string street = 1;
            string city = 2;
          }

          Address address = 1;
        }
        "
      `);
    });

    it('should generate multiple levels of nested messages', () => {
      const message: ProtoMessage = {
        messageName: 'Company',
        fields: [{ fieldName: 'headquarters', typeName: 'Location', fieldNumber: 1 }],
        nestedMessages: [
          {
            messageName: 'Location',
            fields: [{ fieldName: 'address', typeName: 'Address', fieldNumber: 1 }],
            nestedMessages: [
              {
                messageName: 'Address',
                fields: [
                  { fieldName: 'street', typeName: 'string', fieldNumber: 1 },
                  { fieldName: 'zip', typeName: 'string', fieldNumber: 2 },
                ],
              },
            ],
          },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message Company {
          message Location {
            message Address {
              string street = 1;
              string zip = 2;
            }

            Address address = 1;
          }

          Location headquarters = 1;
        }
        "
      `);
    });

    it('should throw error for duplicate nested messages with the same name', () => {
      const message: ProtoMessage = {
        messageName: 'UserResponse',
        fields: [
          { fieldName: 'home_address', typeName: 'Address', fieldNumber: 1 },
          { fieldName: 'work_address', typeName: 'Address', fieldNumber: 2 },
        ],
        nestedMessages: [
          {
            messageName: 'Address',
            fields: [
              { fieldName: 'street', typeName: 'string', fieldNumber: 1 },
              { fieldName: 'city', typeName: 'string', fieldNumber: 2 },
            ],
          },
          {
            messageName: 'Address',
            fields: [
              { fieldName: 'street', typeName: 'string', fieldNumber: 1 },
              { fieldName: 'city', typeName: 'string', fieldNumber: 2 },
            ],
          },
        ],
      };

      expect(() => buildProtoMessage(false, message)).toThrow('Duplicate nested message name: Address');
    });

    it('should throw error for nested messages with the same name but different fields', () => {
      const message: ProtoMessage = {
        messageName: 'Response',
        fields: [
          { fieldName: 'primary', typeName: 'Details', fieldNumber: 1 },
          { fieldName: 'secondary', typeName: 'Details', fieldNumber: 2 },
        ],
        nestedMessages: [
          {
            messageName: 'Details',
            fields: [
              { fieldName: 'name', typeName: 'string', fieldNumber: 1 },
              { fieldName: 'value', typeName: 'string', fieldNumber: 2 },
            ],
          },
          {
            messageName: 'Details',
            fields: [
              { fieldName: 'id', typeName: 'int32', fieldNumber: 1 },
              { fieldName: 'count', typeName: 'int32', fieldNumber: 2 },
              { fieldName: 'active', typeName: 'bool', fieldNumber: 3 },
            ],
          },
        ],
      };

      expect(() => buildProtoMessage(false, message)).toThrow('Duplicate nested message name: Details');
    });

    it('should allow same message name at different nesting levels', () => {
      // In protobuf, the same message name at different nesting levels is valid
      // because they are scoped differently
      const message: ProtoMessage = {
        messageName: 'Outer',
        fields: [
          { fieldName: 'data', typeName: 'Data', fieldNumber: 1 },
          { fieldName: 'inner', typeName: 'Inner', fieldNumber: 2 },
        ],
        nestedMessages: [
          {
            messageName: 'Data',
            fields: [{ fieldName: 'value', typeName: 'string', fieldNumber: 1 }],
          },
          {
            messageName: 'Inner',
            fields: [{ fieldName: 'nested_data', typeName: 'Data', fieldNumber: 1 }],
            nestedMessages: [
              {
                // Same name "Data" but at a different nesting level - this is valid
                messageName: 'Data',
                fields: [{ fieldName: 'id', typeName: 'int32', fieldNumber: 1 }],
              },
            ],
          },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message Outer {
          message Data {
            string value = 1;
          }

          message Inner {
            message Data {
              int32 id = 1;
            }

            Data nested_data = 1;
          }

          Data data = 1;
          Inner inner = 2;
        }
        "
      `);
    });
  });

  describe('composite types on fields', () => {
    it('should generate a field with an interface composite type (oneof instance)', () => {
      const message: ProtoMessage = {
        messageName: 'AnimalResponse',
        fields: [
          {
            fieldName: 'animal',
            typeName: 'Animal',
            fieldNumber: 1,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'Animal',
              implementingTypes: ['Cat', 'Dog'],
            },
          },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message AnimalResponse {
          message Animal {
            oneof instance {
              Cat cat = 1;
              Dog dog = 2;
            }
          }
          Animal animal = 1;
        }
        "
      `);
    });

    it('should generate a field with a union composite type (oneof value)', () => {
      const message: ProtoMessage = {
        messageName: 'SearchResponse',
        fields: [
          {
            fieldName: 'result',
            typeName: 'SearchResult',
            fieldNumber: 1,
            compositeType: {
              kind: CompositeMessageKind.UNION,
              typeName: 'SearchResult',
              memberTypes: ['User', 'Product', 'Order'],
            },
          },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message SearchResponse {
          message SearchResult {
            oneof value {
              Order order = 1;
              Product product = 2;
              User user = 3;
            }
          }
          SearchResult result = 1;
        }
        "
      `);
    });
  });

  describe('multiple composite types on different fields', () => {
    it('should generate multiple fields with different composite types', () => {
      const message: ProtoMessage = {
        messageName: 'MixedResponse',
        fields: [
          {
            fieldName: 'pet',
            typeName: 'Pet',
            fieldNumber: 1,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'Pet',
              implementingTypes: ['Cat', 'Dog'],
            },
          },
          {
            fieldName: 'item',
            typeName: 'ShopItem',
            fieldNumber: 2,
            compositeType: {
              kind: CompositeMessageKind.UNION,
              typeName: 'ShopItem',
              memberTypes: ['Book', 'Electronics'],
            },
          },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message MixedResponse {
          message Pet {
            oneof instance {
              Cat cat = 1;
              Dog dog = 2;
            }
          }
          message ShopItem {
            oneof value {
              Book book = 1;
              Electronics electronics = 2;
            }
          }
          Pet pet = 1;
          ShopItem item = 2;
        }
        "
      `);
    });

    it('should handle multiple interface composite types on different fields', () => {
      const message: ProtoMessage = {
        messageName: 'Dashboard',
        fields: [
          {
            fieldName: 'primary_widget',
            typeName: 'Widget',
            fieldNumber: 1,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'Widget',
              implementingTypes: ['Chart', 'Table', 'Counter'],
            },
          },
          {
            fieldName: 'data_source',
            typeName: 'DataSource',
            fieldNumber: 2,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'DataSource',
              implementingTypes: ['Database', 'API', 'File'],
            },
          },
          { fieldName: 'title', typeName: 'string', fieldNumber: 3 },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message Dashboard {
          message Widget {
            oneof instance {
              Chart chart = 1;
              Counter counter = 2;
              Table table = 3;
            }
          }
          message DataSource {
            oneof instance {
              API api = 1;
              Database database = 2;
              File file = 3;
            }
          }
          Widget primary_widget = 1;
          DataSource data_source = 2;
          string title = 3;
        }
        "
      `);
    });
  });

  describe('composite type deduplication', () => {
    it('should not duplicate composite type when same type is referenced by multiple fields', () => {
      const message: ProtoMessage = {
        messageName: 'Response',
        fields: [
          {
            fieldName: 'primary_result',
            typeName: 'SearchResult',
            fieldNumber: 1,
            compositeType: {
              kind: CompositeMessageKind.UNION,
              typeName: 'SearchResult',
              memberTypes: ['User', 'Product'],
            },
          },
          {
            fieldName: 'secondary_result',
            typeName: 'SearchResult',
            fieldNumber: 2,
            compositeType: {
              kind: CompositeMessageKind.UNION,
              typeName: 'SearchResult',
              memberTypes: ['User', 'Product'],
            },
          },
        ],
      };

      const result = buildProtoMessage(false, message);

      // SearchResult should only appear once, not twice
      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message Response {
          message SearchResult {
            oneof value {
              Product product = 1;
              User user = 2;
            }
          }
          SearchResult primary_result = 1;
          SearchResult secondary_result = 2;
        }
        "
      `);
    });

    it('should count exactly one message definition when multiple fields reference same composite type', () => {
      const message: ProtoMessage = {
        messageName: 'MultiFieldResponse',
        fields: [
          {
            fieldName: 'first',
            typeName: 'Animal',
            fieldNumber: 1,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'Animal',
              implementingTypes: ['Cat', 'Dog'],
            },
          },
          {
            fieldName: 'second',
            typeName: 'Animal',
            fieldNumber: 2,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'Animal',
              implementingTypes: ['Cat', 'Dog'],
            },
          },
          {
            fieldName: 'third',
            typeName: 'Animal',
            fieldNumber: 3,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'Animal',
              implementingTypes: ['Cat', 'Dog'],
            },
          },
        ],
      };

      const result = buildProtoMessage(false, message).join('\n');

      // Count occurrences of "message Animal {" - should be exactly 1
      const messageDefinitions = result.match(/message Animal {/g);
      expect(messageDefinitions).toHaveLength(1);

      expect(result).toMatchInlineSnapshot(`
        "message MultiFieldResponse {
          message Animal {
            oneof instance {
              Cat cat = 1;
              Dog dog = 2;
            }
          }
          Animal first = 1;
          Animal second = 2;
          Animal third = 3;
        }
        "
      `);
    });

    it('should deduplicate composite types with same name even when defined on different fields', () => {
      const message: ProtoMessage = {
        messageName: 'ComplexResponse',
        fields: [
          {
            fieldName: 'pet',
            typeName: 'Pet',
            fieldNumber: 1,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'Pet',
              implementingTypes: ['Cat', 'Dog'],
            },
          },
          { fieldName: 'name', typeName: 'string', fieldNumber: 2 },
          {
            fieldName: 'another_pet',
            typeName: 'Pet',
            fieldNumber: 3,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'Pet',
              implementingTypes: ['Cat', 'Dog'],
            },
          },
          { fieldName: 'count', typeName: 'int32', fieldNumber: 4 },
          {
            fieldName: 'favorite_pet',
            typeName: 'Pet',
            fieldNumber: 5,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'Pet',
              implementingTypes: ['Cat', 'Dog'],
            },
          },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message ComplexResponse {
          message Pet {
            oneof instance {
              Cat cat = 1;
              Dog dog = 2;
            }
          }
          Pet pet = 1;
          string name = 2;
          Pet another_pet = 3;
          int32 count = 4;
          Pet favorite_pet = 5;
        }
        "
      `);
    });

    it('should handle mixed composite types without cross-contamination', () => {
      const message: ProtoMessage = {
        messageName: 'MixedDedup',
        fields: [
          {
            fieldName: 'animal1',
            typeName: 'Animal',
            fieldNumber: 1,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'Animal',
              implementingTypes: ['Cat', 'Dog'],
            },
          },
          {
            fieldName: 'search1',
            typeName: 'SearchResult',
            fieldNumber: 2,
            compositeType: {
              kind: CompositeMessageKind.UNION,
              typeName: 'SearchResult',
              memberTypes: ['User', 'Product'],
            },
          },
          {
            fieldName: 'animal2',
            typeName: 'Animal',
            fieldNumber: 3,
            compositeType: {
              kind: CompositeMessageKind.INTERFACE,
              typeName: 'Animal',
              implementingTypes: ['Cat', 'Dog'],
            },
          },
          {
            fieldName: 'search2',
            typeName: 'SearchResult',
            fieldNumber: 4,
            compositeType: {
              kind: CompositeMessageKind.UNION,
              typeName: 'SearchResult',
              memberTypes: ['User', 'Product'],
            },
          },
        ],
      };

      const result = buildProtoMessage(false, message).join('\n');

      // Should have exactly one Animal message and one SearchResult message
      const animalDefinitions = result.match(/message Animal {/g);
      const searchResultDefinitions = result.match(/message SearchResult {/g);

      expect(animalDefinitions).toHaveLength(1);
      expect(searchResultDefinitions).toHaveLength(1);

      expect(result).toMatchInlineSnapshot(`
        "message MixedDedup {
          message Animal {
            oneof instance {
              Cat cat = 1;
              Dog dog = 2;
            }
          }
          message SearchResult {
            oneof value {
              Product product = 1;
              User user = 2;
            }
          }
          Animal animal1 = 1;
          SearchResult search1 = 2;
          Animal animal2 = 3;
          SearchResult search2 = 4;
        }
        "
      `);
    });
  });

  describe('reserved field numbers', () => {
    it('should include reserved numbers in the message', () => {
      const message: ProtoMessage = {
        messageName: 'User',
        reservedNumbers: '4, 5, 10 to 15',
        fields: [
          { fieldName: 'id', typeName: 'string', fieldNumber: 1 },
          { fieldName: 'name', typeName: 'string', fieldNumber: 2 },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message User {
          reserved 4, 5, 10 to 15;
          string id = 1;
          string name = 2;
        }
        "
      `);
    });
  });

  describe('comments', () => {
    it('should include message and field descriptions when includeComments is true', () => {
      const message: ProtoMessage = {
        messageName: 'User',
        description: 'Represents a user in the system',
        fields: [
          { fieldName: 'id', typeName: 'string', fieldNumber: 1, description: 'Unique identifier' },
          { fieldName: 'name', typeName: 'string', fieldNumber: 2, description: 'Display name' },
        ],
      };

      const result = buildProtoMessage(true, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "// Represents a user in the system
        message User {
          // Unique identifier
          string id = 1;
          // Display name
          string name = 2;
        }
        "
      `);
    });

    it('should exclude descriptions when includeComments is false', () => {
      const message: ProtoMessage = {
        messageName: 'User',
        description: 'Represents a user in the system',
        fields: [
          { fieldName: 'id', typeName: 'string', fieldNumber: 1, description: 'Unique identifier' },
          { fieldName: 'name', typeName: 'string', fieldNumber: 2, description: 'Display name' },
        ],
      };

      const result = buildProtoMessage(false, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message User {
          string id = 1;
          string name = 2;
        }
        "
      `);
    });

    it('should format multi-line descriptions as block comments', () => {
      const message: ProtoMessage = {
        messageName: 'User',
        description: 'Represents a user in the system.\nThis is a second line.\nAnd a third.',
        fields: [{ fieldName: 'id', typeName: 'string', fieldNumber: 1 }],
      };

      const result = buildProtoMessage(true, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "/*
         * Represents a user in the system.
         * This is a second line.
         * And a third.
         */
        message User {
          string id = 1;
        }
        "
      `);
    });

    it('should include composite type descriptions', () => {
      const message: ProtoMessage = {
        messageName: 'Response',
        fields: [
          {
            fieldName: 'result',
            typeName: 'SearchResult',
            fieldNumber: 1,
            description: 'The search result',
            compositeType: {
              kind: CompositeMessageKind.UNION,
              typeName: 'SearchResult',
              description: 'Union of possible search results',
              memberTypes: ['User', 'Product'],
            },
          },
        ],
      };

      const result = buildProtoMessage(true, message);

      expect(result.join('\n')).toMatchInlineSnapshot(`
        "message Response {
          // Union of possible search results
          message SearchResult {
            oneof value {
              Product product = 1;
              User user = 2;
            }
          }
          // The search result
          SearchResult result = 1;
        }
        "
      `);
    });
  });
});
