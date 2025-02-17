import { describe, expect, test } from 'vitest';
import { EDFS_ARGS_REGEXP } from '../../src';

describe('regular expressions tests', () => {
  test('that EDFS_ARGS_REGEXP validate correctly', () => {
    const checks = [
      {
        value: '{{ args.name }}',
        expected: [['{{ args.name }}', 'name']],
      },
      {
        value: '{{ args.name     }}',
        expected: [['{{ args.name     }}', 'name']],
      },
      {
        value: '{{      args.name     }}',
        expected: [['{{      args.name     }}', 'name']],
      },
      {
        value: '{{args.name}}',
        expected: [['{{args.name}}', 'name']],
      },
      {
        value: '{{          args.name}}',
        expected: [['{{          args.name}}', 'name']],
      },
      {
        value: '{{ args.name }}{{ args.id }}',
        expected: [
          ['{{ args.name }}', 'name'],
          ['{{ args.id }}', 'id'],
        ],
      },
      {
        value: '{{  args.name }}  {{ args.id  }}',
        expected: [
          ['{{  args.name }}', 'name'],
          ['{{ args.id  }}', 'id'],
        ],
      },
      {
        value: '{{ arg.name }}',
        expected: [],
      },
      {
        value: '{{ arg.name }}',
        expected: [],
      },
      {
        value: '{{ arg.name }}{{ args.name2 }}',
        expected: [['{{ args.name2 }}', 'name2']],
      },
      {
        value: '{{ }}',
        expected: [],
      },
      {
        value: '{{',
        expected: [],
      },
      {
        value: '}}',
        expected: [],
      },
    ];

    for (const check of checks) {
      const matches = Array.from(check.value.matchAll(EDFS_ARGS_REGEXP));
      expect(matches.map((match) => [match[0], match[1]])).toEqual(check.expected);
    }
  });
});
