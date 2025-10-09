import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';

export class SubgraphCheckExtensionsRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  async getNamespaceConfig(namespaceId: string) {
    const configs = await this.db
      .select()
      .from(schema.namespaceSubgraphCheckExtensionConfig)
      .where(eq(schema.namespaceSubgraphCheckExtensionConfig.namespaceId, namespaceId))
      .execute();

    const config = configs[0];
    return {
      endpoint: config?.endpoint ?? '',
      secretKey: config?.secretKey ?? '',
      includeComposedSdl: config?.includeComposedSdl ?? false,
      includeLintingIssues: config?.includeLintingIssues ?? false,
      includePruningIssues: config?.includePruningIssues ?? false,
      includeSchemaChanges: config?.includeSchemaChanges ?? false,
      includeAffectedOperations: config?.includeAffectedOperations ?? false,
    };
  }

  updateNamespaceConfig({
    namespaceId,
    ...input
  }: {
    namespaceId: string;
    endpoint: string;
    secretKey: string | undefined;
    includeComposedSdl: boolean;
    includeLintingIssues: boolean;
    includePruningIssues: boolean;
    includeSchemaChanges: boolean;
    includeAffectedOperations: boolean;
  }) {
    return this.db
      .insert(schema.namespaceSubgraphCheckExtensionConfig)
      .values([{ namespaceId, ...input }])
      .onConflictDoUpdate({
        target: schema.namespaceSubgraphCheckExtensionConfig.namespaceId,
        set: input,
      })
      .execute();
  }

  deleteNamespaceConfig(namespaceId: string) {
    return this.db
      .delete(schema.namespaceSubgraphCheckExtensionConfig)
      .where(eq(schema.namespaceSubgraphCheckExtensionConfig.namespaceId, namespaceId))
      .execute();
  }
}
