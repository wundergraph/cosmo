import * as process from 'node:process';
import postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, not } from 'drizzle-orm';
import { uid } from 'uid';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import Keycloak from '../core/services/Keycloak.js';
import * as schema from '../db/schema.js';
import { OrganizationRole } from '../db/models.js';
import { organizationRoleEnum } from '../db/schema.js';
import { OidcRepository } from '../core/repositories/OidcRepository.js';
import { OrganizationGroupRepository } from '../core/repositories/OrganizationGroupRepository.js';
import { defaultGroupDescription } from '../core/test-util.js';
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

try {
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
    max: 1,
  });

  // Initialize the database connection and load all the existing organizations
  const db = drizzle(queryConnection, { schema: { ...schema } });
  await migrateGroups(db);

  //
  await queryConnection.end({
    timeout: 1,
  });

  console.log('Migration done');

  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
} catch (err: any) {
  console.error(err);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

async function migrateGroups(db: PostgresJsDatabase<typeof schema>) {
  // Doing migrations in chunks of 100, up to 1,000 this way we have a hard limit and the script doesn't loop forever.
  // That means we'll migrate 100,000 organizations at most, if needed, we could increment this limit
  let i = 0;
  while (i < 1000) {
    const organizations = await db.query.organizations.findMany({
      columns: { id: true, slug: true },
      orderBy: (orgs, { asc }) => [asc(orgs.createdAt)],
      offset: i * 100,
      limit: 100,
    });

    if (organizations.length === 0) {
      // We reached the end of the organizations table
      break;
    }

    console.log(`Migrating from organization id ${organizations[0].id} to ${organizations.at(-1)?.id}`);

    await db.transaction(async (tx) => {
      for (const { id: organizationId, slug: organizationSlug } of organizations) {
        console.log(`\tProcessing organization ${organizationId} - "${organizationSlug}`);
        await keycloakClient.seedRoles({ realm, organizationSlug });
        await ensureOrganizationSubgroupsExistInDatabase({ db: tx, organizationId, organizationSlug });
        await updateAndLinkExistingOrganizationOidcMappers({
          db: tx,
          keycloakClient,
          organizationId,
          organizationSlug,
        });
        await assignOrganizationMembersToCorrespondingGroups({ db: tx, organizationId });

        // TODO: The next step is not repeatable as it would create the groups every time
        // await createGroupsForSubgraphMembers({ tx, organizationId, organizationSlug });

        console.log(`\t\tDone processing organization ${organizationId} - "${organizationSlug}"`);
      }
    });

    i++;
    console.log('Done migrating chunk of organizations');
    console.log();
  }
}

async function ensureOrganizationSubgroupsExistInDatabase({
  db,
  organizationId,
  organizationSlug,
}: {
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
  const createdGroups = await db
    .insert(schema.organizationGroups)
    .values(
      organizationSubgroups.map((sg) => ({
        organizationId,
        name: sg.name!,
        description: defaultGroupDescription[sg.name!] ?? '',
        builtin: true,
        kcGroupId: sg.id!,
      })),
    )
    .onConflictDoNothing()
    .returning()
    .execute();

  // Create the initial rule for all the created roles
  if (createdGroups.length > 0) {
    await db
      .insert(schema.organizationGroupRules)
      .values(
        createdGroups
          .filter((group) => organizationRoleEnum.enumValues.includes(`organization-${group.name}` as OrganizationRole))
          .map((group) => ({
            groupId: group.id,
            role: `organization-${group.name}` as OrganizationRole,
            allowAnyNamespace: true,
            allowAnyResource: true,
          })),
      )
      .onConflictDoNothing()
      .execute();
  }

  // Finally, apply the corresponding organization role to each subgroup
  await Promise.all(
    organizationSubgroups.map(async (group) => {
      const role = await keycloakClient.client.roles.findOneByName({
        realm,
        name: `${organizationSlug}:organization-${group.name}`,
      });

      if (!role) {
        return;
      }

      await keycloakClient.client.groups.addRealmRoleMappings({
        realm,
        id: group.id!,
        roles: [{ id: role.id!, name: role.name! }],
      });
    }),
  );
}

async function updateAndLinkExistingOrganizationOidcMappers({
  db,
  keycloakClient,
  organizationId,
  organizationSlug,
}: {
  db: PostgresJsDatabase<typeof schema>;
  keycloakClient: Keycloak;
  organizationId: string;
  organizationSlug: string;
}) {
  const kcOrgGroups = await keycloakClient.client.groups.find({
    realm,
    search: organizationSlug,
    max: 1,
  });

  if (kcOrgGroups.length !== 1) {
    return;
  }

  const oidcRepo = new OidcRepository(db);
  const oidcProvider = await oidcRepo.getOidcProvider({ organizationId });
  if (!oidcProvider) {
    return;
  }

  const existingMappers = await keycloakClient.client.identityProviders.findMappers({
    realm,
    alias: oidcProvider.alias,
  });

  const key = 'ssoGroups';
  for (const mapper of existingMappers) {
    const kcGroupName = mapper.config.group as string;
    const kcGroupNameParts = kcGroupName.split('/');
    if (kcGroupNameParts.length !== 3) {
      continue;
    }

    const claims = JSON.parse(mapper.config.claims) as { value: string }[];
    if (claims.length === 1 && claims[0].value === '.*') {
      await keycloakClient.client.identityProviders.delMapper({
        realm,
        alias: oidcProvider.alias,
        id: mapper.id!,
      });

      await keycloakClient.createIDPMapper({
        realm,
        claims: `[{ "key": "${key}", "value": ".*" }]`,
        alias: oidcProvider.alias,
        keycloakGroupName: `/${organizationSlug}`,
      });
    } else {
      await db
        .update(schema.organizationGroups)
        .set({ kcMapperId: mapper.id! })
        .where(eq(schema.organizationGroups.name, kcGroupNameParts[2]));
    }
  }
}

async function assignOrganizationMembersToCorrespondingGroups({
  db,
  organizationId,
}: {
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
      eq(schema.organizationsMembers.id, schema.organizationMemberRoles.organizationMemberId),
    )
    .rightJoin(schema.users, eq(schema.organizationsMembers.userId, schema.users.id))
    .where(eq(schema.organizationsMembers.organizationId, organizationId))
    .execute();

  const membersGroupedByRoles = Object.groupBy(organizationMembers, (om) => om.role ?? '');
  await Promise.all(
    Object.entries(membersGroupedByRoles).map(async ([role, members]) => {
      if (!role || !members || members.length === 0) {
        return;
      }

      const orgGroups = await db
        .select({
          id: schema.organizationGroups.id,
          kcGroupId: schema.organizationGroups.kcGroupId,
        })
        .from(schema.organizationGroups)
        .where(
          and(
            eq(schema.organizationGroups.organizationId, organizationId),
            eq(schema.organizationGroups.name, role as string),
          ),
        )
        .limit(1)
        .execute();

      if (orgGroups.length === 0) {
        console.warn(`Organization group "${role}" not found. Skipping`);
        return;
      }

      // Assign all members to the group
      const orgGroup = orgGroups[0];
      await db
        .insert(schema.organizationGroupMembers)
        .values(
          members.map(({ memberId }) => ({
            organizationMemberId: memberId!,
            groupId: orgGroup.id,
          })),
        )
        .onConflictDoNothing()
        .execute();
    }),
  );
}

async function createGroupsForSubgraphMembers({
  db,
  organizationId,
  organizationSlug,
}: {
  db: PostgresJsDatabase<typeof schema>;
  organizationId: string;
  organizationSlug: string;
}) {
  const subgraphMembers = await db
    .select({
      targetId: schema.subgraphs.targetId,
      userId: schema.subgraphMembers.userId,
      email: schema.users.email,
      orgMemberId: schema.organizationsMembers.id,
    })
    .from(schema.subgraphMembers)
    .innerJoin(schema.subgraphs, eq(schema.subgraphs.id, schema.subgraphMembers.subgraphId))
    .innerJoin(schema.targets, eq(schema.targets.id, schema.subgraphs.targetId))
    .innerJoin(schema.users, eq(schema.users.id, schema.subgraphMembers.userId))
    .innerJoin(schema.organizationsMembers, eq(schema.organizationsMembers.userId, schema.users.id))
    .where(
      and(
        eq(schema.targets.organizationId, organizationId),
        not(eq(schema.targets.createdBy, schema.subgraphMembers.userId)),
      ),
    );

  if (subgraphMembers.length === 0) {
    return;
  }

  const orgGroupRepo = new OrganizationGroupRepository(db);
  const groupedSubgraphsByUser = Object.groupBy(subgraphMembers, (m) => m.email);

  for (const [email, subgraphs] of Object.entries(groupedSubgraphsByUser)) {
    if (!subgraphs || subgraphs.length === 0) {
      continue;
    }

    // Retrieve user from Keycloak
    const kcUsers = await keycloakClient.client.users.find({ realm, email });
    if (kcUsers.length === 0) {
      // Keycloak user not found, skip update
      continue;
    }

    // Retrieve the subgraph publisher role from Keycloak
    const kcRole = await keycloakClient.client.roles.findOneByName({
      realm,
      name: `${organizationSlug}:subgraph-publisher`,
    });

    if (!kcRole) {
      // Keycloak role doesn't exists
      continue;
    }

    // Create a new group with the corresponding role
    const groupName = `generated-${uid()}`;
    const kcCreatedGroup = await keycloakClient.createSubGroup({
      realm,
      organizationSlug,
      groupName,
    });

    if (!kcCreatedGroup) {
      continue;
    }

    // Add the role to the created role
    await keycloakClient.client.groups.addRealmRoleMappings({
      realm,
      id: kcCreatedGroup!,
      roles: [{ id: kcRole!.id!, name: kcRole!.name! }],
    });

    // Create the new group in the database
    const createdGroup = await orgGroupRepo.create({
      organizationId,
      name: groupName,
      description: `Subgraph memberships for organization member ${email}`,
      kcGroupId: kcCreatedGroup!,
    });

    // Attach all the subgraphs the user is allowed to publish to
    await orgGroupRepo.updateGroup({
      groupId: createdGroup.groupId,
      organizationId,
      rules: [
        {
          role: 'subgraph-publisher',
          namespaces: [],
          resources: subgraphs?.map((g) => g.targetId) ?? [],
        },
      ],
    });

    // Finally, add the user to the group
    await orgGroupRepo.addUserToGroup({
      organizationMemberId: subgraphs[0].orgMemberId,
      groupId: createdGroup.groupId,
    });
  }
}
