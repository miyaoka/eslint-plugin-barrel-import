# @miyaoka/eslint-plugin-barrel-import

ESLint plugin that enforces imports from scoped directories only through barrel files.

## Features

- Prevents direct imports of internal files under scoped directories from outside
- Files within the same scope can freely import each other
- Supports recursively nested scopes (e.g. `features/X/features/Y/`)
- Controls dependency direction between scopes via `dependsOn`
- Supports path aliases (e.g. `@/`) via the `aliases` option
- Checks static imports, dynamic `import()`, re-exports, and TypeScript inline `import()` types

## Installation

```sh
pnpm add -D @miyaoka/eslint-plugin-barrel-import
```

## Usage

```js
// eslint.config.js
import barrelImport from "@miyaoka/eslint-plugin-barrel-import";

export default [
  {
    plugins: {
      "barrel-import": barrelImport,
    },
    rules: {
      "barrel-import/barrel-import": [
        "error",
        {
          scopes: {
            shared: {
              directories: ["shared"],
              dependsOn: [],
            },
            features: {
              directories: ["features"],
              dependsOn: ["shared"],
            },
          },
        },
      ],
    },
  },
];
```

## Rules

| Rule | Description |
| --- | --- |
| [barrel-import](docs/rules/barrel-import.md) | Enforce imports from scoped directories only through barrel files |

## License

MIT
