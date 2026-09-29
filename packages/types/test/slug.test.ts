import { describe, expect, it } from "vitest";
import { slugify } from "../src/slug.js";

describe("slugify", () => {
  it("transliterates Russian names instead of dropping them", () => {
    expect(slugify("Главный зал")).toBe("glavnyy-zal");
    expect(slugify("Воскресный Мейн-ивент 2026")).toBe("voskresnyy-meyn-ivent-2026");
    expect(slugify("Щука и ёж")).toBe("shchuka-i-ezh");
  });

  it("keeps Latin names readable", () => {
    expect(slugify("Sunday Main Event")).toBe("sunday-main-event");
    expect(slugify("  Café — Bounty!  ")).toBe("cafe-bounty");
  });

  it("produces valid slugs within the length limit", () => {
    const s = slugify("очень ".repeat(30), 20);
    expect(s.length).toBeLessThanOrEqual(20);
    expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(slugify("★ ★ ★")).toBe("");
  });
});
