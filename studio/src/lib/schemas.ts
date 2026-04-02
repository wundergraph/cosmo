import { z } from 'zod';

export const emailSchema = z.string().email();

export const organizationNameSchema = z
  .string()
  .trim()
  .min(3, { message: 'Organization name must be a minimum of 3 characters' })
  .max(32, { message: 'Organization name must be maximum 32 characters' });
