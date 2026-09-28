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
