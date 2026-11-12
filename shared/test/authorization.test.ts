import { describe, expect, test } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  AuthorizationConfigurationSchema,
  PoliciesSchema,
  ScopesSchema,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { generateFieldConfigurations } from '../src/router-config/graphql-configuration';

describe('Authorization configuration proto generation tests', () => {
  test('that required scopes require authentication', () => {
    const fieldConfigurations = generateFieldConfigurations([
      {
        argumentNames: [],
        typeName: 'Query',
        fieldName: 'secret',
        requiredScopes: [['a', 'b'], ['c']],
        requiredScopesByOR: [['a', 'b'], ['c']],
      },
    ]);
    expect(fieldConfigurations).toHaveLength(1);
    expect(fieldConfigurations[0].authorizationConfiguration).toStrictEqual(
      create(AuthorizationConfigurationSchema, {
        requiresAuthentication: true,
        requiredOrScopes: [
          create(ScopesSchema, { requiredAndScopes: ['a', 'b'] }),
          create(ScopesSchema, { requiredAndScopes: ['c'] }),
        ],
        requiredOrScopesByOr: [
          create(ScopesSchema, { requiredAndScopes: ['a', 'b'] }),
          create(ScopesSchema, { requiredAndScopes: ['c'] }),
        ],
      }),
    );
  });

  test('that required policies do not require authentication', () => {
    const fieldConfigurations = generateFieldConfigurations([
      {
        argumentNames: [],
        typeName: 'Query',
        fieldName: 'secret',
        requiredPolicies: [['a', 'b'], ['c']],
      },
    ]);
    expect(fieldConfigurations).toHaveLength(1);
    expect(fieldConfigurations[0].authorizationConfiguration).toStrictEqual(
      create(AuthorizationConfigurationSchema, {
        requiresAuthentication: false,
        requiredOrPolicies: [
          create(PoliciesSchema, { requiredAndPolicies: ['a', 'b'] }),
          create(PoliciesSchema, { requiredAndPolicies: ['c'] }),
        ],
      }),
    );
  });
});
