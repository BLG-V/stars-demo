import { z } from 'zod'

export const authInput = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(8).max(256) })
export const planInput = z.object({ prompt: z.string().trim().min(1).max(4000) })
export const runInput = z.object({ planId: z.string().uuid(), idempotencyKey: z.string().uuid() })
