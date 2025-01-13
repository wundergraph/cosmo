import { describe, expect, test } from 'vitest';
import {
  ConditionalFieldData,
  ConfigurationData,
  externalEntityExtensionKeyFieldWarning,
  federateSubgraphs,
  fieldAlreadyProvidedErrorMessage,
  fieldAlreadyProvidedWarning,
  INTERFACE,
  invalidInlineFragmentTypeConditionErrorMessage,
  invalidInlineFragmentTypeErrorMessage,
  invalidProvidesOrRequiresDirectivesError,
  invalidSelectionOnUnionErrorMessage,
  nonExternalConditionalFieldError,
  nonExternalConditionalFieldWarning,
  normalizeSubgraph,
  PROVIDES,
  Subgraph,
  subgraphValidationError,
  UNION,
} from '../src';
import { parse } from 'graphql';

describe('@provides directive tests', () => {
  describe('Normalization tests', () => {
    // TODO
    test.skip('that a @provides directive is ignored when declared on a non-entity response type', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(a.definitions, a.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides field set supports an immediate inline fragment', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(b.definitions, b.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: '... on Entity { name }' }],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['name']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides field set returns an error for an invalid inline fragment', () => {
      const { errors, warnings } = normalizeSubgraph(c.definitions, c.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(PROVIDES, [
          ` On "Object.entity":\n -` +
            invalidInlineFragmentTypeErrorMessage(
              '... on Interface { name }',
              ['Object.entity'],
              'Interface',
              'Entity',
            ),
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides field set supports multiple inline fragments', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(d.definitions, d.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [
                { fieldName: 'entity', selectionSet: 'interface { ... on Interface { ... on Interface { name } } }' },
              ],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['interface']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'Interface',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'Interface',
            },
          ],
          [
            'Implementation',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'Implementation',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides field set supports an inline fragment with a valid type condition', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(e.definitions, e.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: 'interface { ... on AnotherObject { name } }' }],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['interface']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'Interface',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'Interface',
            },
          ],
          [
            'AnotherObject',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'AnotherObject',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides field set returns an error for an inline fragment with an invalid type condition on an Interface', () => {
      const { errors, warnings } = normalizeSubgraph(f.definitions, f.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(PROVIDES, [
          ` On "Object.entity":\n -` +
            invalidInlineFragmentTypeConditionErrorMessage(
              'interface { ... on AnotherObject { name } }',
              ['Entity.interface'],
              'AnotherObject',
              INTERFACE,
              'Interface',
            ),
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides field set supports an inline fragment with a valid type condition on a Union', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(g.definitions, g.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: 'union { ... on AnotherObject { name } }' }],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['union']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'AnotherObject',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'AnotherObject',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides field set returns an error if a union does not define a fragment', () => {
      const { errors, warnings } = normalizeSubgraph(h.definitions, h.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(PROVIDES, [
          ` On "Object.entity":\n -` + invalidSelectionOnUnionErrorMessage('union { name }', ['Entity.union'], 'Union'),
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides field set returns an error for an inline fragment with an invalid type condition on a Union', () => {
      const { errors, warnings } = normalizeSubgraph(i.definitions, i.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidProvidesOrRequiresDirectivesError(PROVIDES, [
          ` On "Object.entity":\n -` +
            invalidInlineFragmentTypeConditionErrorMessage(
              'union { ... on YetAnotherObject { name } }',
              ['Entity.union'],
              'YetAnotherObject',
              UNION,
              'Union',
            ),
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides field set allows undefined optional arguments', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(j.definitions, j.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: 'anotherObject { name }' }],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['anotherObject']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'AnotherObject',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'AnotherObject',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides field set allows defined optional arguments', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(k.definitions, k.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Object',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: false,
              provides: [{ fieldName: 'entity', selectionSet: 'anotherObject(arg: "string") { name }' }],
              typeName: 'Object',
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['anotherObject']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
          [
            'AnotherObject',
            {
              fieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'AnotherObject',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides directive produces the correct conditional field datas', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(l.definitions, l.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult!.conditionalFieldDataByCoordinates).toStrictEqual(
        new Map<string, ConditionalFieldData>([
          [
            'NestedObject.age',
            {
              providedBy: [
                {
                  fieldCoordinatesPath: ['Query.entity', 'Entity.object', 'Object.nestedObject', 'NestedObject.age'],
                  fieldPath: ['entity', 'object', 'nestedObject', 'age'],
                  typePath: ['Query', 'Entity', 'Object', 'NestedObject'],
                },
                {
                  fieldCoordinatesPath: ['Query.entities', 'Entity.object', 'Object.nestedObject', 'NestedObject.age'],
                  fieldPath: ['entities', 'object', 'nestedObject', 'age'],
                  typePath: ['Query', 'Entity', 'Object', 'NestedObject'],
                },
              ],
              requiredBy: [],
            },
          ],
          [
            'NestedObject.name',
            {
              providedBy: [
                {
                  fieldCoordinatesPath: ['Query.entity', 'Entity.object', 'Object.nestedObject', 'NestedObject.name'],
                  fieldPath: ['entity', 'object', 'nestedObject', 'name'],
                  typePath: ['Query', 'Entity', 'Object', 'NestedObject'],
                },
                {
                  fieldCoordinatesPath: ['Query.entities', 'Entity.object', 'Object.nestedObject', 'NestedObject.name'],
                  fieldPath: ['entities', 'object', 'nestedObject', 'name'],
                  typePath: ['Query', 'Entity', 'Object', 'NestedObject'],
                },
              ],
              requiredBy: [],
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a @provides directive on a renamed root type produces the correct conditional field datas', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(m.definitions, m.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult!.conditionalFieldDataByCoordinates).toStrictEqual(
        new Map<string, ConditionalFieldData>([
          [
            'NestedObject.age',
            {
              providedBy: [
                {
                  fieldCoordinatesPath: ['Query.entity', 'Entity.object', 'Object.nestedObject', 'NestedObject.age'],
                  fieldPath: ['entity', 'object', 'nestedObject', 'age'],
                  typePath: ['Query', 'Entity', 'Object', 'NestedObject'],
                },
                {
                  fieldCoordinatesPath: ['Query.entities', 'Entity.object', 'Object.nestedObject', 'NestedObject.age'],
                  fieldPath: ['entities', 'object', 'nestedObject', 'age'],
                  typePath: ['Query', 'Entity', 'Object', 'NestedObject'],
                },
              ],
              requiredBy: [],
            },
          ],
          [
            'NestedObject.name',
            {
              providedBy: [
                {
                  fieldCoordinatesPath: ['Query.entity', 'Entity.object', 'Object.nestedObject', 'NestedObject.name'],
                  fieldPath: ['entity', 'object', 'nestedObject', 'name'],
                  typePath: ['Query', 'Entity', 'Object', 'NestedObject'],
                },
                {
                  fieldCoordinatesPath: ['Query.entities', 'Entity.object', 'Object.nestedObject', 'NestedObject.name'],
                  fieldPath: ['entities', 'object', 'nestedObject', 'name'],
                  typePath: ['Query', 'Entity', 'Object', 'NestedObject'],
                },
              ],
              requiredBy: [],
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if provided leaf field in a v2 subgraph is not @external and has no @external ancestor', () => {
      const { errors, warnings } = normalizeSubgraph(n.definitions, n.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(4);
      expect(errors![0]).toStrictEqual(
        nonExternalConditionalFieldError(
          `Query.entity`,
          n.name,
          `NestedObject.age`,
          `object { nestedObject { age name } }`,
          PROVIDES,
        ),
      );
      expect(errors![1]).toStrictEqual(
        nonExternalConditionalFieldError(
          `Query.entity`,
          n.name,
          `NestedObject.name`,
          `object { nestedObject { age name } }`,
          PROVIDES,
        ),
      );
      expect(errors![2]).toStrictEqual(
        nonExternalConditionalFieldError(
          `Query.entities`,
          n.name,
          `NestedObject.age`,
          `object { nestedObject { age name } }`,
          PROVIDES,
        ),
      );
      expect(errors![3]).toStrictEqual(
        nonExternalConditionalFieldError(
          `Query.entities`,
          n.name,
          `NestedObject.name`,
          `object { nestedObject { age name } }`,
          PROVIDES,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a warning is returned if a non-external V1 field is part of both a @provides and @key field set', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(o.definitions, o.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Entity',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        nonExternalConditionalFieldWarning(`Query.entity`, o.name, `Entity.id`, `id`, PROVIDES),
      );
    });

    test('that an error is returned if a non-external V2 field is part of both a @provides and @key field set', () => {
      const { errors, warnings } = normalizeSubgraph(p.definitions, p.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        nonExternalConditionalFieldError(`Query.entity`, p.name, `Entity.id`, `id`, PROVIDES),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a warning is returned if a nested non-external V1 field is part of both a @provides and @key field set', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(t.definitions, t.name);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        nonExternalConditionalFieldWarning(`Query.entity`, t.name, `Object.id`, `object { id }`, PROVIDES),
      );
    });

    // TODO
    test.skip('that provides on Interface is valid', () => {
      const { errors, federationResult } = federateSubgraphs([q, r, s]);
      expect(errors).toBeUndefined();
    });
  });

  describe('Federation tests', () => {
    test('that non-external v1 fields that form part of a @provides field set are treated as non-conditional but return a warning', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([u, v]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        nonExternalConditionalFieldWarning(
          'Query.entity',
          'v',
          'NestedObject.name',
          'object { nestedObject { name } }',
          PROVIDES,
        ),
      );
      const rConfig = federationResult!.subgraphConfigBySubgraphName.get(u.name);
      expect(rConfig).toBeDefined();
      expect(rConfig!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object', 'age']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { id } }',
                },
                {
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { name } }',
                },
                {
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id', 'name']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
      const sConfig = federationResult!.subgraphConfigBySubgraphName.get(v.name);
      expect(sConfig).toBeDefined();
      expect(sConfig!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name', 'object']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id',
                },
                {
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { id } }',
                },
                {
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id object { nestedObject { name } }',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['nestedObject']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
          [
            'NestedObject',
            {
              fieldNames: new Set<string>(['id', 'name']),
              isRootNode: false,
              typeName: 'NestedObject',
            },
          ],
        ]),
      );
    });

    test('that a provided implicit key that is not part of a key generates the correct router configuration', () => {
      const { errors, federationResult } = federateSubgraphs([w, x]);
      expect(errors).toBeUndefined();
      const xConfig = federationResult!.subgraphConfigBySubgraphName.get(x.name);
      expect(xConfig).toBeDefined();
      expect(xConfig!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              provides: [{ fieldName: 'entity', selectionSet: 'id' }],
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['isEntity']),
              externalFieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [
                {
                  conditions: [
                    {
                      fieldCoordinatesPath: ['Query.entity', 'Entity.id'],
                      fieldPath: ['entity', 'id'],
                    },
                  ],
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that a provided implicit key that is part of a key generates the correct router configuration', () => {
      const { errors, federationResult } = federateSubgraphs([w, y]);
      expect(errors).toBeUndefined();
      const yConfig = federationResult!.subgraphConfigBySubgraphName.get(y.name);
      expect(yConfig).toBeDefined();
      expect(yConfig!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              provides: [{ fieldName: 'entity', selectionSet: 'id' }],
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['isEntity']),
              externalFieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [
                {
                  conditions: [
                    {
                      fieldCoordinatesPath: ['Query.entity', 'Entity.id'],
                      fieldPath: ['entity', 'id'],
                    },
                  ],
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that a provided implicit key generates the correct router configuration #1', () => {
      const { errors, federationResult } = federateSubgraphs([z, aa]);
      expect(errors).toBeUndefined();
      const zConfig = federationResult!.subgraphConfigBySubgraphName.get(z.name);
      expect(zConfig).toBeDefined();
      expect(zConfig!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              provides: [{ fieldName: 'entity', selectionSet: 'id' }],
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['object']),
              externalFieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [
                {
                  conditions: [
                    {
                      fieldCoordinatesPath: ['Query.entity', 'Entity.id'],
                      fieldPath: ['entity', 'id'],
                    },
                  ],
                  fieldName: '',
                  selectionSet: 'id',
                },
                {
                  conditions: [
                    {
                      fieldCoordinatesPath: ['Query.entity', 'Entity.id'],
                      fieldPath: ['entity', 'id'],
                    },
                  ],
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id object { object { name } }',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'object']),
              externalFieldNames: new Set<string>(['name']),
              isRootNode: false,
              provides: [
                {
                  fieldName: 'object',
                  selectionSet: 'name',
                },
              ],
              typeName: 'Object',
            },
          ],
        ]),
      );
    });

    test('that a provided implicit key generates the correct router configuration #2', () => {
      const { errors, federationResult } = federateSubgraphs([ab, ac]);
      expect(errors).toBeUndefined();
      const abConfig = federationResult!.subgraphConfigBySubgraphName.get(ab.name);
      expect(abConfig).toBeDefined();
      expect(abConfig!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity', 'entityTwo', 'entityThree']),
              isRootNode: true,
              provides: [
                { fieldName: 'entity', selectionSet: 'id' },
                { fieldName: 'entityTwo', selectionSet: 'id object { name }' },
                { fieldName: 'entityThree', selectionSet: 'id object { name }' },
              ],
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['object']),
              externalFieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [
                {
                  conditions: [
                    {
                      fieldCoordinatesPath: ['Query.entity', 'Entity.id'],
                      fieldPath: ['entity', 'id'],
                    },
                    {
                      fieldCoordinatesPath: ['Query.entityTwo', 'Entity.id'],
                      fieldPath: ['entityTwo', 'id'],
                    },
                    {
                      fieldCoordinatesPath: ['Query.entityThree', 'Entity.id'],
                      fieldPath: ['entityThree', 'id'],
                    },
                  ],
                  fieldName: '',
                  selectionSet: 'id',
                },
                {
                  conditions: [
                    {
                      fieldCoordinatesPath: ['Query.entityTwo', 'Entity.id'],
                      fieldPath: ['entityTwo', 'id'],
                    },
                    {
                      fieldCoordinatesPath: ['Query.entityThree', 'Entity.id'],
                      fieldPath: ['entityThree', 'id'],
                    },
                  ],
                  disableEntityResolver: true,
                  fieldName: '',
                  selectionSet: 'id object { name }',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id', 'object']),
              externalFieldNames: new Set<string>(['name']),
              isRootNode: false,
              typeName: 'Object',
            },
          ],
        ]),
      );
    });

    test('that a warning is returned if an external V1 extension entity key field is provided', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([ad, ae]);
      expect(errors).toBeUndefined();
      const adConfig = federationResult!.subgraphConfigBySubgraphName.get(ad.name);
      expect(adConfig).toBeDefined();
      expect(adConfig!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['entity']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'object']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Entity',
            },
          ],
          [
            'Object',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [
                {
                  fieldName: '',
                  selectionSet: 'id',
                },
              ],
              typeName: 'Object',
            },
          ],
        ]),
      );
      expect(warnings).toHaveLength(3);
      expect(warnings[0]).toStrictEqual(externalEntityExtensionKeyFieldWarning(`Entity`, `id`, [`Entity.id`], ad.name));
      expect(warnings[1]).toStrictEqual(externalEntityExtensionKeyFieldWarning(`Object`, `id`, [`Object.id`], ad.name));
      expect(warnings[2]).toStrictEqual(fieldAlreadyProvidedWarning(`Object.id`, PROVIDES, `Entity.object`, ad.name));
    });

    test('that an error is returned if an external V2 extension entity key field is provided', () => {
      const { errors, warnings } = federateSubgraphs([af, ae]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError(af.name, [
          invalidProvidesOrRequiresDirectivesError(PROVIDES, [
            ` On "Entity.object":\n -` + fieldAlreadyProvidedErrorMessage(`Object.id`, af.name, PROVIDES),
          ]),
        ]),
      );
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toStrictEqual(externalEntityExtensionKeyFieldWarning(`Entity`, `id`, [`Entity.id`], af.name));
      expect(warnings[1]).toStrictEqual(externalEntityExtensionKeyFieldWarning(`Object`, `id`, [`Object.id`], af.name));
    });
  });
});

const a: Subgraph = {
  name: 'a',
  url: '',
  definitions: parse(`
    type Object {
      id: ID! @provides(fields: "name")
    }
  `),
};

const b: Subgraph = {
  name: 'b',
  url: '',
  definitions: parse(`
    type Object {
      entity: Entity! @provides(fields: "... on Entity { name }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String! @external
    }
  `),
};

const c: Subgraph = {
  name: 'c',
  url: '',
  definitions: parse(`
    type Object {
      id: ID!
      entity: Entity! @provides(fields: "... on Interface { name }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    }

    interface Interface {
      name: String!
    }
  `),
};

const d: Subgraph = {
  name: 'd',
  url: '',
  definitions: parse(`
    type Object {
      entity: Entity! @provides(fields: "interface { ... on Interface { ... on Interface { name } } }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      interface: Interface! @external
    }

    interface Interface {
      name: String!
    }

    type Implementation implements Interface {
      name: String!
    }
  `),
};

const e: Subgraph = {
  name: 'e',
  url: '',
  definitions: parse(`
    type Object {
      entity: Entity! @provides(fields: "interface { ... on AnotherObject { name } }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      interface: Interface! @external
    }

    interface Interface {
      name: String!
    }

    type AnotherObject implements Interface {
      name: String!
    }
  `),
};

const f: Subgraph = {
  name: 'f',
  url: '',
  definitions: parse(`
    type Object {
      entity: Entity! @provides(fields: "interface { ... on AnotherObject { name } }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      interface: Interface! @external
    }

    interface Interface {
      name: String!
    }

    type AnotherObject {
      name: String!
    }

    type Implementation implements Interface {
      name: String!
    }
  `),
};

const g: Subgraph = {
  name: 'g',
  url: '',
  definitions: parse(`
    type Object {
      entity: Entity! @provides(fields: "union { ... on AnotherObject { name } }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      union: Union! @external
    }

    union Union = AnotherObject

    type AnotherObject {
      name: String!
    }
  `),
};

const h: Subgraph = {
  name: 'h',
  url: '',
  definitions: parse(`
    type Object {
      entity: Entity! @provides(fields: "union { name }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      union: Union! @external
    }

    union Union = AnotherObject

    type AnotherObject {
      name: String!
    }
  `),
};

const i: Subgraph = {
  name: 'i',
  url: '',
  definitions: parse(`
    type Object {
      entity: Entity! @provides(fields: "union { ... on YetAnotherObject { name } }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      union: Union! @external
    }

    union Union = AnotherObject

    type AnotherObject {
      name: String!
    }

    type YetAnotherObject {
      name: String!
    }
  `),
};

const j: Subgraph = {
  name: 'j',
  url: '',
  definitions: parse(`
    type Object {
      entity: Entity! @provides(fields: "anotherObject { name }")
    }
    type Entity @key(fields: "id") {
      id: ID!
      anotherObject(arg: String): AnotherObject! @external
    }

    type AnotherObject {
      name: String!
    }
  `),
};

const k: Subgraph = {
  name: 'k',
  url: '',
  definitions: parse(`
    type Object {
      entity: Entity! @provides(fields: "anotherObject(arg: \\"string\\") { name }")
    }
    type Entity @key(fields: "id") {
      id: ID!
      anotherObject(arg: String): AnotherObject! @external
    }

    type AnotherObject {
      name: String!
    }
  `),
};

const l: Subgraph = {
  name: 'l',
  url: '',
  definitions: parse(`
    type Query @shareable {
      entity: Entity! @provides(fields: "object { nestedObject { age name } }")
      entities: [Entity!]! @provides(fields: "object { nestedObject { age name } }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      object: Object!
    }

    type Object {
      nestedObject: NestedObject!
    }

    type NestedObject {
      age: Int! @external
      name: String! @external
    }
  `),
};

const m: Subgraph = {
  name: 'm',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }

    type Queries @shareable {
      entity: Entity! @provides(fields: "object { nestedObject { age name } }")
      entities: [Entity!]! @provides(fields: "object { nestedObject { age name } }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      object: Object!
    }

    type Object {
      nestedObject: NestedObject!
    }

    type NestedObject {
      age: Int! @external
      name: String! @external
    }
  `),
};

const n: Subgraph = {
  name: 'n',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }

    type Queries @shareable {
      entity: Entity! @provides(fields: "object { nestedObject { age name } }")
      entities: [Entity!]! @provides(fields: "object { nestedObject { age name } }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      object: Object!
    }

    type Object {
      nestedObject: NestedObject!
    }

    type NestedObject {
      age: Int!
      name: String!
    }
  `),
};

const o: Subgraph = {
  name: 'o',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @provides(fields: "id")
    }
    
    type Entity @key(fields: "id") {
      id: ID!
    }
  `),
};

const p: Subgraph = {
  name: 'p',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @provides(fields: "id") @shareable
    }
    
    type Entity @key(fields: "id") {
      id: ID!
    }
  `),
};

const q: Subgraph = {
  name: 'q',
  url: '',
  definitions: parse(`
    extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.3"
      import: ["@key", "@shareable", "@external", "@provides"]
    )

    type Query {
      media: Media @shareable
      book: Book @provides(fields: "animals { ... on Dog { name } }")
    }

    interface Media {
      id: ID!
    }

    interface Animal {
      id: ID!
    }

    type Book implements Media @key(fields: "id") {
      id: ID!
      animals: [Animal] @shareable
    }

    type Dog implements Animal @key(fields: "id") {
      id: ID! @external
      name: String @external
    }

    type Cat implements Animal @key(fields: "id") {
      id: ID! @external
    }
  `),
};

const r: Subgraph = {
  name: 'r',
  url: '',
  definitions: parse(`
    extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.3"
      import: ["@key", "@shareable", "@provides", "@external"]
    )

    type Query {
      media: Media @shareable @provides(fields: "animals { id name }")
    }

    interface Media {
      id: ID!
      animals: [Animal]
    }

    interface Animal {
      id: ID!
      name: String
    }

    type Book implements Media {
      id: ID! @shareable
      animals: [Animal] @external
    }

    type Dog implements Animal {
      id: ID! @external
      name: String @external
    }

    type Cat implements Animal {
      id: ID! @external
      name: String @external
    }
  `),
};

const s: Subgraph = {
  name: 's',
  url: '',
  definitions: parse(`
    extend schema
    @link(
      url: "https://specs.apollo.dev/federation/v2.3"
      import: ["@key", "@shareable"]
    )

    interface Media {
      id: ID!
      animals: [Animal]
    }

    interface Animal {
      id: ID!
      name: String
    }

    type Book implements Media @key(fields: "id") {
      id: ID!
      animals: [Animal] @shareable
    }

    type Dog implements Animal @key(fields: "id") {
      id: ID!
      name: String @shareable
      age: Int
    }

    type Cat implements Animal @key(fields: "id") {
      id: ID!
      name: String @shareable
      age: Int
    }
  `),
};

const t: Subgraph = {
  name: 't',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @provides(fields: "object { id }")
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      object: Object!
    }

    type Object {
      id: ID!
    }
  `),
};

const u: Subgraph = {
  name: 'u',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id object { nestedObject { id } }") @key(fields: "id object { nestedObject { name } }") {
      id: ID!
      object: Object!
      age: Int!
    }

    type Object {
      nestedObject: NestedObject!
    }

    type NestedObject {
      id: ID!
      name: String!
    }
  `),
};

const v: Subgraph = {
  name: 'v',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }

    type Queries {
      entity: Entity! @provides(fields: "object { nestedObject { name } }")
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String!
      object: Object!
    }

    type Object {
      nestedObject: NestedObject!
    }

    type NestedObject {
      id: ID!
      name: String!
    }
  `),
};

const w: Subgraph = {
  name: 'w',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const x: Subgraph = {
  name: 'x',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @provides(fields: "id")
    }

    type Entity {
      id: ID! @external
      isEntity: Boolean!
    }
  `),
};

const y: Subgraph = {
  name: 'y',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @provides(fields: "id")
    }

    type Entity @key(fields: "id") {
      id: ID! @external
      isEntity: Boolean!
    }
  `),
};

const z: Subgraph = {
  name: 'z',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @provides(fields: "id")
    }

    type Entity @key(fields: "id") {
      id: ID! @external
      object: Object!
    }

    type Object {
      id: ID!
      object: Object! @provides(fields: "name")
      name: String! @external
    }
  `),
};

const aa: Subgraph = {
  name: 'aa',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id object { object { name } }") {
      id: ID!
      object: Object!
      name: String!
    }

    type Object {
      id: ID!
      object: Object!
      name: String!
      age: Int!
    }
  `),
};

const ab: Subgraph = {
  name: 'ab',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @provides(fields: "id")
      entityTwo: Entity! @provides(fields: "id object { name }")
      entityThree: Entity! @provides(fields: "id object { name }")
    }

    type Entity @key(fields: "id") {
      id: ID! @external
      object: Object!
    }

    type Object {
      id: ID!
      object: Object!
      name: String! @external
    }
  `),
};

const ac: Subgraph = {
  name: 'ac',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id object { name }") {
      id: ID!
      object: Object!
      name: String!
    }

    type Object {
      id: ID!
      object: Object!
      name: String!
      age: Int!
    }
  `),
};

const ad: Subgraph = {
  name: 'ad',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }

    extend type Entity @key(fields: "id") {
      id: ID! @external
      object: Object! @provides(fields: "id")
    }

    extend type Object @key(fields: "id") {
      id: ID! @external
    }
  `),
};

const ae: Subgraph = {
  name: 'ae',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      object: Object!
    }

    type Object @key(fields: "id") {
      id: ID!
    }
  `),
};

const af: Subgraph = {
  name: 'af',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @shareable
    }

    extend type Entity @key(fields: "id") {
      id: ID! @external
      object: Object! @provides(fields: "id")
    }

    extend type Object @key(fields: "id") {
      id: ID! @external
    }
  `),
};
