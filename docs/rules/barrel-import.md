# barrel-import

Enforce imports from scoped directories only through barrel files.

Modules under scoped directories (e.g. `features/`, `shared/`) must be imported through their barrel file (`index.ts`). Direct imports of internal files from outside the scope are forbidden.

## Rule Details

This rule reports:

- Direct imports of internal files under a scoped directory from outside that scope
- Dependency direction violations between scopes (controlled by `dependsOn`)
- Cross-module imports within isolated scopes (controlled by `isolateModules`)

Checked import forms:

- Static `import` / `export` declarations
- Dynamic `import()` with string literals or expression-free template literals
- TypeScript inline `import()` types (e.g. `type T = import("...").Foo`)

### Incorrect

```ts
// features/foo/FooComp.vue

// Direct internal import across features
import { BarComp } from "../bar/BarComp.vue";

// Direct internal import of shared module
import { helpers } from "../../shared/utils/helpers";
```

```ts
// shared/utils/helpers.ts

// shared cannot depend on features (not in dependsOn)
import { FooComp } from "../../features/foo";
```

```ts
// features/foo/FooComp.vue

// External access to child feature is forbidden (even via barrel)
import { Sub } from "../bar/features/bar-child";
```

### Correct

```ts
// features/foo/FooComp.vue

// Via barrel (directory import)
import { BarComp } from "../bar";

// Via barrel (explicit index.ts)
import { BarComp } from "../bar/index.ts";

// Same scope internal files are free
import { store } from "./store";

// features can depend on shared (listed in dependsOn)
import { helpers } from "../../shared/utils";
```

```ts
// features/bar/features/bar-child/Internal.vue

// Child scope can access parent scope's internal files
import { utils } from "../../utils";
```

## Options

### `scopes` (required)

Scope definitions. Keys are scope names.

Each scope has the following properties:

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `directories` | `string[]` | Yes | Directory names belonging to this scope |
| `dependsOn` | `string[]` | Yes | Scope names this scope is allowed to depend on |
| `isolateModules` | `boolean` | No | When `true`, forbids imports between modules even within the same scope |

```js
{
  scopes: {
    core: {
      directories: ["core"],
      dependsOn: [],
    },
    shared: {
      directories: ["shared"],
      dependsOn: ["core"],
      isolateModules: true,
    },
    features: {
      directories: ["features"],
      dependsOn: ["shared", "core"],
    },
  },
}
```

With this configuration:

- `features` can import from `shared` and `core` via barrel
- `shared` can import from `core` via barrel, but modules within `shared` cannot import each other (`isolateModules`)
- `core` cannot import from `shared` or `features`

### `barrelFiles`

List of filenames recognized as barrel files for explicit imports with extensions.

Default: `["index.ts", "index.tsx"]`

Extensionless directory imports (e.g. `./features/foo`) are always allowed regardless of this setting.

```js
{
  barrelFiles: ["index.ts", "index.tsx", "index.js"],
}
```

### `aliases`

Path alias mapping. Keys are aliases, values are absolute paths or paths relative to cwd.

```js
// eslint.config.js
{
  aliases: {
    "@": `${import.meta.dirname}/src`,
  },
}
```

With this configuration, `@/features/foo` resolves to `<project>/src/features/foo`, and the same barrel import rules apply.

## Nested Scopes

Scoped directories can be recursively nested. A child scope is only recognized when it is directly under its parent scope.

```text
features/
└── parent/
    ├── index.ts
    ├── internal.ts
    └── features/
        └── child/
            ├── index.ts
            └── internal.ts
```

- From outside `features/parent/`: only `features/parent` barrel is accessible. `features/parent/features/child` is treated as internal.
- From inside `features/parent/`: `features/child` barrel is accessible.
- From inside `features/child/`: parent scope's internal files are freely accessible.

## When Not To Use It

If your project does not use a scoped directory convention (e.g. feature-based or domain-driven structure), this rule is not applicable.
