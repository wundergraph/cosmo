import * as z from 'zod';

export const apiKeyPermissions = [
  {
    displayName: 'System for Cross-domain Identity Management (SCIM)',
    value: 'scim',
  },
];

export const delayForManualOrgDeletionInDays = 3;
export const delayForOrgAuditLogsDeletionInDays = 90;

export const deafultRangeInHoursForGetOperations = 7 * 24;

export const organizationSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[\da-z]+(?:-[\da-z]+)*$/,
    'Slug should start and end with an alphanumeric character. Spaces and special characters other that hyphen not allowed.',
  )
  .min(3, {
    message:
      'Invalid slug. It must be of 3-32 characters in length, start and end with an alphanumeric character and may contain hyphens in between.',
  })
  .max(32, {
    message:
      'Invalid slug. It must be of 3-32 characters in length, start and end with an alphanumeric character and may contain hyphens in between.',
  })
  .refine((value) => !['login', 'signup', 'create', 'account'].includes(value), 'This slug is a reserved keyword.');

export const organizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, {
      message: 'Invalid name. It must be of 3-32 characters in length.',
    })
    .max(32, { message: 'Invalid name. It must be of 3-32 characters in length.' }),
  slug: organizationSlugSchema,
});
