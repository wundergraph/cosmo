import { describe, expect, test } from 'vitest';
import { toJson } from '@bufbuild/protobuf';
import { ContextProviderSchema } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { normalizeSubgraphFromString } from '@wundergraph/composition';
import { buildRouterConfig, Input, SubgraphKind } from '../src';

describe('Router compatibility version tests', () => {
  test('that an invalid router compatibility version throws an error', () => {
    const input = {
      routerCompatibilityVersion: '2',
    } as Input;
    expect(() => buildRouterConfig(input)).toThrowError('Invalid router compatibility version "2".');
  });

  test('serializes contextual datasource metadata at compatibility version 1', () => {
    const sdl = `
      type Query { member: Member }
      interface Account @context(name: "account") { plan: String }
      type Member implements Account @context(name: "member") { plan: String, wallet: Wallet }
      type Wallet @key(fields: "id") { id: ID!, quote(plan: String @fromContext(field: "$member { plan }")): String }
    `;
    const result = normalizeSubgraphFromString({ sdlString: sdl, version: '1' });
    if (!result.success) {
      throw result.errors[0];
    }
    const config = buildRouterConfig({
      federatedClientSDL: '',
      federatedSDL: '',
      fieldConfigurations: [],
      routerCompatibilityVersion: '1',
      schemaVersionId: 'test',
      subgraphs: [
        {
          kind: SubgraphKind.Standard,
          id: '1',
          name: 'wallets',
          sdl,
          url: 'http://wallets/graphql',
          subscriptionUrl: '',
          schema: result.schema,
          configurationDataByTypeName: result.configurationDataByTypeName,
        },
      ],
    });
    expect(config.compatibilityVersion.split(':')[0]).toBe('1');
    const datasource = config.engineConfig!.datasourceConfigurations[0];
    expect(datasource.contextProviders.map((provider) => toJson(ContextProviderSchema, provider))).toEqual([
      { contextName: 'account', abstract: { typeName: 'Account', concreteTypeNames: ['Member'] } },
      { contextName: 'member', concrete: { typeName: 'Member' } },
    ]);
    expect(datasource.contextArguments.map((argument) => argument.contextSelection.trim())).toEqual(['{\n  plan\n}']);
  });

  test('that "1" is a valid router compatibility version', () => {
    const input = {
      routerCompatibilityVersion: '1',
      subgraphs: [{}],
    } as Input;
    expect(() => buildRouterConfig(input)).toThrowError(
      'Normalization failed to return a ConfigurationDataByTypeName.',
    );
  });
});
