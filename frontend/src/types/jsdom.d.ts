/**
 * R126-L7 (T2 test-gate widening): minimal ambient typing for the `jsdom`
 * import in src/lib/__tests__/preload-gate.test.ts — the node-env suite
 * that executes the built preload-gate source inside fresh JSDOM windows.
 *
 * The workspace does not carry @types/jsdom (no installs in this lane);
 * this shim types exactly the surface that suite exercises: the
 * constructor (html + url/runScripts options), window.eval for the
 * hermetic gate execution, and window.document for the modulepreload
 * queries. Widen only if another suite needs more of the JSDOM API.
 */
declare module "jsdom" {
  export class JSDOM {
    constructor(
      html?: string,
      options?: {
        url?: string;
        runScripts?: "outside-only" | "dangerously" | boolean;
        pretendToBeVisual?: boolean;
      },
    );
    readonly window: {
      eval(code: string): unknown;
      document: Document;
    };
  }
}
