import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The deployment helper is deliberately dependency-free ESM.
import { officialStoreUrls, publicStoreAvailability } from "../scripts/prepare-website-store-links.mjs";
describe("official store destinations", () => {
  it("keeps badges unavailable while public store pages return 404", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ status: 404 });
    const stores = await publicStoreAvailability(fetchPage);
    expect(stores.appStore).toEqual({ url: officialStoreUrls.appStore, available: false });
    expect(stores.googlePlay).toEqual({ url: officialStoreUrls.googlePlay, available: false });
  });
  it("enables only the platform with a verified FamCall public page", async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'FamCall id6831551843' }).mockResolvedValueOnce({ status: 404 });
    const stores = await publicStoreAvailability(fetchPage);
    expect(stores.appStore.available).toBe(true);
    expect(stores.googlePlay.available).toBe(false);
  });
  it("refuses a generic page, another app, or an uncertain network response", async () => {
    await expect(publicStoreAvailability(vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'App Store' }))).rejects.toThrow('Unexpected');
    await expect(publicStoreAvailability(vi.fn().mockResolvedValue({ ok: false, status: 503 }))).rejects.toThrow('Cannot verify');
  });
});
