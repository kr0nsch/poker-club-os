// Russian translations (keys are the English UI strings), split by surface so
// that each area of the app owns its dictionary file.
import { ruActions } from "./i18n/ru-actions";
import { ruAdminConfig } from "./i18n/ru-admin-config";
import { ruAdminSystem } from "./i18n/ru-admin-system";
import { ruCommon } from "./i18n/ru-common";
import { ruFloor } from "./i18n/ru-floor";
import { ruPlayer } from "./i18n/ru-player";

export const ru: Record<string, string> = { ...ruActions, ...ruCommon,...ruAdminConfig, ...ruAdminSystem, ...ruPlayer, ...ruFloor };
