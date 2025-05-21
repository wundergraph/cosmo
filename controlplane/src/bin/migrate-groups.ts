import * as process from 'node:process';
import postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, isNull } from 'drizzle-orm';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import Keycloak from '../core/services/Keycloak.js';
import * as schema from '../db/schema.js';
import { OrganizationRole } from '../db/models.js';
import { organizationGroups, organizationRoleEnum } from '../db/schema.js';
import { OidcRepository } from '../core/repositories/OidcRepository.js';
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

        // Load all the existing organization groups and roles once so we don't keep fetching them over and over
        const kcOrganizationGroups = await getOrganizationGroups(organizationSlug);
        const kcOrganizationRoles = await getOrganizationRoles(organizationSlug);

        await ensureOrganizationGroupsExistInDatabase({
          db: tx,
          organizationId,
          organizationSlug,
          kcOrganizationGroups,
          kcOrganizationRoles,
        });

        await assignOrganizationMembersToCorrespondingGroups({ db: tx, organizationId });

        await createGroupsForExistingAPIKeys({
          db: tx,
          organizationId,
          organizationSlug,
          kcOrganizationGroups,
          kcOrganizationRoles,
        });

        console.log(`\tDone processing organization ${organizationId} - "${organizationSlug}"`);
      }
    });

    i++;
    console.log('Done migrating chunk of organizations');
    console.log();
  }
}

/**
 * Retrieve all organization groups
 */
async function getOrganizationGroups(organizationSlug: string) {
  const kcPrimaryOrganizationGroups = await keycloakClient.client.groups.find({
    realm,
    max: 1,
    exact: true,
    search: organizationSlug,
  });

  if (kcPrimaryOrganizationGroups.length === 0) {
    return [];
  }

  const kcGroupId = kcPrimaryOrganizationGroups[0].id!;
  const kcOrganizationSubGroups = await keycloakClient.fetchAllSubGroups({ realm, kcGroupId });
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

  // Create the initial rule for all the created roles
  if (organizationGroups.length > 0) {
    const rulesToInsert = organizationGroups
      .filter((group) => organizationRoleEnum.enumValues.includes(`organization-${group.name}` as OrganizationRole))
      .map((group) => ({
        groupId: group.id,
        role: `organization-${group.name}` as OrganizationRole,
      }));

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
  for (const [role, members] of Object.entries(membersGroupedByRoles)) {
    if (!role || !members || members.length === 0) {
      continue;
    }

    // Retrieve the group we are adding the members to
    const organizationGroup = await db.query.organizationGroups
      .findFirst({
        where: and(
          eq(schema.organizationGroups.organizationId, organizationId),
          eq(schema.organizationGroups.name, role),
        ),
        columns: { id: true },
      })
      .execute();

    if (!organizationGroup) {
      // The group doesn't exist, this should never be the case, but we'll allow it
      console.warn(`Organization group "${role}" not found. Skipping`);
      continue;
    }

    // Create all the group members, ignoring members that already exist
    await Promise.all(
      members.map(async (member) => {
        const groupMember = await db.query.organizationGroupMembers.findFirst({
          where: and(
            eq(schema.organizationGroupMembers.organizationMemberId, member.memberId!),
            eq(schema.organizationGroupMembers.groupId, organizationGroup.id)
          ),
        });

        if (groupMember) {
          return;
        }

        await db
          .insert(schema.organizationGroupMembers)
          .values({
            organizationMemberId: member.memberId!,
            groupId: organizationGroup.id,
          })
          .execute();
      }),
    );
  }
}

async function createGroupsForExistingAPIKeys({
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

  for (const key of apiKeys) {
    // Retrieve all the resources that have been assigned to the API key
    const apiKeyResources = await db
      .select({
        targetId: schema.apiKeyResources.targetId,
        targetType: schema.targets.type,
      })
      .from(schema.apiKeyResources)
      .innerJoin(schema.targets, eq(schema.targets.id, schema.apiKeyResources.targetId))
      .where(eq(schema.apiKeyResources.apiKeyId, key.id))
      .execute();

    if (apiKeyResources.length === 0) {
      // No resources have been assigned to the API key, apply the same group as the owner
      const ownerRole = await db
        .select({ role: schema.organizationMemberRoles.role })
        .from(schema.organizationMemberRoles)
        .innerJoin(schema.organizationsMembers, eq(schema.organizationsMembers.userId, key.userId))
        .limit(1);

      if (ownerRole.length === 0) {
        // The owner doesn't have a role, skip
        continue;
      }

      // Retrieve the group we are adding the API key to
      const organizationGroup = await db.query.organizationGroups.findFirst({
        where: and(
          eq(schema.organizationGroups.organizationId, organizationId),
          eq(schema.organizationGroups.name, ownerRole[0].role),
        ),
        columns: { id: true },
      });

      if (!organizationGroup) {
        // The group doesn't exist, this should never be the case, but we'll allow it
        continue;
      }

      // Update the API key with the corresponding group
      await db
        .update(schema.apiKeys)
        .set({ groupId: organizationGroup.id })
        .where(eq(schema.apiKeys.id, key.id))
        .execute();

      continue;
    }

    // The API key have been assigned one or more resources, we need to create a group just for it,
    // if it doesn't already exist
    const groupName = `key-${key.name}`;
    let organizationGroup = await db.query.organizationGroups.findFirst({
      where: and(
        eq(schema.organizationGroups.organizationId, organizationId),
        eq(schema.organizationGroups.name, groupName),
      ),
      columns: { id: true },
    });

    if (!organizationGroup) {
      // The group doesn't exist, we need to create a new group
      const hasFederatedTargets = apiKeyResources.some((target) => target.targetType === 'federated');
      const hasSubgraphTargets = apiKeyResources.some((target) => target.targetType === 'subgraph');

      let kcGroup = kcOrganizationGroups.find((group) => group.name === groupName);
      if (!kcGroup) {
        // The group doesn't exist in Keycloak, create it
        const kcCreatedGroup = await keycloakClient.createSubGroup({
          realm,
          groupName,
          organizationSlug,
        });

        if (!kcCreatedGroup) {
          // Failed to create the Keycloak group
          continue;
        }

        kcGroup = { id: kcCreatedGroup!, name: groupName };

        if (hasFederatedTargets) {
          // The API key have access to one or more federated graphs, add the role to the Keycloak group
          const kcRole = kcOrganizationRoles.find((role) => role.name === `${organizationSlug}:graph-admin`);
          if (kcRole) {
            await keycloakClient.client.groups.addRealmRoleMappings({ realm, id: kcGroup.id, roles: [kcRole] });
          }
        }

        if (hasSubgraphTargets) {
          // The API key have access to one or more subgraphs, add the role to the Keycloak group
          const kcRole = kcOrganizationRoles.find((role) => role.name === `${organizationSlug}:subgraph-admin`);
          if (kcRole) {
            await keycloakClient.client.groups.addRealmRoleMappings({ realm, id: kcGroup.id, roles: [kcRole] });
          }
        }
      }

      // Create the group in the database
      const createdGroup = await db
        .insert(schema.organizationGroups)
        .values({
          organizationId,
          name: groupName,
          description: `Group created automatically for the API key "${key.name}".`,
          builtin: false,
          kcGroupId: kcGroup.id,
        })
        .returning()
        .execute();

      organizationGroup = { id: createdGroup[0].id };

      // Assign the `graph-admin` role, if needed
      if (hasFederatedTargets) {
        const createdRule = await db
          .insert(schema.organizationGroupRules)
          .values({ groupId: organizationGroup.id, role: 'graph-admin' })
          .returning()
          .execute();

        await db
          .insert(schema.organizationGroupRuleTargets)
          .values(
            apiKeyResources
              .filter((target) => target.targetType === 'federated')
              .map((target) => ({
                ruleId: createdRule[0].id,
                targetId: target.targetId!,
              })),
          )
          .execute();
      }

      // Assign the `subgraph-admin` role, if needed
      if (hasSubgraphTargets) {
        const createdRule = await db
          .insert(schema.organizationGroupRules)
          .values({ groupId: organizationGroup.id, role: 'subgraph-admin' })
          .returning()
          .execute();

        await db
          .insert(schema.organizationGroupRuleTargets)
          .values(
            apiKeyResources
              .filter((target) => target.targetType === 'subgraph')
              .map((target) => ({
                ruleId: createdRule[0].id,
                targetId: target.targetId!,
              })),
          )
          .execute();
      }
    }

    // Finally, assign the API key to the group
    await db
      .update(schema.apiKeys)
      .set({ groupId: organizationGroup.id })
      .where(eq(schema.apiKeys.id, key.id))
      .execute();
  }
}
