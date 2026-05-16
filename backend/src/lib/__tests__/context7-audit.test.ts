import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTEXT7_CITATION_MAX_LENGTH,
  TASK_5_2_CITATIONS,
  appendCitations,
  assertCitationValid,
  readCitationsFile,
  recordContext7Citation,
  recordTask5_2Citations,
  type Context7Citation,
} from "../audits/context7-audit";
import { createMcpInvocationRecorder, type McpInvocationRecord } from "../inspection-runner";

/**
 * Unit tests for the task 5.1 + 5.2 Context7 audit module.
 *
 * Validated invariants:
 *   - R10.4: every captured excerpt is ≤ 500 characters and tied to a
 *            stable HTTPS URL.
 *   - Property 22: every Context7 citation produces exactly one
 *                  `resolve-library-id` and one `query-docs`
 *                  `McpInvocationRecord`, with the resolved library id +
 *                  query text recorded in `paramsRedacted`.
 *   - The on-disk schema is forwards-compatible: appends keyed by `id`
 *     preserve prior history added by task 5.1.
 *
 * The PBT counterpart for Property 22 lives in the Phase 1 sub-task
 * 1.4*; this file covers the example-based contracts.
 */

describe("audits/context7-audit", () => {
  const stableNow = () => new Date("2025-05-15T22:00:00.000Z");
  const noSleep = async (_ms: number) => {
    /* deterministic */
  };

  let workdir: string;

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx7-audit-"));
  });

  afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true });
  });

  describe("R10.4 — verbatim length and URL invariant", () => {
    it("every TASK_5_2_CITATIONS entry is within 500 characters", () => {
      for (const c of TASK_5_2_CITATIONS) {
        expect(c.excerpt.length).toBeGreaterThan(0);
        expect(c.excerpt.length).toBeLessThanOrEqual(CONTEXT7_CITATION_MAX_LENGTH);
        expect(c.url).toMatch(/^https:\/\//);
      }
    });

    it("rejects a citation whose excerpt exceeds 500 characters", () => {
      const tooLong: Context7Citation = {
        id: "x:too-long",
        topic: "vite",
        libraryId: "/vitejs/vite",
        libraryName: "Vite",
        query: "q",
        excerpt: "x".repeat(CONTEXT7_CITATION_MAX_LENGTH + 1),
        url: "https://example.com/a",
        capturedAt: "2025-05-15T22:00:00.000Z",
      };
      expect(() => assertCitationValid(tooLong)).toThrow(RangeError);
    });

    it("rejects a citation with a non-HTTPS URL", () => {
      const insecure: Context7Citation = {
        id: "x:bad-url",
        topic: "vite",
        libraryId: "/vitejs/vite",
        libraryName: "Vite",
        query: "q",
        excerpt: "ok",
        url: "http://example.com/a",
        capturedAt: "2025-05-15T22:00:00.000Z",
      };
      expect(() => assertCitationValid(insecure)).toThrow(TypeError);
    });
  });

  describe("Property 22 — recorder integration", () => {
    it("records exactly one resolve + one query invocation per citation", async () => {
      const invocations: McpInvocationRecord[] = [];
      const recorder = createMcpInvocationRecorder(invocations, {
        sleep: noSleep,
        now: stableNow,
      });
      const filePath = path.join(workdir, "context7-citations.json");

      const written = await recordContext7Citation(
        recorder,
        {
          id: "lighthouse:test",
          topic: "lighthouse",
          libraryName: "Lighthouse CI",
          libraryId: "/googlechrome/lighthouse-ci",
          query: "categories:performance assertions",
          url: "https://github.com/googlechrome/lighthouse-ci/blob/main/docs/configuration.md",
          excerpt: "Assert the overall score of Lighthouse categories.",
        },
        { citationsFilePath: filePath, now: () => "2025-05-15T22:00:00.000Z" },
      );

      expect(invocations).toHaveLength(2);
      expect(invocations[0]).toMatchObject({
        server: "context7",
        tool: "resolve-library-id",
        paramsRedacted: {
          libraryName: "Lighthouse CI",
          query: "categories:performance assertions",
        },
        outputRef: "context7-citations#lighthouse:test:resolve",
        retries: 0,
      });
      expect(invocations[1]).toMatchObject({
        server: "context7",
        tool: "query-docs",
        paramsRedacted: {
          libraryId: "/googlechrome/lighthouse-ci",
          query: "categories:performance assertions",
        },
        outputRef: "context7-citations#lighthouse:test:query",
        retries: 0,
      });

      const parsed = await readCitationsFile(filePath);
      expect(parsed.citations).toHaveLength(1);
      expect(parsed.citations[0]).toMatchObject({
        id: "lighthouse:test",
        topic: "lighthouse",
        libraryId: "/googlechrome/lighthouse-ci",
      });
      expect(written.id).toBe("lighthouse:test");
    });

    it("records 11 citations (22 invocations) when seeding task 5.2", async () => {
      const invocations: McpInvocationRecord[] = [];
      const recorder = createMcpInvocationRecorder(invocations, {
        sleep: noSleep,
        now: stableNow,
      });
      const filePath = path.join(workdir, "context7-citations.json");

      const written = await recordTask5_2Citations(recorder, {
        citationsFilePath: filePath,
        now: () => "2025-05-15T22:00:00.000Z",
      });

      expect(written).toHaveLength(TASK_5_2_CITATIONS.length);
      expect(invocations).toHaveLength(TASK_5_2_CITATIONS.length * 2);

      // Property 22 — every invocation carries the recorded fields.
      for (const r of invocations) {
        expect(r.server).toBe("context7");
        expect(["resolve-library-id", "query-docs"]).toContain(r.tool);
        expect(typeof r.invokedAt).toBe("string");
        expect(r.retries).toBe(0);
      }

      // Topic coverage required by R1.5 / task 5.2.
      const topics = new Set(written.map((c) => c.topic));
      for (const t of ["lighthouse", "schema-org", "react", "vite"] as const) {
        expect(topics.has(t)).toBe(true);
      }
    });
  });

  describe("append idempotency", () => {
    it("preserves prior history when a new citation is appended", async () => {
      const filePath = path.join(workdir, "context7-citations.json");

      const prior: Context7Citation = {
        id: "sentry:before-send",
        topic: "sentry",
        libraryId: "/websites/sentry_io_platforms_javascript_guides_node",
        libraryName: "Sentry Node.js",
        query: "beforeSend",
        excerpt:
          "The beforeSend callback allows you to inspect and modify events before they are sent.",
        url: "https://docs.sentry.io/platforms/javascript/guides/node/configuration/filtering",
        capturedAt: "2025-05-15T20:00:00.000Z",
      };
      await appendCitations(filePath, [prior]);

      const next: Context7Citation = {
        id: "vite:manual-chunks",
        topic: "vite",
        libraryId: "/vitejs/vite",
        libraryName: "Vite",
        query: "manualChunks",
        excerpt:
          "Shows how to use manualChunks() function to manually split code into separate chunks.",
        url: "https://github.com/vitejs/vite/blob/main/vite/playground/css/vite.config.js",
        capturedAt: "2025-05-15T22:00:00.000Z",
      };
      const merged = await appendCitations(filePath, [next]);

      expect(merged.citations).toHaveLength(2);
      const ids = merged.citations.map((c) => c.id).sort();
      expect(ids).toEqual(["sentry:before-send", "vite:manual-chunks"]);
    });

    it("overwrites a prior citation with the same id (idempotent re-run)", async () => {
      const filePath = path.join(workdir, "context7-citations.json");
      const v1: Context7Citation = {
        id: "lighthouse:lhci-recommended-preset",
        topic: "lighthouse",
        libraryId: "/googlechrome/lighthouse-ci",
        libraryName: "Lighthouse CI",
        query: "q1",
        excerpt: "v1 excerpt",
        url: "https://example.com/lhci",
        capturedAt: "2025-05-15T20:00:00.000Z",
      };
      const v2: Context7Citation = { ...v1, excerpt: "v2 excerpt" };
      await appendCitations(filePath, [v1]);
      const merged = await appendCitations(filePath, [v2]);
      expect(merged.citations).toHaveLength(1);
      expect(merged.citations[0]?.excerpt).toBe("v2 excerpt");
    });
  });
});
