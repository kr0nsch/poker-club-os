import type { HandlerMap } from "../executor.js";
import { clockHandlers } from "./clock.js";
import { dealerHandlers } from "./dealer.js";
import { eliminationHandlers } from "./elimination.js";
import { entryHandlers } from "./entries.js";
import { lifecycleHandlers } from "./lifecycle.js";
import { registrationHandlers } from "./registration.js";
import { seatingHandlers } from "./seating.js";

/** Every command type must have exactly one handler (enforced by the HandlerMap type). */
export const HANDLERS: HandlerMap = {
  ...lifecycleHandlers,
  ...clockHandlers,
  ...registrationHandlers,
  ...entryHandlers,
  ...seatingHandlers,
  ...eliminationHandlers,
  ...dealerHandlers,
};
