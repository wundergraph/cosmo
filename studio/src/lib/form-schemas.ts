import { z } from 'zod';

export const organizationNameSchema = z
  .string()
  .min(1, { message: 'Organization name must be a minimum of 1 character' })
  .max(24, { message: 'Organization name must be maximum 24 characters' });

export const organizationSlugSchema = z
  .string()
  .toLowerCase()
  .regex(
    new RegExp('^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    'Slug should start and end with an alphanumeric character. Spaces and special characters other that hyphen not allowed.',
  )
  .min(3, { message: 'Organization slug must be a minimum of 3 characters' })
  .max(24, { message: 'Organization slug must be maximum 24 characters' })
  .refine((value) => !['login', 'signup', 'create', 'account'].includes(value), 'This slug is a reserved keyword');

export const emailSchema = z.string().email('Invalid email address');
