import { adjustClock, nextLevel, previousLevel, setLevel, setRemaining } from "@pcos/domain";
import { conflict } from "../../errors.js";
import type { CommandContext } from "../context.js";
import type { Handler } from "../executor.js";
import { levelLikes } from "../repo.js";

/**
 * Level-relative commands carry the level the operator saw. If the clock has
 * moved on (auto-advance or another device), reject instead of guessing.
 */
function assertSameLevel(ctx: CommandContext, fromLevelIndex: number | undefined) {
  if (fromLevelIndex == null) return;
  if (ctx.derived.levelIndex !== fromLevelIndex) {
    throw conflict(`the clock is now at level index ${ctx.derived.levelIndex} (you acted on ${fromLevelIndex}); review and retry`, ctx.tournament.version);
  }
}

const describe = (ctx: CommandContext) => (ctx.derived.isBreak ? "break" : `level ${ctx.derived.playLevelNumber}`);

export const clockHandlers = {
  NEXT_LEVEL: (async (ctx, payload) => {
    assertSameLevel(ctx, payload.fromLevelIndex);
    const before = ctx.clock;
    ctx.setClock(nextLevel(ctx.clock, levelLikes(ctx.levels), ctx.nowMs));
    ctx.touch("clock");
    ctx.summary(`Advanced to ${describe(ctx)}`);
    return { clockBefore: before, levelIndex: ctx.clock.levelIndex };
  }) satisfies Handler<"NEXT_LEVEL">,

  PREVIOUS_LEVEL: (async (ctx, payload) => {
    assertSameLevel(ctx, payload.fromLevelIndex);
    const before = ctx.clock;
    ctx.setClock(previousLevel(ctx.clock, levelLikes(ctx.levels), ctx.nowMs));
    ctx.touch("clock");
    ctx.summary(`Back to ${describe(ctx)}`);
    return { clockBefore: before, levelIndex: ctx.clock.levelIndex };
  }) satisfies Handler<"PREVIOUS_LEVEL">,

  SET_LEVEL: (async (ctx, payload) => {
    const before = ctx.clock;
    ctx.setClock(setLevel(ctx.clock, levelLikes(ctx.levels), payload.levelIndex, ctx.nowMs));
    ctx.touch("clock");
    ctx.summary(`Clock set to ${describe(ctx)}`);
    return { clockBefore: before, levelIndex: payload.levelIndex };
  }) satisfies Handler<"SET_LEVEL">,

  ADJUST_CLOCK: (async (ctx, payload) => {
    assertSameLevel(ctx, payload.fromLevelIndex);
    const before = ctx.clock;
    ctx.setClock(adjustClock(ctx.clock, levelLikes(ctx.levels), payload.deltaSeconds * 1000, ctx.nowMs));
    ctx.touch("clock");
    ctx.summary(`${payload.deltaSeconds >= 0 ? "Added" : "Removed"} ${Math.abs(payload.deltaSeconds)}s`);
    return { clockBefore: before };
  }) satisfies Handler<"ADJUST_CLOCK">,

  SET_REMAINING: (async (ctx, payload) => {
    assertSameLevel(ctx, payload.fromLevelIndex);
    const before = ctx.clock;
    ctx.setClock(setRemaining(ctx.clock, levelLikes(ctx.levels), payload.remainingSeconds * 1000, ctx.nowMs));
    ctx.touch("clock");
    ctx.summary(`Remaining time set to ${payload.remainingSeconds}s`);
    return { clockBefore: before };
  }) satisfies Handler<"SET_REMAINING">,
};
