import { describe, expect, test } from 'vitest';
import { RequiredFieldConfiguration } from "@wundergraph/composition";
import { FieldCoordinates, FieldSetCondition, RequiredField } from "@wundergraph/cosmo-connect/dist/node/v1/node_pb";
import { addRequiredFields } from "../src/router-config/graphql-configuration";

describe('Required field set proto generation tests', () => {
  test('that a required field proto message is generated correctly', () => {
    const requiredFieldConfigurations: Array<RequiredFieldConfiguration> = [
      {
        disableEntityResolver: true,
        fieldName: '',
        selectionSet: "a { b { c { d } } }",
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
    expect(requiredFields).toStrictEqual(
      [
        new RequiredField({
          conditions: [
            new FieldSetCondition({
              fieldCoordinatesPath: [
                new FieldCoordinates({
                  fieldName: 'a',
                  typeName: 'Q',
                }),
                new FieldCoordinates({
                  fieldName: 'b',
                  typeName: 'A',
                }),
                new FieldCoordinates({
                  fieldName: 'c',
                  typeName: 'B',
                }),
                new FieldCoordinates({
                  fieldName: 'd',
                  typeName: 'C',
                }),
              ],
              fieldPath: ['a', 'b', 'c', 'd'],
            }),
            new FieldSetCondition({
              fieldCoordinatesPath: [
                new FieldCoordinates({
                  fieldName: 'a',
                  typeName: 'Q',
                }),
                new FieldCoordinates({
                  fieldName: 'c',
                  typeName: 'A',
                }),
                new FieldCoordinates({
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
      ]
    );
  });

  test('that a required field proto message with no conditions is generated correctly', () => {
    const requiredFieldConfigurations: Array<RequiredFieldConfiguration> = [
      {
        disableEntityResolver: true,
        fieldName: '',
        selectionSet: "a { b { c { d } } }",
      },
    ];
    const requiredFields: Array<RequiredField> = [];
    addRequiredFields(requiredFieldConfigurations, requiredFields, 'Q');
    expect(requiredFields).toStrictEqual(
      [
        new RequiredField({
          disableEntityResolver: true,
          fieldName: '',
          selectionSet: 'a { b { c { d } } }',
          typeName: 'Q',
        }),
      ]
    );
  });
});