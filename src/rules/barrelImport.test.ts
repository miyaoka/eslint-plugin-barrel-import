import { describe, test } from "bun:test";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";

import rule from "./barrelImport";

// Wire bun:test into RuleTester
RuleTester.describe = describe;
RuleTester.it = test;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

const BASE = "/project/apps/renderer/src";

/** Shared scope config for tests (scopes is a required option) */
const DEFAULT_SCOPES = {
  shared: { directories: ["shared"], dependsOn: [] as string[], isolateModules: true },
  features: { directories: ["features"], dependsOn: ["shared"] },
};

/**
 * Test directory structure:
 *
 * src/
 * ├── App.vue
 * ├── features/
 * │   ├── feat-A/
 * │   │   ├── index.ts                    ← barrel
 * │   │   ├── CompA.vue
 * │   │   └── storeA.ts
 * │   ├── feat-B/
 * │   │   ├── index.ts                    ← barrel
 * │   │   ├── index.vue
 * │   │   ├── CompB.vue
 * │   │   ├── utils.ts
 * │   │   └── features/
 * │   │       ├── feat-B-child-A/
 * │   │       │   ├── index.ts            ← barrel
 * │   │       │   ├── CompBA.vue
 * │   │       │   └── features/
 * │   │       │       └── feat-B-grandchild/
 * │   │       │           ├── index.ts    ← barrel
 * │   │       │           └── internal.ts
 * │   │       ├── feat-B-child-B/
 * │   │       │   ├── index.ts            ← barrel
 * │   │       │   └── CompBB.vue
 * │   │       └── common/
 * │   │           ├── index.ts            ← barrel
 * │   │           └── helperB.ts
 * │   ├── feat-C/
 * │   │   └── storeC.ts
 * │   └── feat-D/
 * │       ├── index.ts                    ← barrel
 * │       └── features/
 * │           └── common/                 ← same-named child feature as feat-B
 * │               ├── index.ts            ← barrel
 * │               └── helperD.ts
 * └── shared/
 *     ├── shared-A/
 *     │   ├── index.ts                    ← barrel
 *     │   └── implA.ts
 *     └── shared-B/
 *         ├── useB.ts
 *         └── otherB.ts
 */

tester.run("barrel-import", rule, {
  valid: [
    // ─── Cross-feature: via barrel ──────────────────
    {
      // feat-A/CompA.vue → feat-B/ (barrel)
      name: "OK: cross-feature via barrel",
      code: 'import { CompB } from "../feat-B";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },
    {
      // feat-A/CompA.vue → feat-B/index.ts (explicit barrel)
      name: "OK: cross-feature via barrel (explicit index.ts)",
      code: 'import { CompB } from "../feat-B/index.ts";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },
    {
      // feat-A/CompA.vue → feat-B/ (barrel re-export)
      name: "OK: re-export via barrel",
      code: 'export { CompB } from "../feat-B";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── Parent → child feature: via barrel ─────────
    {
      // feat-B/CompB.vue → feat-B/features/feat-B-child-A/ (barrel)
      name: "OK: parent feature → child feature via barrel",
      code: 'import { CompBA } from "./features/feat-B-child-A";',
      filename: `${BASE}/features/feat-B/CompB.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },
    {
      // feat-B/CompB.vue → feat-B/features/feat-B-child-A/features/feat-B-grandchild/ (barrel)
      name: "OK: parent feature → grandchild feature via barrel",
      code: 'import { deep } from "./features/feat-B-child-A/features/feat-B-grandchild";',
      filename: `${BASE}/features/feat-B/CompB.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── Within same scope ──────────────────────────
    {
      // feat-B/CompB.vue → feat-B/utils.ts
      name: "OK: within same feature",
      code: 'import { helper } from "./utils";',
      filename: `${BASE}/features/feat-B/CompB.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },
    {
      // feat-B-child-B/CompBB.vue → feat-B-child-B/OtherBB.vue (within same child feature)
      name: "OK: files within same child feature",
      code: 'import OtherBB from "./OtherBB.vue";',
      filename: `${BASE}/features/feat-B/features/feat-B-child-B/CompBB.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── Child → parent scope ───────────────────────
    {
      // feat-B-child-B/CompBB.vue → feat-B/utils.ts
      name: "OK: child feature accessing parent feature internal file",
      code: 'import { helper } from "../../utils";',
      filename: `${BASE}/features/feat-B/features/feat-B-child-B/CompBB.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── Cross child features: via barrel ──────────
    {
      // feat-B-child-B/CompBB.vue → feat-B/features/feat-B-child-A/ (barrel)
      name: "OK: cross child features via barrel",
      code: 'import { CompBA } from "../feat-B-child-A";',
      filename: `${BASE}/features/feat-B/features/feat-B-child-B/CompBB.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── Child → external feature: via barrel ───────
    {
      // feat-B-child-A/CompBA.vue → feat-A/ (barrel)
      name: "OK: child feature → external feature via barrel",
      code: 'import { CompA } from "../../../feat-A";',
      filename: `${BASE}/features/feat-B/features/feat-B-child-A/CompBA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── shared ─────────────────────────────────────
    {
      // feat-A/CompA.vue → shared-A/ (barrel)
      name: "OK: feature → shared via barrel",
      code: 'import { implA } from "../../shared/shared-A";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── shared → shared: within same module ────────
    {
      // shared-B/useB.ts → shared-B/otherB.ts (within same module)
      name: "OK: within same shared module",
      code: 'import { otherB } from "./otherB";',
      filename: `${BASE}/shared/shared-B/useB.ts`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── App.vue (outside scope) ────────────────────
    {
      // App.vue → shared-A/ (barrel)
      name: "OK: App.vue → shared via barrel",
      code: 'import { implA } from "./shared/shared-A";',
      filename: `${BASE}/App.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },
    {
      // App.vue → feat-A/ (barrel)
      name: "OK: App.vue → feature via barrel",
      code: 'import { CompA } from "./features/feat-A";',
      filename: `${BASE}/App.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── index.tsx barrel ───────────────────────────
    {
      // feat-A/CompA.vue → feat-B/index.tsx (tsx allowed by default)
      name: "OK: cross-feature via barrel (explicit index.tsx)",
      code: 'import { CompB } from "../feat-B/index.tsx";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── barrelFiles option ─────────────────────────
    {
      // barrelFiles includes index.js → explicit index.js allowed
      name: "OK: barrelFiles option allows index.js",
      code: 'import { CompB } from "../feat-B/index.js";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES, barrelFiles: ["index.ts", "index.tsx", "index.js"] }],
    },
    {
      // Extensionless directory import is always allowed regardless of barrelFiles
      name: "OK: extensionless directory import always allowed regardless of barrelFiles",
      code: 'import { CompB } from "../feat-B";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES, barrelFiles: ["index.js"] }],
    },

    // ─── External packages ──────────────────────────
    {
      name: "OK: external packages are skipped",
      code: 'import { ref } from "vue";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── shared/ subdirectory inside feature is not a scope ─
    {
      // features/feat-B/components/shared/ is not directly under feat-B, so not recognized as scope
      name: "OK: shared/ subdirectory inside feature is not a scope (within same feature)",
      code: 'import TrendIndicator from "../shared/TrendIndicator.vue";',
      filename: `${BASE}/features/feat-B/components/charts/DeviceChart.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },
    {
      // Access to shared/ from another path within the same feature is also free
      name: "OK: shared/ subdirectory inside feature is not a scope (from another subdirectory)",
      code: 'import TrendIndicator from "../shared/TrendIndicator.vue";',
      filename: `${BASE}/features/feat-B/components/v1/InsightList.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },

    // ─── shared/ directly under feature works as scope ─
    {
      // features/feat-B/shared/utils/ is directly under feat-B, so recognized as scope
      name: "OK: shared/ directly under feature is a scope (via barrel)",
      code: 'import { helper } from "./shared/utils";',
      filename: `${BASE}/features/feat-B/CompB.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },
  ],
  invalid: [
    // ─── Cross-feature: direct internal file ────────
    {
      // feat-A/CompA.vue → feat-B/storeB.ts
      name: "NG: direct import of internal module across features",
      code: 'import { storeB } from "../feat-B/storeB";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },

    // ─── External → child feature direct reference ──
    {
      // feat-A/CompA.vue → feat-B/features/feat-B-child-A/ (even via barrel is forbidden)
      name: "NG: external feature → child feature of another feature",
      code: 'import { CompBA } from "../feat-B/features/feat-B-child-A";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },
    {
      // feat-A/CompA.vue → feat-B/features/feat-B-child-A/index.ts (explicit index.ts also forbidden)
      name: "NG: external feature → child feature explicit index.ts",
      code: 'import { CompBA } from "../feat-B/features/feat-B-child-A/index.ts";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },
    {
      // App.vue → feat-B/features/feat-B-child-A/ (even via barrel is forbidden)
      name: "NG: App.vue → child feature direct reference",
      code: 'import { CompBA } from "./features/feat-B/features/feat-B-child-A";',
      filename: `${BASE}/App.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },
    {
      // App.vue → feat-B/features/feat-B-child-A/index.ts (explicit index.ts also forbidden)
      name: "NG: App.vue → child feature explicit index.ts",
      code: 'import { CompBA } from "./features/feat-B/features/feat-B-child-A/index.ts";',
      filename: `${BASE}/App.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },

    // ─── Parent → child feature: direct internal ────
    {
      // feat-B/CompB.vue → feat-B-child-A/CompBA.vue
      name: "NG: parent feature → child feature direct internal import",
      code: 'import CompBA from "./features/feat-B-child-A/CompBA.vue";',
      filename: `${BASE}/features/feat-B/CompB.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },
    {
      // feat-B/CompB.vue → feat-B-grandchild/internal.ts
      name: "NG: parent feature → grandchild feature direct internal import",
      code: 'import { internalOnly } from "./features/feat-B-child-A/features/feat-B-grandchild/internal";',
      filename: `${BASE}/features/feat-B/CompB.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },

    // ─── Cross child features: direct internal ──────
    {
      // feat-B-child-B/CompBB.vue → feat-B-child-A/CompBA.vue
      name: "NG: direct import across child features",
      code: 'import CompBA from "../feat-B-child-A/CompBA.vue";',
      filename: `${BASE}/features/feat-B/features/feat-B-child-B/CompBB.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },

    // ─── Prevent false positive for same-named child features ─
    {
      // feat-B/features/common/helperB.ts → feat-D/features/common/helperD.ts
      // Same-named child feature "common" under different parents (feat-B, feat-D)
      // must not be treated as the same scope
      name: "NG: direct import to same-named child feature under different parent",
      code: 'import { helperD } from "../../../../feat-D/features/common/helperD";',
      filename: `${BASE}/features/feat-B/features/common/helperB.ts`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },

    // ─── Cross-scope dependency forbidden ───────────
    {
      // shared-B/otherB.ts → feat-A/ (even via barrel is forbidden)
      name: "NG: shared → features (not in dependsOn)",
      code: 'import { CompA } from "../../features/feat-A";',
      filename: `${BASE}/shared/shared-B/otherB.ts`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDependency" }],
    },

    // ─── Cross-module dependency within shared ──────
    {
      // shared-B/useB.ts → shared-A/ (even via barrel is forbidden)
      name: "NG: shared → shared (cross-module forbidden by isolateModules)",
      code: 'import { implA } from "../shared-A";',
      filename: `${BASE}/shared/shared-B/useB.ts`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noCrossModuleDependency" }],
    },

    // ─── shared: direct internal file ───────────────
    {
      // feat-A/CompA.vue → shared-A/implA.ts
      name: "NG: direct import of shared internal module",
      code: 'import { implA } from "../../shared/shared-A/implA";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },

    // ─── App.vue → direct internal file ─────────────
    {
      // App.vue → feat-C/storeC.ts
      name: "NG: App.vue → direct import of feature internal module",
      code: 'import { storeC } from "./features/feat-C/storeC";',
      filename: `${BASE}/App.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },

    // ─── Re-export of direct internal reference ─────
    {
      // feat-A/CompA.vue → feat-B/storeB.ts
      name: "NG: export {} direct re-export of internal module",
      code: 'export { storeB } from "../feat-B/storeB";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },
    {
      // feat-A/CompA.vue → feat-B/storeB.ts
      name: "NG: export * direct re-export of internal module",
      code: 'export * from "../feat-B/storeB";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },

    // ─── Files not in barrelFiles are not barrels ───
    {
      // feat-A/CompA.vue → feat-B/index.vue (not allowed by default)
      name: "NG: index.vue is not a barrel file",
      code: 'import FeatBIndex from "../feat-B/index.vue";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },
    {
      // feat-A/CompA.vue → feat-B/index.js (not allowed by default)
      name: "NG: index.js is not a barrel file by default",
      code: 'import { CompB } from "../feat-B/index.js";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },

    // ─── barrelFiles option: child feature restriction ─
    {
      // Even with barrelFiles allowing index.js, external → child feature index.js is forbidden
      name: "NG: barrelFiles allows index.js but external → child feature is still forbidden",
      code: 'import { CompBA } from "../feat-B/features/feat-B-child-A/index.js";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES, barrelFiles: ["index.ts", "index.tsx", "index.js"] }],
      errors: [{ messageId: "noDirectImport" }],
    },

    // ─── File with same name as scope is not a barrel ─
    {
      // feat-A/CompA.vue → feat-B/feat-B (points to feat-B.ts, not a barrel)
      name: "NG: .ts file with same name as scope is not a barrel",
      code: 'import { main } from "../feat-B/feat-B";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },

    // ─── Dynamic import() direct internal reference ─
    {
      // feat-A/CompA.vue → feat-B/storeB (dynamic import)
      name: "NG: dynamic import() direct internal module import",
      code: 'const mod = import("../feat-B/storeB");',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },
    {
      // feat-A/CompA.vue → feat-B/storeB (template literal)
      name: "NG: dynamic import() template literal direct internal module import",
      code: "const mod = import(`../feat-B/storeB`);",
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },
  ],
});

/**
 * Test directory structure for custom scopes:
 *
 * src/
 * ├── modules/
 * │   ├── mod-A/
 * │   │   └── CompA.vue
 * │   └── mod-B/
 * │       └── storeB.ts
 * ├── common/
 * │   └── common-A/
 * │       └── utilA.ts
 * └── core/
 *     └── core-A/
 *         └── base.ts
 */

const CUSTOM_SCOPES = {
  core: { directories: ["core"], dependsOn: [] as string[] },
  common: { directories: ["common"], dependsOn: ["core"] },
  modules: { directories: ["modules"], dependsOn: ["common", "core"] },
};

tester.run("barrel-import (custom scopes)", rule, {
  valid: [
    {
      // modules → common (listed in dependsOn)
      name: "OK: modules → common via barrel",
      code: 'import { utilA } from "../../common/common-A";',
      filename: `${BASE}/modules/mod-A/CompA.vue`,
      options: [{ scopes: CUSTOM_SCOPES }],
    },
    {
      // modules → core (listed in dependsOn)
      name: "OK: modules → core via barrel",
      code: 'import { base } from "../../core/core-A";',
      filename: `${BASE}/modules/mod-A/CompA.vue`,
      options: [{ scopes: CUSTOM_SCOPES }],
    },
    {
      // common → core (listed in dependsOn)
      name: "OK: common → core via barrel",
      code: 'import { base } from "../../core/core-A";',
      filename: `${BASE}/common/common-A/utilA.ts`,
      options: [{ scopes: CUSTOM_SCOPES }],
    },
  ],
  invalid: [
    {
      // common → modules (not in dependsOn)
      name: "NG: common → modules (dependency forbidden)",
      code: 'import { CompA } from "../../modules/mod-A";',
      filename: `${BASE}/common/common-A/utilA.ts`,
      options: [{ scopes: CUSTOM_SCOPES }],
      errors: [{ messageId: "noDependency" }],
    },
    {
      // core → modules (not in dependsOn)
      name: "NG: core → modules (dependency forbidden)",
      code: 'import { CompA } from "../../modules/mod-A";',
      filename: `${BASE}/core/core-A/base.ts`,
      options: [{ scopes: CUSTOM_SCOPES }],
      errors: [{ messageId: "noDependency" }],
    },
    {
      // core → common (not in dependsOn)
      name: "NG: core → common (dependency forbidden)",
      code: 'import { utilA } from "../../common/common-A";',
      filename: `${BASE}/core/core-A/base.ts`,
      options: [{ scopes: CUSTOM_SCOPES }],
      errors: [{ messageId: "noDependency" }],
    },
    {
      // Direct internal import is forbidden even with custom scopes
      name: "NG: direct internal module import with custom scopes",
      code: 'import { storeB } from "../mod-B/storeB";',
      filename: `${BASE}/modules/mod-A/CompA.vue`,
      options: [{ scopes: CUSTOM_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },
  ],
});

// ─── Aliases option tests ───────────────────────

/**
 * Alias tests use absolute paths.
 * In actual eslint.config.ts, use import.meta.dirname to convert to absolute paths.
 */
const ALIAS_OPTIONS = {
  scopes: DEFAULT_SCOPES,
  aliases: { "@": `${BASE}` },
};

tester.run("barrel-import (aliases)", rule, {
  valid: [
    {
      // Alias-based barrel import
      name: "OK: feature barrel import via alias",
      code: 'import { CompA } from "@/features/feat-A";',
      filename: `${BASE}/components/SomeComponent.vue`,
      options: [ALIAS_OPTIONS],
    },
    {
      // Alias-based shared barrel import
      name: "OK: shared barrel import via alias",
      code: 'import { implA } from "@/shared/shared-A";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [ALIAS_OPTIONS],
    },
    {
      // Alias-based barrel import from within a feature
      name: "OK: barrel import of another feature via alias from within a feature",
      code: 'import { CompB } from "@/features/feat-B";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [ALIAS_OPTIONS],
    },
    {
      // External packages not matching alias are skipped
      name: "OK: external packages not matching alias are skipped",
      code: 'import { ref } from "vue";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [ALIAS_OPTIONS],
    },
  ],
  invalid: [
    {
      // Direct internal import via alias is forbidden
      name: "NG: direct internal module import via alias",
      code: 'import { storeB } from "@/features/feat-B/storeB";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [ALIAS_OPTIONS],
      errors: [{ messageId: "noDirectImport" }],
    },
    {
      // Direct child feature reference via alias is forbidden
      name: "NG: direct child feature reference via alias",
      code: 'import { CompBA } from "@/features/feat-B/features/feat-B-child-A";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [ALIAS_OPTIONS],
      errors: [{ messageId: "noDirectImport" }],
    },
    {
      // Direct internal import of shared via alias is forbidden
      name: "NG: direct shared internal module import via alias",
      code: 'import { implA } from "@/shared/shared-A/implA";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [ALIAS_OPTIONS],
      errors: [{ messageId: "noDirectImport" }],
    },
  ],
});

// ─── Aliases (cwd-relative) tests ───────────────

const CWD_RELATIVE_ALIAS_OPTIONS = {
  scopes: DEFAULT_SCOPES,
  aliases: { "@": "./src" },
};

tester.run("barrel-import (aliases cwd-relative)", rule, {
  valid: [
    {
      name: "OK: feature barrel import via cwd-relative alias",
      code: 'import { CompA } from "@/features/feat-A";',
      filename: `${BASE}/components/SomeComponent.vue`,
      options: [CWD_RELATIVE_ALIAS_OPTIONS],
    },
  ],
  invalid: [
    {
      name: "NG: direct internal module import via cwd-relative alias",
      code: 'import { storeB } from "@/features/feat-B/storeB";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [CWD_RELATIVE_ALIAS_OPTIONS],
      errors: [{ messageId: "noDirectImport" }],
    },
  ],
});

// ─── Config validation tests ────────────────────

tester.run("barrel-import (invalid config)", rule, {
  valid: [],
  invalid: [
    {
      name: "NG: scopes is empty object",
      code: 'import { foo } from "./bar";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [{ scopes: {} }],
      errors: [{ messageId: "invalidConfig" }],
    },
    {
      name: "NG: directories is empty array",
      code: 'import { foo } from "./bar";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [
        {
          scopes: {
            features: { directories: [], dependsOn: [] },
          },
        },
      ],
      errors: [{ messageId: "invalidConfig" }],
    },
    {
      name: "NG: same directory name in multiple scopes",
      code: 'import { foo } from "./bar";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [
        {
          scopes: {
            scopeA: { directories: ["shared"], dependsOn: [] },
            scopeB: { directories: ["shared"], dependsOn: [] },
          },
        },
      ],
      errors: [{ messageId: "invalidConfig" }],
    },
    {
      name: "NG: dependsOn references undefined scope",
      code: 'import { foo } from "./bar";',
      filename: `${BASE}/features/feat-A/CompA.vue`,
      options: [
        {
          scopes: {
            features: { directories: ["features"], dependsOn: ["nonexistent"] },
          },
        },
      ],
      errors: [{ messageId: "invalidConfig" }],
    },
  ],
});

// ─── TSImportType (inline import type) tests ────

const tsTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parser: tsParser,
  },
});

tsTester.run("barrel-import (TSImportType)", rule, {
  valid: [
    {
      // Inline import type via barrel is allowed
      name: "OK: inline import type via barrel",
      code: 'type T = import("../feat-B").CompB;',
      filename: `${BASE}/features/feat-A/CompA.ts`,
      options: [{ scopes: DEFAULT_SCOPES }],
    },
  ],
  invalid: [
    {
      // Inline import type with direct internal reference is forbidden
      name: "NG: inline import type direct internal module reference",
      code: 'type T = import("../feat-B/storeB").StoreB;',
      filename: `${BASE}/features/feat-A/CompA.ts`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },
    {
      // typeof import is also forbidden
      name: "NG: typeof import direct internal module reference",
      code: 'type T = typeof import("../feat-B/storeB").default;',
      filename: `${BASE}/features/feat-A/CompA.ts`,
      options: [{ scopes: DEFAULT_SCOPES }],
      errors: [{ messageId: "noDirectImport" }],
    },
  ],
});
