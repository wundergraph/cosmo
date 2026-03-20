import { describe, expect, test } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { RequiredFieldConfiguration } from '@wundergraph/composition';
import { FieldCoordinatesSchema, FieldSetConditionSchema, RequiredFieldSchema } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import type { FieldCoordinates, FieldSetCondition, RequiredField } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { addRequiredFields } from '../src/router-config/graphql-configuration';

describe('Required field set proto generation tests', () => {
  test('that a required field proto message is generated correctly', () => {
    const requiredFieldConfigurations: Array<RequiredFieldConfiguration> = [
      {
        disableEntityResolver: true,
        fieldName: '',
        selectionSet: 'a { b { c { d } } }',
        conditions: [
          {
            fieldCoordinatesPath: ['Q.a', 'A.b', 'B.c', 'C.d'],
            fieldPath: ['a', 'b', 'c', 'd'],
          },
          {
            fieldCoordinatesPath: ['Q.a', 'A.c', 'C.d'],
            fieldPath: ['a', 'c', 'd'],
          },
        ],
      },
    ];
    const requiredFields: Array<RequiredField> = [];
    addRequiredFields(requiredFieldConfigurations, requiredFields, 'Q');
    expect(requiredFields).toStrictEqual([
      create(RequiredFieldSchema, {
        conditions: [
          create(FieldSetConditionSchema, {
            fieldCoordinatesPath: [
              create(FieldCoordinatesSchema, {
                fieldName: 'a',
                typeName: 'Q',
              }),
              create(FieldCoordinatesSchema, {
                fieldName: 'b',
                typeName: 'A',
              }),
              create(FieldCoordinatesSchema, {
                fieldName: 'c',
                typeName: 'B',
              }),
              create(FieldCoordinatesSchema, {
                fieldName: 'd',
                typeName: 'C',
              }),
            ],
            fieldPath: ['a', 'b', 'c', 'd'],
          }),
          create(FieldSetConditionSchema, {
            fieldCoordinatesPath: [
              create(FieldCoordinatesSchema, {
                fieldName: 'a',
                typeName: 'Q',
              }),
              create(FieldCoordinatesSchema, {
                fieldName: 'c',
                typeName: 'A',
              }),
              create(FieldCoordinatesSchema, {
                fieldName: 'd',
                typeName: 'C',
              }),
            ],
            fieldPath: ['a', 'c', 'd'],
          }),
        ],
        disableEntityResolver: true,
        fieldName: '',
        selectionSet: 'a { b { c { d } } }',
        typeName: 'Q',
      }),
    ]);
  });

  test('that a required field proto message with no conditions is generated correctly', () => {
    const requiredFieldConfigurations: Array<RequiredFieldConfiguration> = [
      {
        disableEntityResolver: true,
        fieldName: '',
        selectionSet: 'a { b { c { d } } }',
      },
    ];
    const requiredFields: Array<RequiredField> = [];
    addRequiredFields(requiredFieldConfigurations, requiredFields, 'Q');
    expect(requiredFields).toStrictEqual([
      create(RequiredFieldSchema, {
        disableEntityResolver: true,
        fieldName: '',
        selectionSet: 'a { b { c { d } } }',
        typeName: 'Q',
      }),
    ]);
  });
});
