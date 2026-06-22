import { describe, expect, test } from 'vitest';
import {
  DIRECTIVE_DEFINITION_BY_NAME,
  FIRST_ORDINAL,
  invalidDirectiveError,
  invalidRepeatedDirectiveErrorMessage,
  OPENFED_REQUEST_SCOPED,
  OPENFED_REQUEST_SCOPED_DEFINITION,
  requestScopedSingleFieldWarning,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  undefinedRequiredArgumentsErrorMessage,
} from '../../../src';
import { createSubgraphWithDefaultName, normalizeSubgraphFailure, normalizeSubgraphSuccess } from '../../utils/utils';

describe('@openfed__requestScoped', () => {
  describe('registry', () => {
    test('the directive is materialized in the normalized subgraph output', () => {
      const { directiveDefinitionByName } = normalizeSubgraphSuccess(
        createSubgraphWithDefaultName(`
          type Query {
            me: User @openfed__requestScoped(key: "u")
            viewer: User @openfed__requestScoped(key: "u")
          }
          type User @key(fields: "id") {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(directiveDefinitionByName.has(OPENFED_REQUEST_SCOPED)).toBe(true);
      expect(directiveDefinitionByName.get(OPENFED_REQUEST_SCOPED)).toBe(OPENFED_REQUEST_SCOPED_DEFINITION);
    });
  });

  describe('configuration extraction', () => {
    test('≥ 2 fields sharing the same key produce a subgraph-prefixed l1Key and no warning', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefaultName(`
          type Query {
            me: User @openfed__requestScoped(key: "me")
            viewer: User @openfed__requestScoped(key: "me")
          }
          type User @key(fields: "id") {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const config = result.configurationDataByTypeName.get('Query');
      expect(config!.entityCaching?.requestScopedConfigurations).toBeDefined();
      expect(config!.entityCaching?.requestScopedConfigurations).toHaveLength(2);
      expect(config!.entityCaching!.requestScopedConfigurations!.map((f) => f.l1Key)).toEqual([
        'subgraph-default-a.me',
        'subgraph-default-a.me',
      ]);
      expect(result.warnings).toHaveLength(0);
    });

    test('works on a non-entity object type field', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefaultName(`
          type Query {
            currentLocale: String @openfed__requestScoped(key: "locale")
            articleLocale: String @openfed__requestScoped(key: "locale")
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const config = result.configurationDataByTypeName.get('Query');
      expect(config!.entityCaching?.requestScopedConfigurations).toBeDefined();
      expect(config!.entityCaching?.requestScopedConfigurations).toHaveLength(2);
      expect(config!.entityCaching!.requestScopedConfigurations![0].fieldName).toBe('currentLocale');
      expect(config!.entityCaching!.requestScopedConfigurations![0].l1Key).toBe('subgraph-default-a.locale');
    });

    test('a key declared on only one field still populates config but emits a warning', () => {
      const result = normalizeSubgraphSuccess(
        createSubgraphWithDefaultName(`
          type Query {
            currentUser: User @openfed__requestScoped(key: "lonely")
          }
          type User @key(fields: "id") {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const config = result.configurationDataByTypeName.get('Query');
      expect(config!.entityCaching?.requestScopedConfigurations).toHaveLength(1);
      expect(config!.entityCaching!.requestScopedConfigurations![0].l1Key).toBe('subgraph-default-a.lonely');
      expect(result.warnings).toStrictEqual([
        requestScopedSingleFieldWarning({
          subgraphName: 'subgraph-default-a',
          key: 'lonely',
          fieldCoords: 'Query.currentUser',
        }),
      ]);
    });
  });

  describe('validation', () => {
    test('missing key argument is a failure', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            currentUser: User @openfed__requestScoped
          }
          type User @key(fields: "id") {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_REQUEST_SCOPED, 'Query.currentUser', FIRST_ORDINAL, [
          undefinedRequiredArgumentsErrorMessage(OPENFED_REQUEST_SCOPED, ['key'], []),
        ]),
      );
    });

    test('the directive is not repeatable — two on the same field fails', () => {
      const { errors } = normalizeSubgraphFailure(
        createSubgraphWithDefaultName(`
          type Query {
            currentUser: User @openfed__requestScoped(key: "a") @openfed__requestScoped(key: "b")
          }
          type User @key(fields: "id") {
            id: ID!
          }
        `),
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OPENFED_REQUEST_SCOPED, 'Query.currentUser', FIRST_ORDINAL, [
          invalidRepeatedDirectiveErrorMessage(OPENFED_REQUEST_SCOPED),
        ]),
      );
    });
  });
});
