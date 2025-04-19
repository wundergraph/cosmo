import { z } from 'zod';

export const PlaygroundStateSchema = z.object({
    operation: z.string().min(1, 'Operation is required in playground url state'),
    variables: z.string().optional(),
    headers: z.string().optional(),
    preFlight: z.object({
        enabled: z.boolean(),
        content: z.string().optional(),
    }).optional(),
    preOperation: z.object({
        enabled: z.boolean(),
        content: z.string().optional(),
    }).optional(),
    postOperation: z.object({
        enabled: z.boolean(),
        content: z.string().optional(),
    }).optional(),
});
  
export type PlaygroundUrlState = z.infer<typeof PlaygroundStateSchema>;