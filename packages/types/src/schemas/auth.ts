import { z } from "zod";
import { DEVICE_TYPES } from "../enums.js";
import { NonEmptyTrimmed, Slug } from "./common.js";

export const Password = z.string().min(10, "at least 10 characters").max(256);

export const LoginInput = z.object({
  email: z.email().max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(256),
  organizationSlug: Slug.optional(),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const SetupInput = z.object({
  setupToken: z.string().min(16).max(200),
  organization: z.object({ name: NonEmptyTrimmed(120), slug: Slug }),
  venue: z.object({
    name: NonEmptyTrimmed(120),
    slug: Slug,
    timezone: z.string().min(1).max(64).default("Europe/Berlin"),
    localHostname: z.string().trim().max(253).optional(),
  }),
  edgeNode: z.object({ name: NonEmptyTrimmed(120) }),
  admin: z.object({
    email: z.email().max(254).transform((v) => v.toLowerCase()),
    displayName: NonEmptyTrimmed(120),
    password: Password,
  }),
});
export type SetupInput = z.infer<typeof SetupInput>;

export const PlayerSignupInput = z.object({
  organizationSlug: Slug,
  email: z.email().max(254).transform((v) => v.toLowerCase()),
  password: Password,
  firstName: NonEmptyTrimmed(80),
  lastName: NonEmptyTrimmed(80),
  nickname: z.string().trim().max(40).optional(),
  phone: z.string().trim().max(32).optional(),
  marketingConsent: z.boolean().default(false),
  acceptPrivacyPolicy: z.literal(true),
});
export type PlayerSignupInput = z.infer<typeof PlayerSignupInput>;

export const SwitchOrganizationInput = z.object({ organizationId: z.uuid() });

export const DeviceHello = z.object({
  deviceId: z.uuid(),
  deviceType: z.enum(DEVICE_TYPES).optional(),
  appVersion: z.string().max(40).optional(),
});
export type DeviceHello = z.infer<typeof DeviceHello>;

export const StaffCreateInput = z.object({
  email: z.email().max(254).transform((v) => v.toLowerCase()),
  displayName: NonEmptyTrimmed(120),
  password: Password,
  roles: z.array(z.string().min(2).max(64)).min(1).max(10),
  venueIds: z.array(z.uuid()).nullable().default(null),
});
export type StaffCreateInput = z.infer<typeof StaffCreateInput>;

export const StaffUpdateInput = z.object({
  displayName: NonEmptyTrimmed(120).optional(),
  roles: z.array(z.string().min(2).max(64)).min(1).max(10).optional(),
  venueIds: z.array(z.uuid()).nullable().optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  password: Password.optional(),
});
export type StaffUpdateInput = z.infer<typeof StaffUpdateInput>;

export const ChangePasswordInput = z.object({ currentPassword: z.string().min(1).max(256), newPassword: Password });
