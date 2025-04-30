import * as process from 'node:process';
import postgres from 'postgres';
import { drizzle , PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import Keycloak from '../core/services/Keycloak.js';
import * as schema from '../db/schema.js';
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

const keycloakClient = new Keycloak({
  apiUrl,
  realm: loginRealm,
  clientId,
  adminUser,
  adminPassword,
});

try {  // Ensure keycloak is up and running
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
    max: 1,
  });
  
  // Initialize the database connection and load all the existing organizations
  const db = drizzle(queryConnection, { schema: { ...schema } });
  await db.transaction(migrateGroups);
  
  //
  await queryConnection.end({
    timeout: 1,
  });

  console.log('Done');

  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
} catch (err: any) {
  console.error(err);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

async function migrateGroups(db: PostgresJsDatabase<typeof schema>) {
  const organizations = await db.query.organizations.findMany({
    columns: { id: true, slug: true, },
  });

  await Promise.all(organizations.map(async ({ id: organizationId, slug: organizationSlug }) => {
    await keycloakClient.seedRoles({ realm, organizationSlug });
    await ensureKeycloakSubgroupsForOrganizationExistInDatabase({ db, organizationId, organizationSlug });
    await assignOrganizationMembersToCorrespondingGroups({ db, organizationId });

    console.log(`- Done processing organization "${organizationSlug}"`);
  }));
}

async function ensureKeycloakSubgroupsForOrganizationExistInDatabase({ db, organizationId, organizationSlug }: {
  db: PostgresJsDatabase<typeof schema>;
  organizationId: string;
  organizationSlug: string;
}) {
  const organizationGroups = await keycloakClient.client.groups.find({
    max: -1,
    realm,
    search: organizationSlug,
  });

  if (organizationGroups.length === 0) {
    return;
  }

  // Retrieve all the subgroups
  const organizationSubgroups = await keycloakClient.fetchAllSubGroups({
    realm,
    kcGroupId: organizationGroups[0].id!,
  });

  // Create all the subgroups in the database, ignoring the ones that already have been created
  await db.insert(schema.organizationGroups)
    .values(organizationSubgroups.map((sg) => ({
      organizationId,
      name: sg.name!,
      description: '',
      kcGroupId: sg.id!,
    })))
    .onConflictDoNothing()
    .execute();

  // Finally, apply the corresponding organization role to each subgroup
  await Promise.all(organizationSubgroups.map(async (sg) => {
    const role = await keycloakClient.client.roles.findOneByName({
      realm,
      name: `${organizationSlug}:organization-${sg.name}`
    });

    if (!role) {
      return;
    }

    await keycloakClient.client.groups.addRealmRoleMappings({
      realm,
      id: sg.id!,
      roles: [{ id: role.id!, name: role.name! }],
    });
  }));
}

async function assignOrganizationMembersToCorrespondingGroups({ db, organizationId }: {
  db: PostgresJsDatabase<typeof schema>;
  organizationId: string;
}) {
  const organizationMembers = await db
    .select({
      memberId: schema.organizationsMembers.id,
      role: schema.organizationMemberRoles.role,
      email: schema.users.email,
    })
    .from(schema.organizationsMembers)
    .rightJoin(
      schema.organizationMemberRoles,
      eq(schema.organizationsMembers.id, schema.organizationMemberRoles.organizationMemberId)
    )
    .rightJoin(
      schema.users,
      eq(schema.organizationsMembers.userId, schema.users.id)
    )
    .where(eq(schema.organizationsMembers.organizationId, organizationId))
    .execute();

  const membersGroupedByRoles = Object.groupBy(organizationMembers, (om) => om.role ?? '');
  await Promise.all(Object.entries(membersGroupedByRoles).map(async ([role, members]) => {
    if (!role || !members || members.length === 0) {
      return;
    }

    const orgGroups = await db
      .select({
        id: schema.organizationGroups.id,
        kcGroupId: schema.organizationGroups.kcGroupId,
      })
      .from(schema.organizationGroups)
      .where(and(
        eq(schema.organizationGroups.organizationId, organizationId),
        eq(schema.organizationGroups.name, role as string)
      ))
      .limit(1)
      .execute();

    if (orgGroups.length === 0) {
      console.warn(`Organization group "${role}" not found. Skipping`);
      return;
    }

    // Assign all members to the group
    const orgGroup = orgGroups[0];
    await db.insert(schema.organizationGroupMembers)
      .values(members.map(({ memberId }) => ({
        organizationMemberId: memberId!,
        groupId: orgGroup.id,
      })))
      .onConflictDoNothing()
      .execute();
  }));
}