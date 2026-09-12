import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { describe, expect, test, vi } from 'vitest';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { fromJsonString } from '@bufbuild/protobuf';
import { RouterConfigSchema } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { resolve } from 'pathe';
import ComposeCommand from '../../src/commands/router/commands/compose.js';
import { Client } from '../../src/core/client/client.js';
import { FIXTURES_DIR_PATH } from './utils.js';
import { normalizeString } from '../utils.js';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {});
  });

describe('router compose command tests', () => {
  test('that generated router config matches expected snapshot when config splitting is disabled', async () => {
    const client: Client = {
      platform: createClient(PlatformService, mockPlatformTransport()),
    };

    const outputDir = join(tmpdir(), 'router-compose', randomUUID());
    const outputFile = join(outputDir, 'router-config.json');
    const program = new Command();

    program.addCommand(ComposeCommand({ client }));
    await program.parseAsync(['compose', '-i', resolve('./test/testdata/compose.yaml'), '-o', outputFile], {
      from: 'user',
    });

    expect(existsSync(outputFile)).toBe(true);

    // The output file must match the expected snapshot
    const content = await readFile(outputFile, 'utf8');
    await expect(content).toMatchFileSnapshot(join(FIXTURES_DIR_PATH, 'router-compose', `router-config.json.snap`));
  });

  test('that generated router config matches expected snapshot when config splitting is enabled ', async () => {
    const client: Client = {
      platform: createClient(PlatformService, mockPlatformTransport()),
    };

    const outputDir = join(tmpdir(), 'router-compose-split', randomUUID());
    const program = new Command();

    program.addCommand(ComposeCommand({ client }));
    await program.parseAsync(
      ['compose', '-i', resolve('./test/testdata/compose.yaml'), '-o', outputDir, '--split-configs-enabled'],
      {
        from: 'user',
      },
    );

    expect(existsSync(outputDir)).toBe(true);
    expect(existsSync(join(outputDir, 'router-config.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'mapper.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'feature-flags'))).toBe(true);
    expect(existsSync(join(outputDir, 'feature-flags', 'my-feature-flag.json'))).toBe(true);

    // All output files should match the snapshots
    await expectSplitOutputMatchSnapshot(outputDir, 'router-config.json');
    await expectSplitOutputMatchSnapshot(outputDir, 'mapper.json');
    await expectSplitOutputMatchSnapshot(outputDir, join('feature-flags', 'my-feature-flag.json'));
  });
});

async function expectSplitOutputMatchSnapshot(outputDir: string, name: string) {
  const content = await readFile(join(outputDir, name), 'utf8');
  await expect(content).toMatchFileSnapshot(join(FIXTURES_DIR_PATH, 'router-compose', 'split-config', `${name}.snap`));
}

describe('router compose contract tests', () => {
  test('that excluded tags are removed from the client schema of the generated router config', async () => {
    const { clientSchema, routerSchema } = await composeContract(['--exclude', 'internal']);
    expect(normalizeString(clientSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
      
        type Query {
          employees: [Employee!]!
          publicAnnouncements: [Announcement!]!
        }
        
        type Employee {
          id: Int!
          name: String!
        }
        
        type Announcement {
          id: ID!
        }
      `),
    );
    expect(normalizeString(routerSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        type Query {
          employees: [Employee!]!
          internalReports: [Report!]! @tag(name: "internal") @inaccessible
          publicAnnouncements: [Announcement!]! @tag(name: "public")
        }
        
        type Employee {
          id: Int!
          name: String!
          salary: Int! @tag(name: "internal") @inaccessible
        }
        
        type Report @tag(name: "internal") @inaccessible {
          id: ID!
          title: String!
        }
        
        type Announcement @tag(name: "public") {
          id: ID!
          headline: String!  @tag(name: "internal") @inaccessible
        }
      `),
    );
  });

  test('that only included tags remain in the client schema of the generated router config', async () => {
    const { clientSchema, routerSchema } = await composeContract(['--include', 'public']);
    expect(normalizeString(clientSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }

        type Query {
          publicAnnouncements: [Announcement!]!
        }
        
        type Announcement {
          id: ID!
          headline: String!
        }
      `),
    );
    expect(normalizeString(routerSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        type Query {
          employees: [Employee!]! @inaccessible
          internalReports: [Report!]! @tag(name: "internal") @inaccessible
          publicAnnouncements: [Announcement!]! @tag(name: "public")
        }
        
        type Employee @inaccessible {
          id: Int! @inaccessible
          name: String! @inaccessible
          salary: Int! @tag(name: "internal") @inaccessible
        }
        
        type Report @tag(name: "internal") @inaccessible {
          id: ID!
          title: String!
        }
        
        type Announcement @tag(name: "public") {
          id: ID!
          headline: String!  @tag(name: "internal")
        }
      `),
    );
  });

  test('that both including and excluding tags generate the correct schemas', async () => {
    const { clientSchema, routerSchema } = await composeContract(['--include', 'public', '--exclude', 'internal']);
    expect(normalizeString(clientSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }

        type Query {
          publicAnnouncements: [Announcement!]!
        }
        
        type Announcement {
          id: ID!
        }
      `),
    );
    expect(normalizeString(routerSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        type Query {
          employees: [Employee!]! @inaccessible
          internalReports: [Report!]! @tag(name: "internal") @inaccessible
          publicAnnouncements: [Announcement!]! @tag(name: "public")
        }
        
        type Employee @inaccessible {
          id: Int! @inaccessible
          name: String! @inaccessible
          salary: Int! @tag(name: "internal") @inaccessible
        }
        
        type Report @tag(name: "internal") @inaccessible {
          id: ID!
          title: String!
        }
        
        type Announcement @tag(name: "public") {
          id: ID!
          headline: String! @tag(name: "internal") @inaccessible
        }
      `),
    );
  });

  test('that excluded tags are removed from the client schema of a feature flag config', async () => {
    const { clientSchema, routerSchema } = await composeFeatureFlagContract(
      ['--exclude', 'internal', '--contract-feature-flag-names', 'my-feature-flag'],
      'my-feature-flag',
    );
    expect(normalizeString(clientSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        type Query {
          employees: [Employee!]!
          publicAnnouncements: [Announcement!]!
          newFeature: String
        }
        
        type Employee {
          id: Int!
          name: String!
        }
        
        type Announcement {
          id: ID!
          headline: String!
          newFeature: String!
        }
      `),
    );
    expect(normalizeString(routerSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        type Query {
          employees: [Employee!]!
          internalReports: [Report!]! @tag(name: "internal") @inaccessible
          publicAnnouncements: [Announcement!]! @tag(name: "public")
          newFeature: String @tag(name: "experimental")
        }
        
        type Employee {
          id: Int!
          name: String!
          salary: Int! @tag(name: "internal") @inaccessible
        }
        
        type Report @tag(name: "internal") @inaccessible {
          id: ID!
          title: String!
        }
        
        type Announcement @tag(name: "public") @tag(name: "experimental") {
          id: ID!
          headline: String!
          newFeature: String! @tag(name: "experimental")
          secret: String @tag(name: "internal") @inaccessible
        }
      `),
    );
  });

  test('that only included tags remain in the client schema of a feature flag config (enable base contract)', async () => {
    const { clientSchema, routerSchema } = await composeFeatureFlagContract(
      ['--include', 'public', '--contract-feature-flag-names', 'my-feature-flag'],
      'my-feature-flag',
    );
    expect(normalizeString(clientSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        type Query {
          publicAnnouncements: [Announcement!]!
        }
        
        type Announcement {
          id: ID!
          headline: String!
          newFeature: String!
          secret: String
        }
      `),
    );
    expect(normalizeString(routerSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        type Query {
          employees: [Employee!]! @inaccessible
          internalReports: [Report!]! @tag(name: "internal") @inaccessible
          publicAnnouncements: [Announcement!]! @tag(name: "public")
          newFeature: String @tag(name: "experimental") @inaccessible
        }
        
        type Employee @inaccessible {
          id: Int! @inaccessible
          name: String! @inaccessible
          salary: Int! @tag(name: "internal") @inaccessible
        }
        
        type Report @tag(name: "internal") @inaccessible {
          id: ID!
          title: String!
        }
        
        type Announcement @tag(name: "public") @tag(name: "experimental") {
          id: ID!
          headline: String!
          newFeature: String! @tag(name: "experimental")
          secret: String @tag(name: "internal")
        }
      `),
    );
  });

  test('that only included tags remain in the client schema of a feature flag config (disable base contract)', async () => {
    const { clientSchema, routerSchema } = await composeFeatureFlagContract(
      ['--include', 'experimental', '--disable-base-contract', '--contract-feature-flag-names', 'my-feature-flag'],
      'my-feature-flag',
    );
    expect(normalizeString(clientSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        type Query {
          newFeature: String
        }
        
        type Announcement {
          id: ID!
          headline: String!
          newFeature: String!
          secret: String
        }
      `),
    );
    expect(normalizeString(routerSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        type Query {
          employees: [Employee!]! @inaccessible
          internalReports: [Report!]! @tag(name: "internal") @inaccessible
          publicAnnouncements: [Announcement!]! @tag(name: "public") @inaccessible
          newFeature: String @tag(name: "experimental")
        }
        
        type Employee @inaccessible {
          id: Int! @inaccessible
          name: String! @inaccessible
          salary: Int! @tag(name: "internal") @inaccessible
        }
        
        type Report @tag(name: "internal") @inaccessible {
          id: ID!
          title: String!
        }
        
        type Announcement @tag(name: "public") @tag(name: "experimental") {
          id: ID!
          headline: String!
          newFeature: String! @tag(name: "experimental")
          secret: String @tag(name: "internal")
        }
      `),
    );
  });

  test('that both including and excluding tags generate the correct feature flag schemas (enable base contract)', async () => {
    const { clientSchema, routerSchema } = await composeFeatureFlagContract(
      [
        '--exclude',
        'internal',
        '--include',
        'experimental',
        'public',
        '--contract-feature-flag-names',
        'my-feature-flag',
      ],
      'my-feature-flag',
    );
    expect(normalizeString(clientSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        type Query {
          publicAnnouncements: [Announcement!]!
          newFeature: String
        }
        
        type Announcement {
          id: ID!
          headline: String!
          newFeature: String!
        }
      `),
    );
    expect(normalizeString(routerSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        type Query {
          employees: [Employee!]! @inaccessible
          internalReports: [Report!]! @tag(name: "internal") @inaccessible
          publicAnnouncements: [Announcement!]! @tag(name: "public")
          newFeature: String @tag(name: "experimental")
        }
        
        type Employee @inaccessible {
          id: Int! @inaccessible
          name: String! @inaccessible
          salary: Int! @tag(name: "internal") @inaccessible
        }
        
        type Report @tag(name: "internal") @inaccessible {
          id: ID!
          title: String!
        }
        
        type Announcement @tag(name: "public") @tag(name: "experimental") {
          id: ID!
          headline: String!
          newFeature: String! @tag(name: "experimental")
          secret: String @tag(name: "internal") @inaccessible
        }
      `),
    );
  });

  test('that both including and excluding tags generate the correct feature flag schemas (disable base contract)', async () => {
    const { clientSchema, routerSchema } = await composeFeatureFlagContract(
      [
        '--exclude',
        'internal',
        '--include',
        'experimental',
        'public',
        '--disable-base-contract',
        '--contract-feature-flag-names',
        'my-feature-flag',
      ],
      'my-feature-flag',
    );
    expect(normalizeString(clientSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        type Query {
          publicAnnouncements: [Announcement!]!
          newFeature: String
        }
        
        type Announcement {
          id: ID!
          headline: String!
          newFeature: String!
        }
      `),
    );
    expect(normalizeString(routerSchema)).toBe(
      normalizeString(`
        schema {
          query: Query
        }
        
        directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        type Query {
          employees: [Employee!]! @inaccessible
          internalReports: [Report!]! @tag(name: "internal") @inaccessible
          publicAnnouncements: [Announcement!]! @tag(name: "public")
          newFeature: String @tag(name: "experimental")
        }
        
        type Employee @inaccessible {
          id: Int! @inaccessible
          name: String! @inaccessible
          salary: Int! @tag(name: "internal") @inaccessible
        }
        
        type Report @tag(name: "internal") @inaccessible {
          id: ID!
          title: String!
        }
        
        type Announcement @tag(name: "public") @tag(name: "experimental") {
          id: ID!
          headline: String!
          newFeature: String! @tag(name: "experimental")
          secret: String @tag(name: "internal") @inaccessible
        }
      `),
    );
  });

  test('that the router config remains the only stdout output when no destination file is provided', async () => {
    const client: Client = {
      platform: createClient(PlatformService, mockPlatformTransport()),
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const program = new Command();
      program.addCommand(ComposeCommand({ client }));
      await program.parseAsync(
        ['compose', '-i', resolve('./test/testdata/compose-contract.yaml'), '--exclude', 'internal'],
        { from: 'user' },
      );

      const stdout = logSpy.mock.calls.flat().join('\n');
      const routerConfig = fromJsonString(RouterConfigSchema, stdout);
      expect(routerConfig.engineConfig?.graphqlClientSchema).not.toContain('internalReports');
    } finally {
      logSpy.mockRestore();
    }
  });

  test('that an exclude tag option without any tags is rejected', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const writeErrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await expect(composeContract(['--exclude'])).rejects.toThrow('process.exit');
      expect(writeErrSpy.mock.calls.flat().join('')).toMatch(/requires at least one tag/i);
    } finally {
      writeErrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test('that an include tag option without any tags is rejected', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const writeErrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await expect(composeContract(['--include'])).rejects.toThrow('process.exit');
      expect(writeErrSpy.mock.calls.flat().join('')).toMatch(/requires at least one tag/i);
    } finally {
      writeErrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test('that a contract-feature-flag-names option without any names is rejected', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const writeErrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await expect(composeContract(['--exclude', 'internal', '--contract-feature-flag-names'])).rejects.toThrow(
        'process.exit',
      );
      expect(writeErrSpy.mock.calls.flat().join('')).toMatch(/requires at least one feature flag name/i);
    } finally {
      writeErrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test('that a disable-base-contract option without tags is rejected', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const writeErrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await expect(composeContract(['--disable-base-contract'])).rejects.toThrow('process.exit');
      expect(writeErrSpy.mock.calls.flat().join('')).toMatch(/requires at least one included or excluded tag/i);
    } finally {
      writeErrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test('that a contract-feature-flag-names option without tags is rejected', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const writeErrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await expect(composeContract(['--contract-feature-flag-names', 'my-feature-flag'])).rejects.toThrow(
        'process.exit',
      );
      expect(writeErrSpy.mock.calls.flat().join('')).toMatch(/requires at least one included or excluded tag/i);
    } finally {
      writeErrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test('that a blank exclude tag is rejected', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const writeErrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await expect(composeContract(['--exclude', ' '])).rejects.toThrow('process.exit');
      expect(writeErrSpy.mock.calls.flat().join('')).toMatch(/tag/i);
    } finally {
      writeErrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test('that a blank include tag is rejected', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const writeErrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await expect(composeContract(['--include', ' '])).rejects.toThrow('process.exit');
      expect(writeErrSpy.mock.calls.flat().join('')).toMatch(/tag/i);
    } finally {
      writeErrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

type Schemas = {
  clientSchema: string;
  routerSchema: string;
};

async function composeContract(args: string[]): Promise<Schemas> {
  const routerConfig = await composeContractRouterConfig(args);
  return {
    clientSchema: routerConfig.engineConfig?.graphqlClientSchema ?? '',
    routerSchema: routerConfig.engineConfig?.graphqlSchema ?? '',
  };
}

async function composeFeatureFlagContract(args: string[], featureFlagName: string): Promise<Schemas> {
  const routerConfig = await composeContractRouterConfig(args);
  const featureFlagConfig = routerConfig.featureFlagConfigs?.configByFeatureFlagName[featureFlagName];
  expect(featureFlagConfig).toBeDefined();
  return {
    clientSchema: featureFlagConfig!.engineConfig?.graphqlClientSchema ?? '',
    routerSchema: featureFlagConfig!.engineConfig?.graphqlSchema ?? '',
  };
}

async function composeContractRouterConfig(args: string[]) {
  const client: Client = {
    platform: createClient(PlatformService, mockPlatformTransport()),
  };

  const outputFile = join(tmpdir(), 'router-compose-contract', randomUUID(), 'router-config.json');
  const program = new Command();

  program.addCommand(ComposeCommand({ client }));
  await program.parseAsync(
    ['compose', '-i', resolve('./test/testdata/compose-contract.yaml'), '-o', outputFile, ...args],
    { from: 'user' },
  );

  return fromJsonString(RouterConfigSchema, await readFile(outputFile, 'utf8'));
}
