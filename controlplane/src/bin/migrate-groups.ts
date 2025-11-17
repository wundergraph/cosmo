import * as process from 'node:process';
import postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, isNull } from 'drizzle-orm';
import { pino } from 'pino';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import Keycloak from '../core/services/Keycloak.js';
import * as schema from '../db/schema.js';
import { OrganizationRole } from '../db/models.js';
import { organizationRoleEnum } from '../db/schema.js';
import { OidcRepository } from '../core/repositories/OidcRepository.js';
import { defaultGroupDescription } from '../core/test-util.js';
import OidcProvider from '../core/services/OidcProvider.js';
import { getConfig } from './get-config.js';

const {
  realm,
  loginRealm,
  adminUser,
  adminPassword,
  clientId,
  apiUrl,
  databaseConnectionUrl,
  databaseTlsCa,
  databaseTlsCert,
  databaseTlsKey,
} = getConfig();

// Number of concurrent tasks. We'll allocate the same number of database connections + 1, so keep this number reasonable
const MAX_DEGREE_OF_PARALLELISM = 5;
// How many organizations to retrieve from the database to migrate in a transaction. This is used to not load
// all organizations at once and perform the migration in buckets
const ORGANIZATIONS_PER_BUCKET = 100;
// The maximum number of loops to perform while migrating the organizations. This is to prevent an infinite loop
const MAX_NUMBER_OF_BUCKETS = 10_000;

const oidcProvider = new OidcProvider();
const keycloakClient = new Keycloak({
  apiUrl,
  realm: loginRealm,
  clientId,
  adminUser,
  adminPassword,
  logger: pino(),
});

try {
  const start = performance.now();
  console.log('Migrating groups...');

  // Ensure keycloak is up and running
  await keycloakClient.authenticateClient();

  // Create database connection. TLS is optionally.
  const connectionConfig = await buildDatabaseConnectionConfig({
    tls:
      databaseTlsCa || databaseTlsCert || databaseTlsKey
        ? { ca: databaseTlsCa, cert: databaseTlsCert, key: databaseTlsKey }
        : undefined,
  });
  const queryConnection = postgres(databaseConnectionUrl, {
    ...connectionConfig,
    max: MAX_DEGREE_OF_PARALLELISM + 1,
  });

  // Initialize the database connection and load all the existing organizations
  const db = drizzle(queryConnection, { schema: { ...schema } });
  await migrateGroups(db);

  // Close the database connection
  await queryConnection.end({
    timeout: 1,
  });

  const duration = ((performance.now() - start) / 1000).toFixed(3);
  console.log(`Migration completed after ${duration} seconds`);

  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
} catch (err: any) {
  console.error(err);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

function chunkArray<T>(data: T[]): T[][] {
  // @ts-ignore
  if (MAX_DEGREE_OF_PARALLELISM === 1) {
    return [data];
  }

  const chunks: T[][] = [];
  const organizationsPerChunk = Math.ceil(ORGANIZATIONS_PER_BUCKET / MAX_DEGREE_OF_PARALLELISM);
  for (let i = 0; i < data.length; i += organizationsPerChunk) {
    chunks.push(data.slice(i, i + organizationsPerChunk));
  }

  return chunks;
}

async function migrateGroups(db: PostgresJsDatabase<typeof schema>) {
  /**
   * IMPORTANT:
   *
   * We need to load all existing root Keycloak groups because, if (for example) an organization has the slug `admin`,
   * when we do `client.groups.find` with that organization slug, it finds the first subgroup `admin`, which is
   * not the behaviour we want.
   *
   * By loading all the existing root groups, we can match the organization slug as we want.
   */
  console.log('Retrieving root groups from Keycloak...');
  const kcAllRootGroups = await keycloakClient.client.groups.find({ realm, max: -1 });

  // Doing migrations in chunks of 100, up to 1,000 this way we have a hard limit and the script doesn't loop forever.
  // That means we'll migrate 100,000 organizations at most, if needed, we could increment this limit
  let bucket = 0;
  while (bucket < MAX_NUMBER_OF_BUCKETS) {
    const organizations = await db.query.organizations.findMany({
      columns: { id: true, slug: true },
      orderBy: (orgs, { asc }) => [asc(orgs.createdAt)],
      offset: bucket * ORGANIZATIONS_PER_BUCKET,
      limit: ORGANIZATIONS_PER_BUCKET,
    });

    if (organizations.length === 0) {
      // We reached the end of the organizations table
      break;
    }

    console.log(`Processing organizations starting at offset ${bucket * ORGANIZATIONS_PER_BUCKET}...`);

    const start = performance.now();
    await Promise.all(
      chunkArray(organizations).map((chunk) =>
        db.transaction((tx) => {
          return processChunkOfOrganizations(chunk, tx, kcAllRootGroups);
        }),
      ),
    );

    const duration = ((performance.now() - start) / 1000).toFixed(3);
    console.log(`Done after ${duration} seconds`);
    console.log();

    bucket++;
    if (organizations.length < ORGANIZATIONS_PER_BUCKET) {
      // We reached the end of the organizations table, no need to loop over
      break;
    }
  }
}

async function processChunkOfOrganizations(
  organizations: { id: string; slug: string }[],
  db: PostgresJsDatabase<typeof schema>,
  kcAllRootGroups: { id?: string; name?: string }[],
) {
  for (const { id: organizationId, slug: organizationSlug } of organizations) {
    const start = performance.now();

    /**
     * 1. Create all the organization roles.
     */
    await keycloakClient.seedRoles({ realm, organizationSlug });

    /**
     * 2. Load all the existing organization groups and roles once so we don't keep fetching them over and over.
     *
     * This is a small performance optimization so we don't need to keep querying Keycloak every time we need
     * a reference to a group or role there
     */
    const rootGroup = kcAllRootGroups.find((group) => group.name === organizationSlug);
    if (!rootGroup?.id) {
      console.log(`\t- Organization group not found: "${organizationSlug}"`);
    }

    const kcOrganizationGroups = rootGroup?.id ? await getOrganizationGroups(rootGroup.id) : [];
    const kcOrganizationRoles = await getOrganizationRoles(organizationSlug);

    /**
     * 3. Make sure the organization and the group representing the organization in Keycloak are linked.
     */
    if (rootGroup?.id) {
      await db
        .update(schema.organizations)
        .set({ kcGroupId: rootGroup?.id })
        .where(eq(schema.organizations.id, organizationId))
        .execute();
    }

    /**
     * 4. Make sure that the Keycloak groups have been created in the database.
     */
    await ensureOrganizationGroupsExistInDatabase({
      db,
      organizationId,
      organizationSlug,
      kcOrganizationGroups,
      kcOrganizationRoles,
    });

    /**
     * 5. Assign all the organization members to the corresponding groups based on the current member roles
     */
    await assignOrganizationMembersToCorrespondingGroups({ db, organizationId });

    /**
     * 6. Override the fallback OIDC mapper for organizations that have configured an OIDC provider.
     *
     * This is because, previously, the fallback mapper was pointing to the `viewer` organization group, this is
     * no longer the case, now the mapper should point to the root organization group, which is `/<org>` in Keycloak
     */
    await remapFallbackOidcGroupMapper({ db, organizationId, organizationSlug });

    /**
     * 7. Assign any API key that doesn't have a group yet and wasn't limited to specific resources to the same
     * group as the creator
     */
    await assignAPIKeysToCreatorRole({ db, organizationId });

    // Done
    const duration = (performance.now() - start).toFixed(3);
    console.log(`\tDone processing organization "${organizationSlug}" after ${duration} ms`);
  }
}

/**
 * Retrieve all organization groups
 */
async function getOrganizationGroups(parentId: string) {
  const kcOrganizationSubGroups = await keycloakClient.fetchAllSubGroups({ realm, kcGroupId: parentId });
  return kcOrganizationSubGroups.map((group) => ({
    id: group.id!,
    name: group.name!,
  }));
}

/**
 * Retrieve all organization roles
 */
async function getOrganizationRoles(organizationSlug: string) {
  const kcOrganizationRoles = await keycloakClient.client.roles.find({
    realm,
    max: -1,
    search: `${organizationSlug}:`,
  });

  return kcOrganizationRoles.map((role) => ({
    id: role.id!,
    name: role.name!,
  }));
}

async function ensureOrganizationGroupsExistInDatabase({
  db,
  organizationId,
  organizationSlug,
  kcOrganizationGroups,
  kcOrganizationRoles,
}: {
  db: PostgresJsDatabase<typeof schema>;
  organizationId: string;
  organizationSlug: string;
  kcOrganizationGroups: { id: string; name: string }[];
  kcOrganizationRoles: { id: string; name: string }[];
}) {
  if (kcOrganizationGroups.length === 0) {
    // We don't need to create any group in the database
    return;
  }

  // Create all the subgroups in the database, ignoring the ones that already have been created
  const organizationGroups: { id: string; name: string }[] = [];
  for (const kcGroup of kcOrganizationGroups) {
    const existingGroup = await db
      .select({
        id: schema.organizationGroups.id,
        kcGroupId: schema.organizationGroups.kcGroupId,
      })
      .from(schema.organizationGroups)
      .where(
        and(
          eq(schema.organizationGroups.organizationId, organizationId),
          eq(schema.organizationGroups.name, kcGroup.name),
        ),
      )
      .limit(1);

    if (existingGroup.length === 0) {
      // The organization group doesn't exist
      const createdGroup = await db
        .insert(schema.organizationGroups)
        .values({
          organizationId,
          name: kcGroup.name,
          description: defaultGroupDescription[kcGroup.name] ?? '',
          // Only the admin group should be considered builtin
          builtin: kcGroup.name === 'admin',
          kcGroupId: kcGroup.id,
        })
        .returning();

      if (createdGroup.length > 0) {
        organizationGroups.push(...createdGroup);
      }
    } else if (!existingGroup[0].kcGroupId) {
      // Make sure that the existing group is linked to the Keycloak group
      await db.update(schema.organizationGroups).set({ kcGroupId: existingGroup[0].kcGroupId }).execute();
    }
  }

  // Create the initial rule for all the created roles, if needed
  const rulesToInsert = organizationGroups
    .filter((group) => organizationRoleEnum.enumValues.includes(`organization-${group.name}` as OrganizationRole))
    .map((group) => ({
      groupId: group.id,
      role: `organization-${group.name}` as OrganizationRole,
    }));

  if (rulesToInsert.length > 0) {
    await db.insert(schema.organizationGroupRules).values(rulesToInsert).onConflictDoNothing().execute();
  }

  // Finally, apply the corresponding organization role to each subgroup
  for (const kcGroup of kcOrganizationGroups) {
    if (!organizationRoleEnum.enumValues.includes(`organization-${kcGroup.name}` as OrganizationRole)) {
      // The role is not valid, we don't need to attach the group to any role
      continue;
    }

    const roleName = `${organizationSlug}:organization-${kcGroup.name}`;
    const kcRole = kcOrganizationRoles.find((r) => r.name === roleName);
    if (!kcRole) {
      // The role doesn't exist in Keycloak, skip
      continue;
    }

    // Add the group to the role
    await keycloakClient.client.groups.addRealmRoleMappings({ realm, id: kcGroup.id, roles: [kcRole] });
  }
}

async function assignOrganizationMembersToCorrespondingGroups({
  db,
  organizationId,
}: {
  db: PostgresJsDatabase<typeof schema>;
  organizationId: string;
}) {
  // Retrieve all the organization groups from the database, this way we have the groups in memory and don't
  // need to query the database multiple times
  const organizationGroups = await db
    .select({
      id: schema.organizationGroups.id,
      name: schema.organizationGroups.name,
    })
    .from(schema.organizationGroups)
    .where(eq(schema.organizationGroups.organizationId, organizationId))
    .execute();

  if (organizationGroups.length === 0) {
    // The organization doesn't seem to have any group, even after we supposedly ensured that the groups exists
    return;
  }

  // First, we retrieve all the organization members with their roles from the database
  const organizationMembers = await db
    .select({
      memberId: schema.organizationsMembers.id,
      role: schema.organizationMemberRoles.role,
      email: schema.users.email,
    })
    .from(schema.organizationsMembers)
    .rightJoin(
      schema.organizationMemberRoles,
      eq(schema.organizationsMembers.id, schema.organizationMemberRoles.organizationMemberId),
    )
    .rightJoin(schema.users, eq(schema.organizationsMembers.userId, schema.users.id))
    .where(eq(schema.organizationsMembers.organizationId, organizationId))
    .execute();

  // Group all the members by roles, falling back to `viewer` if the member doesn't have a role (which should
  // never be the case)
  const membersGroupedByRoles = Object.groupBy(organizationMembers, (om) => om.role ?? 'viewer');

  // Add all the members to the corresponding group
  await Promise.all(
    Object.entries(membersGroupedByRoles).map(async ([role, members]) => {
      if (!role || !members || members.length === 0) {
        return;
      }

      // Retrieve the group we are adding the members to
      const organizationGroup = organizationGroups.find((group) => group.name === role);
      if (!organizationGroup) {
        // The group doesn't exist, this should never be the case, but we'll allow it
        console.warn(`\t- Organization group "${role}" not found. Skipping`);
        return;
      }

      // Create all the group members, ignoring members that already exist
      await db
        .insert(schema.organizationGroupMembers)
        .values(
          members.map((member) => ({
            organizationMemberId: member.memberId!,
            groupId: organizationGroup.id,
          })),
        )
        .onConflictDoNothing() // If the member has already been assigned to the group, we shouldn't fail
        .execute();
    }),
  );

  // Finally, assign all invited members to the `developer` group. This is to persist how old implementation
  // worked, where members were added to the `developer` role automatically when the invitation was accepted,
  // however, since the invitations were created before the migration, we need to retroactively set the
  // target group
  const devGroup = organizationGroups.find((group) => group.name === 'developer');
  if (!devGroup) {
    // The organization developer group doesn't exist, an organization admin will have to assign the group
    // manually once the invitation is accepted
    return;
  }

  // Retrieve all pending invitations
  const pendingInvitations = await db
    .select({ id: schema.organizationInvitations.id })
    .from(schema.organizationInvitations)
    .where(
      and(
        eq(schema.organizationInvitations.organizationId, organizationId),
        eq(schema.organizationInvitations.accepted, false),
      ),
    )
    .execute();

  if (pendingInvitations.length === 0) {
    return;
  }

  await db
    .insert(schema.organizationInvitationGroups)
    .values(
      pendingInvitations.map((inv) => ({
        invitationId: inv.id,
        groupId: devGroup.id,
      })),
    )
    .execute();
}

async function remapFallbackOidcGroupMapper({
  db,
  organizationId,
  organizationSlug,
}: {
  db: PostgresJsDatabase<typeof schema>;
  organizationId: string;
  organizationSlug: string;
}) {
  const oidcRepo = new OidcRepository(db);
  const oidc = await oidcRepo.getOidcProvider({ organizationId });
  if (!oidc) {
    //
    return;
  }

  const mappers = await oidcProvider.fetchIDPMappers({
    kcClient: keycloakClient,
    kcRealm: realm,
    db,
    organizationId,
    alias: oidc.alias,
  });

  const fallbackMappers = mappers.filter((m) => {
    const claims = JSON.parse(m.claims) as { key: string; value: string }[];
    if (!claims || claims.length === 0) {
      return false;
    }

    return claims[0].key === 'ssoGroups' && claims[0].value === '.*';
  });

  if (fallbackMappers.length === 0) {
    return;
  }

  for (const mapper of fallbackMappers) {
    await keycloakClient.client.identityProviders.delMapper({
      realm,
      alias: oidc.alias,
      id: mapper.id,
    });

    await keycloakClient.createIDPMapper({
      realm,
      alias: oidc.alias,
      keycloakGroupName: `/${organizationSlug}`,
      claims: mapper.claims,
    });
  }
}

async function assignAPIKeysToCreatorRole({
  db,
  organizationId,
}: {
  db: PostgresJsDatabase<typeof schema>;
  organizationId: string;
}) {
  // Retrieve all organization groups
  const organizationGroups = await db
    .select({
      id: schema.organizationGroups.id,
      name: schema.organizationGroups.name,
    })
    .from(schema.organizationGroups)
    .where(eq(schema.organizationGroups.organizationId, organizationId))
    .execute();

  if (organizationGroups.length === 0) {
    return;
  }

  // Retrieve all the API keys that haven't been assigned a group including the role for the user that
  // created the API key
  const apiKeys = await db
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      userId: schema.apiKeys.userId,
    })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.organizationId, organizationId), isNull(schema.apiKeys.groupId)))
    .execute();

  await Promise.all(
    apiKeys.map(async (key) => {
      // Retrieve the number of resources that have been assigned to the API key
      const numberOfAssignedResources = await db.$count(
        schema.apiKeyResources,
        eq(schema.apiKeyResources.apiKeyId, key.id),
      );

      if (numberOfAssignedResources > 0) {
        // We are not going to assign the API key to any group so the legacy resource verification takes place
        return;
      }

      // No resources have been assigned to the API key, apply the same group as the owner
      const ownerRole = await db
        .select({ role: schema.organizationMemberRoles.role })
        .from(schema.organizationMemberRoles)
        .innerJoin(schema.organizationsMembers, eq(schema.organizationsMembers.userId, key.userId));

      if (ownerRole.length === 0) {
        // The API key owner doesn't have any role
        return;
      }

      // Determine which group the API key should be assigned to based on the highest role the owner has
      let role: 'admin' | 'developer' | 'viewer';
      if (ownerRole.some((r) => r.role === 'admin')) {
        role = 'admin';
      } else if (ownerRole.some((r) => r.role === 'developer')) {
        role = 'developer';
      } else if (ownerRole.some((r) => r.role === 'viewer')) {
        role = 'viewer';
      } else {
        // Unknown or invalid role
        return;
      }

      // Retrieve the organization group
      const organizationGroup = organizationGroups.find((group) => group.name === role);
      if (!organizationGroup) {
        // A group with the role name doesn't exists for the organization, skip API key
        return;
      }

      // Update the API key with the corresponding group
      await db
        .update(schema.apiKeys)
        .set({ groupId: organizationGroup.id })
        .where(eq(schema.apiKeys.id, key.id))
        .execute();
    }),
  );
}
