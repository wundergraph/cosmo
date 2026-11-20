import 'dotenv/config';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { S3Client } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pino } from 'pino';
import * as schema from '../db/schema.js';
import { S3BlobStorage } from '../core/blobstorage/index.js';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { createRedisConnections } from '../core/plugins/redis.js';
import { AuditLogRepository } from '../core/repositories/AuditLogRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../core/repositories/NamespaceRepository.js';
import { OidcRepository } from '../core/repositories/OidcRepository.js';
import { OrganizationGroupRepository } from '../core/repositories/OrganizationGroupRepository.js';
import { OrganizationRepository } from '../core/repositories/OrganizationRepository.js';
import Keycloak, { TRIAL_ORG_ATTRIBUTE } from '../core/services/Keycloak.js';
import OidcProvider from '../core/services/OidcProvider.js';
import { organizationSchema } from '../core/constants.js';
import { createS3ClientConfig, extractS3BucketName, isGoogleCloudStorageUrl } from '../core/util.js';
import { DeleteOrganizationAuditLogsQueue } from '../core/workers/DeleteOrganizationAuditLogsWorker.js';
import { getConfig } from './get-config.js';

// Trial organizations for customer trials, run by deploy/trial.sh in hub:
//   trial.js provision <slug> <org name> <email>...   one password per email on stdin, in order
//   trial.js check <slug>                             prints trial, absent or not-trial, then "user <email>" per trial user
//   trial.js delete <slug>
// The org's Keycloak root group carries the trial marker; delete removes it last, so a rerun finishes the job.

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
  defaultPlan,
  redis,
  s3Storage,
} = getConfig();

type TrialState = 'trial' | 'absent' | 'not-trial';

const logger = pino();

const keycloak = new Keycloak({
  apiUrl,
  realm: loginRealm,
  clientId,
  adminUser,
  adminPassword,
  logger,
});

const connectionConfig = await buildDatabaseConnectionConfig({
  tls:
    databaseTlsCa || databaseTlsCert || databaseTlsKey
      ? { ca: databaseTlsCa, cert: databaseTlsCert, key: databaseTlsKey }
      : undefined,
});
const queryConnection = postgres(databaseConnectionUrl, { ...connectionConfig, max: 1 });
const db = drizzle(queryConnection, { schema: { ...schema } });

async function findOrgGroup(slug: string) {
  const groups = await keycloak.client.groups.find({ realm, search: slug, exact: true });
  const match = groups.find((group) => group.name === slug && group.path === `/${slug}`);
  if (!match?.id) {
    return undefined;
  }

  return keycloak.client.groups.findOne({ realm, id: match.id });
}

async function findTrialUsers(slug: string) {
  const users = await keycloak.client.users.find({ realm, q: `${TRIAL_ORG_ATTRIBUTE}:${slug}`, max: -1 });
  return users.flatMap((user) =>
    user.id && user.attributes?.[TRIAL_ORG_ATTRIBUTE]?.includes(slug) ? [{ id: user.id, email: user.email ?? '' }] : [],
  );
}

async function trialState(slug: string): Promise<TrialState> {
  const group = await findOrgGroup(slug);
  const org = await new OrganizationRepository(logger, db).bySlug(slug);

  if (group?.attributes?.[TRIAL_ORG_ATTRIBUTE]?.includes(slug)) {
    return 'trial';
  }

  if (group || org) {
    return 'not-trial';
  }

  return 'absent';
}

async function provision(slug: string, organizationName: string, emails: string[]) {
  const validated = organizationSchema.safeParse({ name: organizationName, slug });
  if (!validated.success) {
    throw new Error(validated.error.issues.map((issue) => issue.message).join(' '));
  }
  if (validated.data.slug !== slug) {
    throw new Error(`Use the slug in lowercase: "${validated.data.slug}"`);
  }

  const passwords = readFileSync(0, 'utf8').split('\n').slice(0, emails.length);
  if (passwords.length !== emails.length || passwords.some((password) => password.length === 0)) {
    throw new Error(`Expected ${emails.length} passwords on stdin, one per line`);
  }

  if ((await trialState(slug)) === 'not-trial') {
    throw new Error(`Organization "${slug}" exists and is not a trial organization`);
  }

  const existingUsers = await Promise.all(emails.map((email) => keycloak.findUserByEmail({ realm, email })));
  for (const [index, user] of existingUsers.entries()) {
    if (user && !user.attributes?.[TRIAL_ORG_ATTRIBUTE]?.includes(slug)) {
      throw new Error(`User "${emails[index]}" exists and is not a trial user of "${slug}"`);
    }
  }

  const userIds: string[] = [];
  for (const [index, email] of emails.entries()) {
    const credential = { type: 'password', value: passwords[index], temporary: true };
    const existing = existingUsers[index];

    if (existing?.id) {
      await keycloak.client.users.update(
        { realm, id: existing.id },
        { ...existing, emailVerified: true, enabled: true, requiredActions: ['UPDATE_PASSWORD'] },
      );
      await keycloak.client.users.resetPassword({ realm, id: existing.id, credential });
      userIds.push(existing.id);
      console.log(`Reset the password of "${email}"`);
      continue;
    }

    const created = await keycloak.client.users.create({
      realm,
      username: email,
      email,
      enabled: true,
      emailVerified: true,
      attributes: { [TRIAL_ORG_ATTRIBUTE]: [slug] },
      requiredActions: ['UPDATE_PASSWORD'],
      credentials: [credential],
    });
    userIds.push(created.id);
    console.log(`Created user "${email}"`);
  }

  let group = await findOrgGroup(slug);
  if (!group?.id) {
    const [rootGroupId] = await keycloak.seedGroup({ realm, userID: userIds[0], organizationSlug: slug });
    group = await keycloak.client.groups.findOne({ realm, id: rootGroupId });
    if (!group?.id) {
      throw new Error(`Keycloak group "${slug}" was not created`);
    }

    await keycloak.client.groups.update(
      { realm, id: group.id },
      { name: group.name, attributes: { ...group.attributes, [TRIAL_ORG_ATTRIBUTE]: [slug] } },
    );
  }

  const kcSubGroups = await keycloak.fetchAllSubGroups({ realm, kcGroupId: group.id });
  const kcGroups = kcSubGroups.flatMap((subGroup) =>
    subGroup.id && subGroup.name ? [{ id: subGroup.id, name: subGroup.name }] : [],
  );
  const kcAdminGroup = kcGroups.find((subGroup) => subGroup.name === 'admin');
  if (!kcAdminGroup) {
    throw new Error(`Keycloak group "${slug}" has no admin subgroup`);
  }

  for (const userId of userIds) {
    await keycloak.client.users.addToGroup({ realm, id: userId, groupId: kcAdminGroup.id });
  }

  const kcRootGroupId = group.id;
  await db.transaction(async (tx) => {
    const orgRepo = new OrganizationRepository(logger, tx, defaultPlan);
    const orgGroupRepo = new OrganizationGroupRepository(tx);

    for (const [index, userId] of userIds.entries()) {
      await tx
        .insert(schema.users)
        .values({ id: userId, email: emails[index] })
        .onConflictDoUpdate({ target: schema.users.id, set: { email: emails[index] } })
        .execute();
    }

    let organization = await orgRepo.bySlug(slug);
    if (!organization) {
      organization = await orgRepo.createOrganization({
        organizationName,
        organizationSlug: slug,
        ownerID: userIds[0],
        kcGroupId: kcRootGroupId,
      });
      console.log(`Created organization "${slug}"`);
    }

    await orgGroupRepo.importKeycloakGroups({ organizationId: organization.id, kcGroups });
    const adminGroup = await orgGroupRepo.byName({ organizationId: organization.id, name: 'admin' });
    if (!adminGroup) {
      throw new Error(`Organization "${slug}" has no admin group`);
    }

    for (const userId of userIds) {
      const member = await orgRepo.addOrganizationMember({ organizationID: organization.id, userID: userId });
      await tx
        .insert(schema.organizationGroupMembers)
        .values({ organizationMemberId: member.id, groupId: adminGroup.groupId })
        .onConflictDoNothing()
        .execute();
    }

    const namespaceRepo = new NamespaceRepository(tx, organization.id);
    if (!(await namespaceRepo.byName(DefaultNamespace))) {
      await namespaceRepo.create({ name: DefaultNamespace, createdBy: userIds[0] });
    }
  });

  console.log(`Organization "${slug}" has ${emails.join(', ')} as admins`);
}

async function deleteOrganization(organization: { id: string; slug: string }) {
  const { redisQueue, redisWorker } = await createRedisConnections({
    host: redis.host,
    port: Number(redis.port),
    password: redis.password,
    tls: redis.tls,
  });

  try {
    const bucketName = extractS3BucketName(s3Storage);
    const blobStorage = new S3BlobStorage(new S3Client(createS3ClientConfig(bucketName, s3Storage)), bucketName, {
      useIndividualDeletes: isGoogleCloudStorageUrl(s3Storage.url),
    });

    const oidcProvider = new OidcProvider();
    const providers = await new OidcRepository(db).listOidcProvidersByOrganizationId({
      organizationId: organization.id,
    });
    for (const provider of providers) {
      await oidcProvider.deleteOidcProvider({
        kcClient: keycloak,
        kcRealm: realm,
        organizationSlug: organization.slug,
        alias: provider.alias,
      });
    }

    await new OrganizationRepository(logger, db).deleteOrganization(
      organization.id,
      blobStorage,
      new DeleteOrganizationAuditLogsQueue(logger, redisQueue),
    );
    await new AuditLogRepository(db).deleteOrganizationLogs({ organizationId: organization.id });
  } finally {
    redisQueue.disconnect();
    redisWorker.disconnect();
  }
}

async function remove(slug: string) {
  const state = await trialState(slug);
  if (state === 'not-trial') {
    throw new Error(`Organization "${slug}" is not a trial organization`);
  }

  if (state === 'absent') {
    console.log('nothing to remove');
    return;
  }

  const organization = await new OrganizationRepository(logger, db).bySlug(slug);
  if (organization) {
    await deleteOrganization(organization);
  }
  console.log(`removed cosmo organization: ${organization ? 1 : 0}`);

  const trialUsers = await findTrialUsers(slug);
  for (const user of trialUsers) {
    await db.delete(schema.users).where(eq(schema.users.id, user.id)).execute();
    await keycloak.client.users.del({ realm, id: user.id });
  }
  console.log(`removed cosmo users: ${trialUsers.length}`);

  const roles = await keycloak.client.roles.find({ realm, max: -1, search: `${slug}:` });
  const orgRoleIds = roles.flatMap((role) => (role.id && role.name?.startsWith(`${slug}:`) ? [role.id] : []));
  for (const roleId of orgRoleIds) {
    await keycloak.client.roles.delById({ realm, id: roleId });
  }
  console.log(`removed cosmo keycloak roles: ${orgRoleIds.length}`);

  const group = await findOrgGroup(slug);
  if (group?.id) {
    await keycloak.deleteGroupById({ realm, groupId: group.id });
  }
  console.log(`removed cosmo keycloak groups: ${group ? 1 : 0}`);
}

const [command, slug, ...rest] = process.argv.slice(2);

try {
  if (!slug) {
    throw new Error('Usage: trial.js provision <slug> <org name> <email>... | check <slug> | delete <slug>');
  }

  await keycloak.authenticateClient();

  switch (command) {
    case 'provision': {
      const [organizationName, ...emails] = rest;
      if (!organizationName || emails.length === 0) {
        throw new Error('Usage: trial.js provision <slug> <org name> <email>...');
      }
      await provision(slug, organizationName, emails);
      break;
    }
    case 'check': {
      const state = await trialState(slug);
      console.log(state);
      if (state === 'trial') {
        for (const user of await findTrialUsers(slug)) {
          console.log(`user ${user.email}`);
        }
      }
      break;
    }
    case 'delete': {
      await remove(slug);
      break;
    }
    default: {
      throw new Error(`Unknown command "${command}"`);
    }
  }

  await queryConnection.end({ timeout: 1 });
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
} catch (err: unknown) {
  console.error(err instanceof Error ? err.message : err);
  await queryConnection.end({ timeout: 1 });
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}
