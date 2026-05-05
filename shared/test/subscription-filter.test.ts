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
                  }),
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

  test('that bypassIfValuesNull: true is emitted on the proto IN condition', () => {
    const proto = new SubscriptionFilterCondition();
    generateSubscriptionFilterCondition(proto, {
      in: {
        bypassIfValuesNull: true,
        fieldPath: ['id'],
        values: ['1'],
      },
    });
    expect(proto).toStrictEqual(
      new SubscriptionFilterCondition({
        in: new SubscriptionFieldCondition({
          bypassIfValuesNull: true,
          fieldPath: ['id'],
          json: `["1"]`,
        }),
      }),
    );
  });

  test('that an undefined bypassIfValuesNull leaves the proto field unset', () => {
    const proto = new SubscriptionFilterCondition();
    generateSubscriptionFilterCondition(proto, {
      in: {
        fieldPath: ['id'],
        values: ['1'],
      },
    });
    expect(proto).toStrictEqual(
      new SubscriptionFilterCondition({
        in: new SubscriptionFieldCondition({
          fieldPath: ['id'],
          json: `["1"]`,
        }),
      }),
    );
    expect(proto.in?.bypassIfValuesNull).toBeUndefined();
  });

  test('that bypassIfValuesNull: false leaves the proto field unset', () => {
    const proto = new SubscriptionFilterCondition();
    generateSubscriptionFilterCondition(proto, {
      in: {
        bypassIfValuesNull: false,
        fieldPath: ['id'],
        values: ['1'],
      },
    });
    expect(proto).toStrictEqual(
      new SubscriptionFilterCondition({
        in: new SubscriptionFieldCondition({
          fieldPath: ['id'],
          json: `["1"]`,
        }),
      }),
    );
    expect(proto.in?.bypassIfValuesNull).toBeUndefined();
  });

  test('that bypassIfValuesNull is propagated through nested OR conditions', () => {
    const proto = new SubscriptionFilterCondition();
    generateSubscriptionFilterCondition(proto, {
      or: [
        { in: { bypassIfValuesNull: true, fieldPath: ['id'], values: ['1'] } },
        { in: { fieldPath: ['id'], values: ['2'] } },
      ],
    });
    expect(proto).toStrictEqual(
      new SubscriptionFilterCondition({
        or: [
          new SubscriptionFilterCondition({
            in: new SubscriptionFieldCondition({
              bypassIfValuesNull: true,
              fieldPath: ['id'],
              json: `["1"]`,
            }),
          }),
          new SubscriptionFilterCondition({
            in: new SubscriptionFieldCondition({
              fieldPath: ['id'],
              json: `["2"]`,
            }),
          }),
        ],
      }),
    );
  });
});
