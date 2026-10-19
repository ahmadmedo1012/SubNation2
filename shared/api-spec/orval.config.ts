import { defineConfig, InputTransformerFn } from "orval";
import path from "path";
import { fileURLToPath } from "url";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(packageDir, "..", "..");
const apiClientReactSrc = path.resolve(root, "shared", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "shared", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      // orval 8 replaced the boolean `prettier: true` with a formatter enum.
      // Same effect, explicitly named.
      formatter: "prettier",
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        // The workspace pins @tanstack/react-query 5 (catalog ^5.90.21), but
        // the api-spec package itself does not depend on it, so orval cannot
        // detect the version and would fall back to v4 hook signatures
        // (breaks every frontend call site). Pin it.
        query: {
          version: 5,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      mode: "split",
      clean: true,
      formatter: "prettier",
      override: {
        zod: {
          // R172: the catalog moved to zod ^4.6.7 and this pin moved with
          // it. Deterministic emission stays the rule (R123-E2's root
          // cause was orval's 'auto' resolution falling back to whatever
          // syntax it guessed): `version: 4` pins zod-4-compatible
          // emission (z.looseObject, z.iso.datetime, two-arg z.record)
          // regardless of installed packages. NEVER move this and the
          // catalog pin independently of each other.
          version: 4,
          coerce: {
            query: ["boolean", "number", "string"],
            param: ["boolean", "number", "string"],
            body: ["bigint", "date"],
            response: ["bigint", "date"],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
