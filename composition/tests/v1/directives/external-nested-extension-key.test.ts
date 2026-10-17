import { describe, expect, test } from 'vitest';
import { type ConfigurationData, parse, ROUTER_COMPATIBILITY_VERSION_ONE, type Subgraph } from '../../../src';
import { federateSubgraphsSuccess } from '../../utils/utils';

/*
 * A nested key field of an entity extension is marked unconditionally provided,
 * even when the field is declared @external on its own type.
 *
 * In the subgraph "analytics" below, the extension types "Post" and "Profile" select
 * "account { id }" in their keys. "Account" is a separate entity of the same subgraph with its
 * own key "internalId", and it declares "id" as @external.
 * The subgraph can return "Account.id" only when "Account" arrives as "Post.account" or
 * "Profile.account", because the parent key carries the value.
 * When "Account" is resolved through its own key "internalId", the subgraph has no "id".
 *
 * Today the configuration data of "analytics" lists "id" in "fieldNames" and adds an implicit
 * key "id" without conditions. The planner then fetches "id" from "analytics" after a "internalId"
 * key jump.
 *
 * The expected configuration keeps "id" in "externalFieldNames" and adds the implicit key "id"
 * with one condition per key path that provides it.
 *
 * Proposed fix, in NormalizationFactory.evaluateExternalKeyFields
 * (src/v1/normalization/normalization-factory.ts):
 * track the field path while visiting a key field set, and for a nested external key field whose
 * parent type is itself an entity of the subgraph, record a "providedBy" condition instead of
 * marking the field unconditionally provided. A parent type that is not an entity keeps the
 * current behaviour, because it is reachable only through that key path.
 *
 *   const fieldCoordsPath: Array<string> = [];
 *   const fieldPath: Array<string> = [];
 *   visit(keyFieldSetData.documentNode, {
 *     Field: {
 *       leave() {
 *         fieldCoordsPath.pop();
 *         fieldPath.pop();
 *       },
 *       enter(node) {
 *         ...
 *         const fieldCoords = `${parentTypeName}.${fieldName}`;
 *         fieldCoordsPath.push(fieldCoords);
 *         fieldPath.push(fieldName);
 *         ...
 *         if (entityParentData.extensionType !== ExtensionType.NONE) {
 *           if (currentDepth > 0 && nf.keyFieldSetDatasByTypeName.has(parentTypeName)) {
 *             getValueOrDefault(nf.conditionalFieldDataByCoords, fieldCoords, newConditionalFieldData).providedBy.push(
 *               newFieldSetConditionData({
 *                 fieldCoordinatesPath: [...fieldCoordsPath],
 *                 fieldPath: [...fieldPath],
 *               }),
 *             );
 *           } else {
 *             externalFieldData.isUnconditionallyProvided = true;
 *             // existing warning bookkeeping unchanged
 *           }
 *         }
 *
 * With that change, validateImplicitFieldSets picks up the conditions from
 * conditionalFieldDataByCoords, and addFieldNamesToConfigurationData keeps "id" external.
 */
describe('nested @external key field of an entity extension', () => {
  test('that a nested external key field of an extension stays external on its own entity and gets a conditional implicit key', () => {
    const { subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [analytics, accounts, social, listings],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    const analyticsConfig = subgraphConfigBySubgraphName.get(analytics.name);
    expect(analyticsConfig).toBeDefined();
    expect(analyticsConfig!.configurationDataByTypeName.get('Account')).toStrictEqual<ConfigurationData>({
      externalFieldNames: new Set<string>(['id', 'internalId']),
      fieldNames: new Set<string>(['isActive']),
      isRootNode: true,
      keys: [
        {
          fieldName: '',
          selectionSet: 'internalId',
        },
        {
          fieldName: '',
          selectionSet: 'id',
          conditions: [
            {
              fieldCoordinatesPath: ['Post.account', 'Account.id'],
              fieldPath: ['account', 'id'],
            },
            {
              fieldCoordinatesPath: ['Profile.account', 'Account.id'],
              fieldPath: ['account', 'id'],
            },
          ],
          disableEntityResolver: true,
        },
      ],
      typeName: 'Account',
    });
  });
});

// The subgraph with the nested external key field.
// "Account" has its own resolvable key, and two extension types select "account { id }" in their keys.
const analytics: Subgraph = {
  name: 'analytics',
  url: '',
  definitions: parse(`
    type Account @key(fields: "internalId", resolvable: true) {
      id: ID! @external
      isActive: Boolean
      internalId: String @external
    }

    type Post @extends @key(fields: "account { id } id", resolvable: true) {
      id: ID! @external
      stats: String
      account: Account! @external
    }

    type Profile @extends @key(fields: "account { id }", resolvable: true) {
      stats: String @requires(fields: "account { internalId }")
      postCount: Int! @requires(fields: "account { internalId }")
      account: Account! @external
    }
  `),
};

// The subgraph that owns "Account.id" and the base definitions of the extension types.
const accounts: Subgraph = {
  name: 'accounts',
  url: '',
  definitions: parse(`
    type Query {
      account: Account
      post: Post
      profile: Profile
    }

    type Account @key(fields: "internalId") @key(fields: "id") {
      id: ID!
      internalId: String
      name: String
    }

    type Post @key(fields: "account { id } id") {
      id: ID!
      account: Account!
    }

    type Profile @key(fields: "account { id }") {
      account: Account!
    }
  `),
};

// A subgraph that needs the "Account" key "id" and requires "internalId".
const social: Subgraph = {
  name: 'social',
  url: '',
  definitions: parse(`
    type Account @key(fields: "id") {
      id: ID!
      internalId: String @external
      avatarUrl: String @requires(fields: "internalId")
    }
  `),
};

// A subgraph that returns "Account" with only "internalId", so every other field needs a key jump.
const listings: Subgraph = {
  name: 'listings',
  url: '',
  definitions: parse(`
    type Query {
      author: Account
    }

    type Account @key(fields: "internalId", resolvable: false) {
      internalId: String
    }
  `),
};
