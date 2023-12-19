import { describe, expect, test } from 'vitest';
import { ConfigurationData, normalizeSubgraphFromString } from '../src';

describe('HTTP Configuration tests', () => {
  test('that HTTP directives are correctly parsed', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(subgraphA);
    expect(errors).toBeUndefined();
    expect(normalizationResult).toBeDefined();
    const configurationDataMap = normalizationResult!.configurationDataMap;
    expect(configurationDataMap).toStrictEqual(
      new Map<string, ConfigurationData>([
        [
          'Query',
          {
            fieldNames: new Set<string>(['hello']),
            isRootNode: true,
            typeName: 'Query',
            httpConfiguration: {
              endpoint: 'https://example.com',
            },
            httpOperations: [
              {
                fieldName: 'hello',
                httpMethod: 'GET',
                path: '/hello',
                operationSpecificHeaders: {
                  accept: 'application/json',
                },
              },
            ],
          },
        ],
      ]),
    );
  });
});

const subgraphA = `
  scalar ObjMap

  enum HTTPMethod {
    GET
    HEAD
    POST
    PUT
    DELETE
    CONNECT
    OPTIONS
    TRACE
    PATCH
  }  
  
  directive @globalOptions(sourceName: String, endpoint: String, operationHeaders: ObjMap, queryStringOptions: ObjMap, queryParams: ObjMap) on OBJECT

  directive @httpOperation(path: String, operationSpecificHeaders: ObjMap, httpMethod: HTTPMethod, isBinary: Boolean, requestBaseBody: ObjMap, queryParamArgMap: ObjMap, queryStringOptionsByParam: ObjMap) on FIELD_DEFINITION

  type Query @globalOptions(endpoint: "https://example.com") {
    hello(who: String!): String @httpOperation(path: "/hello", operationSpecificHeaders: "{\\"accept\\":\\"application/json\\"}", httpMethod: GET)
  }
`;
