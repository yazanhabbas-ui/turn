import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, brandAssets } from "@/db/schema";
import type { Actor } from "@/server/admin/actor";
import { LOGO_MAX_BYTES, loadLogo, removeLogo, setLogo } from "@/server/admin/logo";
import { AppError } from "@/server/http/errors";
import { getSetting } from "@/server/settings/service";
import { actorFor, resetDemo } from "./fixtures";
import { prepareTestDatabase } from "./helpers";

const available = await prepareTestDatabase();

async function expectCode(p: Promise<unknown>, code: string, reason?: string) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof AppError && e.code === code && (!reason || e.details?.reason === reason),
  );
}

/** A transparent png: a red disc on a fully transparent background. */
const transparent = (w = 300, h = 100) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${h}" height="${h}"><circle cx="${h / 2}" cy="${h / 2}" r="${h / 2 - 4}" fill="red"/></svg>`,
        ),
        left: 100,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

describe.runIf(available)("uploaded logo (database)", () => {
  let admin: Actor;
  let cityAdmin: Actor;
  let agent: Actor;

  beforeEach(async () => {
    await resetDemo();
    admin = await actorFor("admin@dor.local");
    cityAdmin = await actorFor("damascus.admin@dor.local");
    agent = await actorFor("khalid@dor.local");
  });
  afterAll(async () => {
    await pool().end();
  });

  it("keeps transparency, never upscales, points branding.logoUrl at the version and audits", async () => {
    const res = await setLogo(admin, await transparent());
    expect(res.version).toBe(1);
    expect(res.logoUrl).toBe("/api/v1/public/branding/logo?v=1");
    const stored = await loadLogo(admin.auth.user.organizationId);
    expect(stored?.contentType).toBe("image/png");
    const meta = await sharp(stored!.data).metadata();
    expect(meta).toMatchObject({ format: "png", width: 300, height: 100, hasAlpha: true });
    const { data, info } = await sharp(stored!.data).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // top-left corner is still fully transparent
    expect(info.channels).toBe(4);
    const branding = await getSetting(admin.auth.user.organizationId, "branding");
    expect(branding.logoUrl).toBe(res.logoUrl);
    expect((await setLogo(admin, await transparent())).version).toBe(2);
    const actions = (await db().select({ a: auditLogs.action }).from(auditLogs)).map((r) => r.a);
    expect(actions).toContain("branding.logo_set");
  });

  it("fits large images inside 1200x480", async () => {
    await setLogo(admin, await transparent(3000, 1000));
    const stored = await loadLogo(admin.auth.user.organizationId);
    const meta = await sharp(stored!.data).metadata();
    expect(meta.width).toBeLessThanOrEqual(1200);
    expect(meta.height).toBeLessThanOrEqual(480);
    expect(meta.width! / meta.height!).toBeCloseTo(3, 1);
    expect(meta.hasAlpha).toBe(true);
  });

  it("accepts the 15499x5947 original and stores it small", async () => {
    const file = await readFile("assets/yallago.logo.png").catch(() => null);
    if (!file) return;
    await setLogo(admin, file);
    const stored = await loadLogo(admin.auth.user.organizationId);
    expect(stored!.data.length).toBeLessThan(700 * 1024);
    const meta = await sharp(stored!.data).metadata();
    expect(meta.width).toBeLessThanOrEqual(1200);
  });

  it("refuses non-images, svg, empty and oversize files", async () => {
    await expectCode(setLogo(admin, Buffer.from("hello world")), "validation", "unsupported_type");
    await expectCode(
      setLogo(admin, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>1</script></svg>')),
      "validation",
      "unsupported_type",
    );
    await expectCode(setLogo(admin, Buffer.alloc(0)), "validation", "empty");
    await expectCode(setLogo(admin, Buffer.alloc(LOGO_MAX_BYTES + 1)), "validation", "too_large");
    expect(await db().select().from(brandAssets)).toHaveLength(0);
  });

  it("is only for settings.manage across the organization", async () => {
    const png = await transparent();
    await expectCode(setLogo(cityAdmin, png), "forbidden");
    await expectCode(setLogo(agent, png), "forbidden");
    await expectCode(removeLogo(cityAdmin), "forbidden");
  });

  it("removes the logo and clears logoUrl", async () => {
    await setLogo(admin, await transparent());
    await removeLogo(admin);
    expect(await loadLogo(admin.auth.user.organizationId)).toBeNull();
    expect((await getSetting(admin.auth.user.organizationId, "branding")).logoUrl).toBeNull();
    expect(await db().select().from(brandAssets).where(eq(brandAssets.kind, "logo"))).toHaveLength(0);
  });
});
