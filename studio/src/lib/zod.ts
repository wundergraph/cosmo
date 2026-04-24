import * as z from 'zod';

export const absoluteUrlValidator = z
  .string()
  .trim()
  .min(1, 'Must be a valid absolute URL starting with https://')
  .superRefine((val, ctx) => {
    if (!val) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be a valid absolute URL starting with https://',
      });
      return;
    }

    try {
      const url = new URL(val); // Ensure that the value is a valid absolute URL
      if (url.hostname === 'localhost') {
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Must be a valid absolute URL starting with http:// or https://',
          });
        }

        return;
      }

      if (url.protocol !== 'https:') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Must be a valid absolute URL starting with https://',
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be a valid absolute URL starting with https://',
      });
    }
  });
