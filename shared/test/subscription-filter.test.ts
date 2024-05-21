import { describe, expect, test } from 'vitest';
import {
  SubscriptionFieldCondition,
  SubscriptionFilterCondition,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { generateSubscriptionFilterCondition } from '../src/router-config/graphql-configuration';
import { subscriptionFilterCondition } from './testdata/utils';

describe('Subscription filter proto generation tests', () => {
  test('that a proto message is generated correctly', () => {
    const proto = new SubscriptionFilterCondition();
    generateSubscriptionFilterCondition(proto, subscriptionFilterCondition);
    expect(proto).toStrictEqual(
      new SubscriptionFilterCondition({
        and: [
          new SubscriptionFilterCondition({
            not: new SubscriptionFilterCondition({
              or: [
                new SubscriptionFilterCondition({
                  in: new SubscriptionFieldCondition({
                    fieldPath: ['name'],
                    json: `["Jens","Stefan"]`,
                  })
                }),
                new SubscriptionFilterCondition({
                  in: new SubscriptionFieldCondition({
                    fieldPath: ['age'],
                    json: `[11,22]`,
                  }),
                }),
              ],
            }),
          }),
          new SubscriptionFilterCondition({
            and: [
              new SubscriptionFilterCondition({
                not: new SubscriptionFilterCondition({
                  in: new SubscriptionFieldCondition({
                    fieldPath: ['products', 'sku'],
                    json: `["aaa"]`,
                  }),
                }),
              }),
              new SubscriptionFilterCondition({
                in: new SubscriptionFieldCondition({
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