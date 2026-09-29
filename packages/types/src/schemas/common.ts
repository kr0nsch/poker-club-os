import { z } from "zod";

export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

export const IsoDateTime = z.iso.datetime({ offset: true });

export const Slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and dashes only");

export const NonEmptyTrimmed = (max = 200) => z.string().trim().min(1).max(max);
export const OptionalTrimmed = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();

export const Money = z.object({
  amount: z.number().int().min(0).max(1_000_000_000),
  fee: z.number().int().min(0).max(1_000_000_000).default(0),
  currency: z.string().length(3).default("EUR"),
});
export type Money = z.infer<typeof Money>;

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ReasonInput = z.object({ reason: z.string().trim().min(3).max(500) });

type WithoutDefault<S> = S extends z.ZodDefault<infer I> ? I : S;
export type PatchShape<T extends z.ZodRawShape> = { [K in keyof T]: z.ZodOptional<WithoutDefault<T[K]> & z.ZodType> };

/**
 * Shape for PATCH bodies: every field optional and top-level defaults removed.
 * (`.partial()` alone is not enough — Zod 4 applies defaults inside optional,
 * so an omitted field would be silently reset to its default.)
 */
export function patchShape<T extends z.ZodRawShape>(shape: T): PatchShape<T> {
  const out: Record<string, z.ZodType> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const inner = schema instanceof z.ZodDefault ? (schema.unwrap() as z.ZodType) : (schema as z.ZodType);
    out[key] = inner.optional();
  }
  return out as PatchShape<T>;
}
