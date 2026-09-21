/**
 * 96-F2 (R96-A4 §1.3E) — usePublicAuthProviders settling exposure +
 * 97-F5 (J-1) whatsappFailed derivation.
 *
 * The hook derives `whatsappSettling` (96-F2) and `whatsappFailed`
 * (97-F5 / J-1 — backend 97-F3 passes the gateway's honest dead state
 * verbatim) from the live whatsapp_status probe so the login/register
 * pages can render honest hints before the user types a number.
 * These tests pin: the derivations, the absent-field legacy behavior
 * (older backends → null → no hint), and the soft-fail network path.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPublicAuthProvidersCacheForTests,
  usePublicAuthProviders,
} from "@/hooks/use-public-auth-providers";

const fetchMock = vi.fn();

function providersResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  fetchMock.mockReset();
  // R104 (AG2-5): the hook now rides a module-level 60 s single-flight
  // cache — reset it so each case observes ITS OWN mocked response.
  __resetPublicAuthProvidersCacheForTests();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePublicAuthProviders — whatsappSettling (96-F2 §1.3E)", () => {
  it('derives whatsappSettling=true when the probe reports "settling"', async () => {
    fetchMock.mockResolvedValueOnce(
      providersResponse({ whatsapp_enabled: true, whatsapp_status: "settling" }),
    );
    const { result } = renderHook(() => usePublicAuthProviders());

    await waitFor(() => expect(result.current.fetched).toBe(true));

    expect(result.current.whatsappEnabled).toBe(true);
    expect(result.current.whatsappStatus).toBe("settling");
    expect(result.current.whatsappSettling).toBe(true);
  });

  it("derives whatsappSettling=false for ready / other lifecycle statuses", async () => {
    fetchMock.mockResolvedValueOnce(
      providersResponse({ whatsapp_enabled: true, whatsapp_status: "ready" }),
    );
    const { result } = renderHook(() => usePublicAuthProviders());

    await waitFor(() => expect(result.current.fetched).toBe(true));

    expect(result.current.whatsappStatus).toBe("ready");
    expect(result.current.whatsappSettling).toBe(false);
  });

  it('97-F5 (J-1): derives whatsappFailed=true when the probe reports "failed"', async () => {
    fetchMock.mockResolvedValueOnce(
      providersResponse({ whatsapp_enabled: true, whatsapp_status: "failed" }),
    );
    const { result } = renderHook(() => usePublicAuthProviders());

    await waitFor(() => expect(result.current.fetched).toBe(true));

    expect(result.current.whatsappStatus).toBe("failed");
    expect(result.current.whatsappFailed).toBe(true);
    // Orthogonal flag: a dead channel is not "settling".
    expect(result.current.whatsappSettling).toBe(false);
  });

  it("97-F5 (J-1): whatsappFailed=false for ready / settling / qr_ready / absent statuses", async () => {
    for (const status of ["ready", "settling", "qr_ready", undefined]) {
      fetchMock.mockResolvedValueOnce(
        providersResponse(
          status === undefined
            ? { whatsapp_enabled: true }
            : { whatsapp_enabled: true, whatsapp_status: status },
        ),
      );
      const { result } = renderHook(() => usePublicAuthProviders());

      await waitFor(() => expect(result.current.fetched).toBe(true));

      expect(result.current.whatsappFailed).toBe(false);
    }
  });

  it("absent whatsapp_status (older backend) stays null and never settles", async () => {
    fetchMock.mockResolvedValueOnce(providersResponse({ whatsapp_enabled: true }));
    const { result } = renderHook(() => usePublicAuthProviders());

    await waitFor(() => expect(result.current.fetched).toBe(true));

    expect(result.current.whatsappStatus).toBeNull();
    expect(result.current.whatsappSettling).toBe(false);
  });

  it("network failure soft-fails with the safe defaults (Telegram/Google remain)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => usePublicAuthProviders());

    await waitFor(() => expect(result.current.fetched).toBe(true));

    expect(result.current.whatsappEnabled).toBe(false);
    expect(result.current.whatsappStatus).toBeNull();
    expect(result.current.whatsappSettling).toBe(false);
    expect(result.current.whatsappFailed).toBe(false);
  });
});
