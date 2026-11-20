import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import type { HubAiSettingsDTO } from '../../types/index.js';
import { traced } from '../tracing.js';

/** The Hub AI settings Cosmo manages per organization. No row means Hub admins keep them in Hub. */
@traced
export class HubAiSettingsRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async byOrganization(organizationId: string): Promise<HubAiSettingsDTO | undefined> {
    const [row] = await this.db
      .select({ settings: schema.hubAiSettings.settings })
      .from(schema.hubAiSettings)
      .where(eq(schema.hubAiSettings.organizationId, organizationId))
      .limit(1);

    return row?.settings;
  }

  public async set(organizationId: string, settings: HubAiSettingsDTO): Promise<void> {
    await this.db
      .insert(schema.hubAiSettings)
      .values({ organizationId, settings })
      .onConflictDoUpdate({
        target: schema.hubAiSettings.organizationId,
        set: { settings, updatedAt: new Date() },
      });
  }

  public async remove(organizationId: string): Promise<void> {
    await this.db.delete(schema.hubAiSettings).where(eq(schema.hubAiSettings.organizationId, organizationId));
  }
}
