import { describe, expect, test } from 'vitest';
import {
  BatchNormalizationSuccess,
  batchNormalize,
  ConfigurationData,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../src';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'graphql';
import { federateSubgraphsSuccess, normalizeSubgraphSuccess } from '../utils/utils';

// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Router Configuration tests', () => {
  describe('Normalization tests', () => {
    test('that the router configuration for employees.graphql is correctly generated', () => {
      const result = normalizeSubgraphSuccess(employees, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      const configurationDataMap = result.configurationDataByTypeName;
      expect(configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['employee', 'employees', 'products', 'teammates']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Mutation',
            {
              fieldNames: new Set<string>(['updateEmployeeTag']),
              isRootNode: true,
              typeName: 'Mutation',
            },
          ],
          [
            'Subscription',
            {
              fieldNames: new Set<string>(['currentTime']),
              isRootNode: true,
              typeName: 'Subscription',
            },
          ],
          [
            'RoleType',
            {
              fieldNames: new Set<string>(['departments', 'title']),
              isRootNode: false,
              typeName: 'RoleType',
            },
          ],
          [
            'Identifiable',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'Identifiable',
            },
          ],
          [
            'Engineer',
            {
              fieldNames: new Set<string>(['departments', 'engineerType', 'title']),
              isRootNode: false,
              typeName: 'Engineer',
            },
          ],
          [
            'Marketer',
            {
              fieldNames: new Set<string>(['departments', 'title']),
              isRootNode: false,
              typeName: 'Marketer',
            },
          ],
          [
            'Operator',
            {
              fieldNames: new Set<string>(['departments', 'operatorType', 'title']),
              isRootNode: false,
              typeName: 'Operator',
            },
          ],
          [
            'Details',
            {
              fieldNames: new Set<string>(['forename', 'location', 'surname']),
              isRootNode: false,
              typeName: 'Details',
            },
          ],
          [
            'Employee',
            {
              fieldNames: new Set<string>(['details', 'id', 'tag', 'role', 'notes', 'updatedAt', 'startDate']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Employee',
            },
          ],
          [
            'Time',
            {
              fieldNames: new Set<string>(['unixTime', 'timeStamp']),
              isRootNode: false,
              typeName: 'Time',
            },
          ],
          [
            'IProduct',
            {
              fieldNames: new Set<string>(['upc', 'engineers']),
              isRootNode: false,
              typeName: 'IProduct',
            },
          ],
          [
            'Consultancy',
            {
              fieldNames: new Set<string>(['upc', 'lead']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'upc' }],
              typeName: 'Consultancy',
            },
          ],
          [
            'Cosmo',
            {
              fieldNames: new Set<string>(['upc', 'engineers', 'lead']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'upc' }],
              typeName: 'Cosmo',
            },
          ],
          [
            'SDK',
            {
              fieldNames: new Set<string>(['upc', 'engineers', 'owner']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'upc' }],
              typeName: 'SDK',
            },
          ],
        ]),
      );
    });

    test('that the router configuration for family.graphql is correctly generated', () => {
      const result = normalizeSubgraphSuccess(family, ROUTER_COMPATIBILITY_VERSION_ONE);
      const configurationDataMap = result.configurationDataByTypeName;
      expect(configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['findEmployees']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Animal',
            {
              fieldNames: new Set<string>(['class', 'gender']),
              isRootNode: false,
              typeName: 'Animal',
            },
          ],
          [
            'Pet',
            {
              fieldNames: new Set<string>(['class', 'gender', 'name']),
              isRootNode: false,
              typeName: 'Pet',
            },
          ],
          [
            'Alligator',
            {
              fieldNames: new Set<string>(['class', 'dangerous', 'gender', 'name']),
              isRootNode: false,
              typeName: 'Alligator',
            },
          ],
          [
            'Cat',
            {
              fieldNames: new Set<string>(['class', 'gender', 'name', 'type']),
              isRootNode: false,
              typeName: 'Cat',
            },
          ],
          [
            'Dog',
            {
              fieldNames: new Set<string>(['breed', 'class', 'gender', 'name']),
              isRootNode: false,
              typeName: 'Dog',
            },
          ],
          [
            'Mouse',
            {
              fieldNames: new Set<string>(['class', 'gender', 'name']),
              isRootNode: false,
              typeName: 'Mouse',
            },
          ],
          [
            'Pony',
            {
              fieldNames: new Set<string>(['class', 'gender', 'name']),
              isRootNode: false,
              typeName: 'Pony',
            },
          ],
          [
            'Details',
            {
              fieldNames: new Set<string>([
                'forename',
                'middlename',
                'surname',
                'hasChildren',
                'maritalStatus',
                'nationality',
                'pets',
              ]),
              isRootNode: false,
              typeName: 'Details',
            },
          ],
          [
            'Employee',
            {
              fieldNames: new Set<string>(['details', 'id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Employee',
            },
          ],
        ]),
      );
    });

    test('that the router configuration for hobbies.graphql is correctly generated', () => {
      const result = normalizeSubgraphSuccess(hobbies, ROUTER_COMPATIBILITY_VERSION_ONE);
      const configurationDataMap = result.configurationDataByTypeName;
      expect(configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Exercise',
            {
              fieldNames: new Set<string>(['category']),
              isRootNode: false,
              typeName: 'Exercise',
            },
          ],
          [
            'Experience',
            {
              fieldNames: new Set<string>(['yearsOfExperience']),
              isRootNode: false,
              typeName: 'Experience',
            },
          ],
          [
            'Flying',
            {
              fieldNames: new Set<string>(['planeModels', 'yearsOfExperience']),
              isRootNode: false,
              typeName: 'Flying',
            },
          ],
          [
            'Gaming',
            {
              fieldNames: new Set<string>(['genres', 'name', 'yearsOfExperience']),
              isRootNode: false,
              typeName: 'Gaming',
            },
          ],
          [
            'Other',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'Other',
            },
          ],
          [
            'Programming',
            {
              fieldNames: new Set<string>(['languages']),
              isRootNode: false,
              typeName: 'Programming',
            },
          ],
          [
            'Travelling',
            {
              fieldNames: new Set<string>(['countriesLived']),
              isRootNode: false,
              typeName: 'Travelling',
            },
          ],
          [
            'Employee',
            {
              fieldNames: new Set<string>(['id', 'hobbies']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Employee',
            },
          ],
          [
            'SDK',
            {
              fieldNames: new Set<string>(['upc', 'clientLanguages']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'upc' }],
              typeName: 'SDK',
            },
          ],
        ]),
      );
    });

    test('that the router configuration for products.graphql is correctly generated', () => {
      const result = normalizeSubgraphSuccess(products, ROUTER_COMPATIBILITY_VERSION_ONE);
      const configurationDataMap = result.configurationDataByTypeName;
      expect(configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['productTypes', 'topSecretFederationFacts', 'factTypes']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'TopSecretFact',
            {
              fieldNames: new Set<string>(['description', 'factType']),
              isRootNode: false,
              typeName: 'TopSecretFact',
            },
          ],
          [
            'DirectiveFact',
            {
              fieldNames: new Set<string>(['title', 'description', 'factType']),
              isRootNode: false,
              typeName: 'DirectiveFact',
            },
          ],
          [
            'EntityFact',
            {
              fieldNames: new Set<string>(['title', 'description', 'factType']),
              isRootNode: false,
              typeName: 'EntityFact',
            },
          ],
          [
            'MiscellaneousFact',
            {
              fieldNames: new Set<string>(['title', 'description', 'factType']),
              isRootNode: false,
              typeName: 'MiscellaneousFact',
            },
          ],
          [
            'Employee',
            {
              fieldNames: new Set<string>(['id', 'products', 'notes']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Employee',
            },
          ],
          [
            'Consultancy',
            {
              fieldNames: new Set<string>(['upc', 'name']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'upc' }],
              typeName: 'Consultancy',
            },
          ],
          [
            'Cosmo',
            {
              fieldNames: new Set<string>(['upc', 'name', 'repositoryURL']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'upc' }],
              typeName: 'Cosmo',
            },
          ],
          [
            'Documentation',
            {
              fieldNames: new Set<string>(['url', 'urls']),
              isRootNode: false,
              typeName: 'Documentation',
            },
          ],
        ]),
      );
    });

    test('that FieldSet configuration is generated', () => {
      const result = normalizeSubgraphSuccess(subgraphA, ROUTER_COMPATIBILITY_VERSION_ONE);
      const configurationDataMap = result.configurationDataByTypeName;
      expect(configurationDataMap).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['id', 'name']),
              fieldNames: new Set<string>(),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['age', 'entity', 'name']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: 'field' }],
              typeName: 'Object',
            },
          ],
          [
            'AnotherEntity',
            {
              externalFieldNames: new Set<string>(['field', 'anotherField']),
              fieldNames: new Set<string>(['id', 'myField']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              requires: [{ fieldName: 'myField', selectionSet: 'anotherField { age name nested { name } }' }],
              typeName: 'AnotherEntity',
            },
          ],
          [
            'OtherObject',
            {
              fieldNames: new Set<string>(['age', 'name', 'nested']),
              isRootNode: false,
              typeName: 'OtherObject',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
    });

    test('that entity interfaces produce the correct configuration', () => {
      const result = normalizeSubgraphSuccess(subgraphB, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'age', 'field']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'Interface',
            {
              entityInterfaceConcreteTypeNames: new Set<string>(['Entity']),
              fieldNames: new Set<string>(['id', 'age']),
              isInterfaceObject: false,
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Interface',
            },
          ],
        ]),
      );
    });

    test('that interface objects produce the correct configuration', () => {
      const result = normalizeSubgraphSuccess(subgraphC, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Interface',
            {
              entityInterfaceConcreteTypeNames: new Set<string>(),
              fieldNames: new Set<string>(['id', 'name']),
              isInterfaceObject: true,
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Interface',
            },
          ],
        ]),
      );
    });

    test('that nested external fields that are part of a key FieldSet are added to configuration', () => {
      const result = normalizeSubgraphSuccess(subgraphD, ROUTER_COMPATIBILITY_VERSION_ONE);
      const configurationData = result.configurationDataByTypeName;
      expect(configurationData).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['id', 'object']),
              fieldNames: new Set<string>(),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id object { id }' }],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              externalFieldNames: new Set<string>(['id']),
              fieldNames: new Set<string>(),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });
  });

  describe('Federation tests', () => {
    test('that field configurations are correctly generated', () => {
      const result = federateSubgraphsSuccess([employees, family, hobbies, products], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: ['id'],
          fieldName: 'employee',
          typeName: 'Query',
        },
        {
          argumentNames: ['team'],
          fieldName: 'teammates',
          typeName: 'Query',
        },
        {
          argumentNames: ['criteria'],
          fieldName: 'findEmployees',
          typeName: 'Query',
        },
        {
          argumentNames: ['id', 'tag'],
          fieldName: 'updateEmployeeTag',
          typeName: 'Mutation',
        },
        {
          argumentNames: ['product'],
          fieldName: 'url',
          typeName: 'Documentation',
        },
        {
          argumentNames: ['products'],
          fieldName: 'urls',
          typeName: 'Documentation',
        },
        {
          argumentNames: [],
          fieldName: 'startDate',
          requiredScopes: [['read:employee', 'read:private'], ['read:all']],
          requiredScopesByOR: [['read:employee', 'read:private'], ['read:all']],
          requiresAuthentication: false,
          typeName: 'Employee',
        },
        {
          argumentNames: [],
          fieldName: 'topSecretFederationFacts',
          requiredScopes: [['read:fact'], ['read:all']],
          requiredScopesByOR: [['read:fact'], ['read:all']],
          requiresAuthentication: true,
          typeName: 'Query',
        },
        {
          argumentNames: [],
          fieldName: 'factTypes',
          requiredScopes: [],
          requiredScopesByOR: [],
          requiresAuthentication: true,
          typeName: 'Query',
        },
        {
          argumentNames: [],
          fieldName: 'factType',
          requiredScopes: [],
          requiredScopesByOR: [],
          requiresAuthentication: true,
          typeName: 'TopSecretFact',
        },
        {
          argumentNames: [],
          fieldName: 'description',
          requiredScopes: [['read:scalar'], ['read:all']],
          requiredScopesByOR: [['read:scalar'], ['read:all']],
          requiresAuthentication: false,
          typeName: 'TopSecretFact',
        },
        {
          argumentNames: [],
          fieldName: 'factType',
          requiredScopes: [],
          requiredScopesByOR: [],
          requiresAuthentication: true,
          typeName: 'DirectiveFact',
        },
        {
          argumentNames: [],
          fieldName: 'description',
          requiredScopes: [['read:scalar'], ['read:all']],
          requiredScopesByOR: [['read:scalar'], ['read:all']],
          requiresAuthentication: false,
          typeName: 'DirectiveFact',
        },
        {
          argumentNames: [],
          fieldName: 'factType',
          requiredScopes: [],
          requiredScopesByOR: [],
          requiresAuthentication: true,
          typeName: 'EntityFact',
        },
        {
          argumentNames: [],
          fieldName: 'description',
          requiredScopes: [['read:scalar'], ['read:all']],
          requiredScopesByOR: [['read:scalar'], ['read:all']],
          requiresAuthentication: false,
          typeName: 'EntityFact',
        },
        {
          argumentNames: [],
          fieldName: 'description',
          requiredScopes: [
            ['read:scalar', 'read:miscellaneous'],
            ['read:all', 'read:miscellaneous'],
          ],
          requiredScopesByOR: [
            ['read:scalar', 'read:miscellaneous'],
            ['read:all', 'read:miscellaneous'],
          ],
          requiresAuthentication: false,
          typeName: 'MiscellaneousFact',
        },
        {
          argumentNames: [],
          fieldName: 'factType',
          requiredScopes: [],
          requiredScopesByOR: [],
          requiresAuthentication: true,
          typeName: 'MiscellaneousFact',
        },
      ]);
    });

    test('that the router configuration is correctly generated', () => {
      const result = batchNormalize(
        [monolith, reviews, users],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      expect(result.internalSubgraphBySubgraphName.get('monolith')!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['getUser']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
        ]),
      );
      expect(result.internalSubgraphBySubgraphName.get('reviews')!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['getUser']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Review',
            {
              fieldNames: new Set<string>(['content', 'rating']),
              isRootNode: false,
              typeName: 'Review',
            },
          ],
          [
            'User',
            {
              fieldNames: new Set<string>(['id', 'reviews']),
              isRootNode: false,
              typeName: 'User',
            },
          ],
        ]),
      );
      expect(result.internalSubgraphBySubgraphName.get('users')!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['getUser']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'User',
            {
              fieldNames: new Set<string>(['id', 'username']),
              isRootNode: false,
              typeName: 'User',
            },
          ],
        ]),
      );
    });
  });
});

const employeesSDL = fs.readFileSync(join(__dirname, 'test-data/employees.graphql')).toString();
const familySDL = fs.readFileSync(join(__dirname, 'test-data/family.graphql')).toString();
const hobbiesSDL = fs.readFileSync(join(__dirname, 'test-data/hobbies.graphql')).toString();
const productsSDL = fs.readFileSync(join(__dirname, '/test-data/products.graphql')).toString();

const employees: Subgraph = {
  name: 'employees',
  url: '',
  definitions: parse(employeesSDL),
};

const family: Subgraph = {
  name: 'family',
  url: '',
  definitions: parse(familySDL),
};

const hobbies: Subgraph = {
  name: 'hobbies',
  url: '',
  definitions: parse(hobbiesSDL),
};

const products: Subgraph = {
  name: 'products',
  url: '',
  definitions: parse(productsSDL),
};

const monolith: Subgraph = {
  name: 'monolith',
  url: '',
  definitions: parse(`
    type Query {
      getUser(id: Int!): User
    }
    
    type Review {
      content: String!
      rating: Int!
    }
    
    type User {
      id: ID!
      username: String!
      reviews: [Review!]
    }
  `),
};

const reviews: Subgraph = {
  name: 'reviews',
  url: '',
  definitions: parse(`
    type Query {
      getUser(id: Int!): User @shareable
    }
    
    type Review {
      content: String! @override(from: "monolith")
      rating: Int! @override(from: "monolith")
    }
    
    type User {
      id: ID! @shareable
      reviews: [Review!] @override(from: "monolith")
    }
  `),
};

const users: Subgraph = {
  name: 'users',
  url: '',
  definitions: parse(`
    type Query {
      getUser(id: Int!): User @shareable
    }
    
    type User {
      id: ID! @override(from: "monolith") @shareable
      username: String! @override(from: "monolith")
    }
  `),
};

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID! @external
      name: String! @external
    }
    
    type Object {
      age: Int!
      entity: AnotherEntity @provides(fields: "field")
      name: String!
    }
    
    type AnotherEntity @key(fields: "id") {
      id: ID!
      field: String! @external
      anotherField: OtherObject! @external
      myField: Boolean @requires(fields: "anotherField { nested { name } name, age }")
    }
    
    type OtherObject {
      age: Int!
      name: String!
      nested: NestedObject!
    }
    
    type NestedObject {
      name: String!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      age: Int!
      field: String!
    }
    interface Interface @key(fields: "id") {
      id: ID!
      age: Int!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Interface @key(fields: "id") @interfaceObject {
    id: ID!
    name: String!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id object { id }") {
      id: ID @external
      object: Object! @external
    }
    type Object {
      id: ID! @external
    }
  `),
};
