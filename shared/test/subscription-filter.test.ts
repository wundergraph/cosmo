import { describe, expect, test } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  SubscriptionFieldConditionSchema,
  SubscriptionFilterConditionSchema,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { generateSubscriptionFilterCondition } from '../src/router-config/graphql-configuration';
import { subscriptionFilterCondition } from './testdata/utils';

describe('Subscription filter proto generation tests', () => {
  test('that a proto message is generated correctly', () => {
    const proto = create(SubscriptionFilterConditionSchema);
    generateSubscriptionFilterCondition(proto, subscriptionFilterCondition);
    expect(proto).toStrictEqual(
      create(SubscriptionFilterConditionSchema, {
        and: [
          create(SubscriptionFilterConditionSchema, {
            not: create(SubscriptionFilterConditionSchema, {
              or: [
                create(SubscriptionFilterConditionSchema, {
                  in: create(SubscriptionFieldConditionSchema, {
                    fieldPath: ['name'],
                    json: `["Jens","Stefan"]`,
                  }),
                }),
                create(SubscriptionFilterConditionSchema, {
                  in: create(SubscriptionFieldConditionSchema, {
                    fieldPath: ['age'],
                    json: `[11,22]`,
                  }),
                }),
              ],
            }),
          }),
          create(SubscriptionFilterConditionSchema, {
            and: [
              create(SubscriptionFilterConditionSchema, {
                not: create(SubscriptionFilterConditionSchema, {
                  in: create(SubscriptionFieldConditionSchema, {
                    fieldPath: ['products', 'sku'],
                    json: `["aaa"]`,
                  }),
                }),
              }),
              create(SubscriptionFilterConditionSchema, {
                in: create(SubscriptionFieldConditionSchema, {
                  fieldPath: ['products', 'continent'],
                  json: `["N/A"]`,
                }),
              }),
            ],
          }),
        ],
      }),
    );
  });
});
