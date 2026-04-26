/**
 * Enforce that modules under scoped directories can only be imported through barrel files.
 *
 * - Importing internal files of scope/X/ from outside causes an error
 * - Files within the same scope/X/ can freely import each other
 * - Scoped directories can be recursively nested (features/X/features/Y/)
 * - Dependency direction between scopes is controllable (declare allowed targets via dependsOn)
 * - Supports path aliases (e.g. @/) via the aliases option
 */
import path from "node:path";

import type { Rule } from "eslint";

// ─── Types ──────────────────────────────────────

interface ScopeConfig {
  directories: string[];
  dependsOn: string[];
  /** When true, forbids imports between modules even within the same scope */
  isolateModules?: boolean;
}

interface BarrelImportOptions {
  barrelFiles?: string[];
  scopes: Record<string, ScopeConfig>;
  /** Path alias mapping (e.g. { "@": "./src" }). Values can be absolute paths or relative to cwd */
  aliases?: Record<string, string>;
}

// ─── Defaults ───────────────────────────────────

const DEFAULT_BARREL_FILES = ["index.ts", "index.tsx"];

// ─── Utilities ──────────────────────────────────

/** Normalize Windows path separators */
function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

/** Escape regex metacharacters */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex for matching directory names from scope config.
 * e.g. { shared: { directories: ["shared"] }, features: { directories: ["features"] } }
 *      → /(?:^|\/)((?:features|shared)\/[^/]+)(?:\/|$)/
 */
function buildScopePattern(scopes: Record<string, ScopeConfig>): RegExp {
  const allDirs = new Set<string>();
  for (const scope of Object.values(scopes)) {
    for (const dir of scope.directories) {
      allDirs.add(dir);
    }
  }
  // Sort alphabetically for deterministic regex output
  const dirPattern = [...allDirs]
    .sort()
    .map((d) => escapeRegExp(d))
    .join("|");
  return new RegExp(`(?:^|/)((?:${dirPattern})/[^/]+)(?:/|$)`);
}

/** Scope identification info */
interface ScopeInfo {
  /** Scope leaf pair (e.g. "features/common"). Used for directory name and barrel resolution */
  scope: string;
  /** Full path from root to scope end. Used for identity comparison */
  fullPath: string;
}

/**
 * Extract all scopes from a path in shallowest-first order.
 * e.g. "src/features/sidebar/features/worktree/WorktreeItem.vue"
 *      → [
 *          { scope: "features/sidebar", fullPath: "src/features/sidebar" },
 *          { scope: "features/worktree", fullPath: "src/features/sidebar/features/worktree" },
 *        ]
 *
 * fullPath distinguishes identically-named child scopes under different parents.
 *
 * Nested scopes are only recognized when directly under the parent scope.
 * - features/analytics/features/sub/ → OK (features is directly under analytics)
 * - features/analytics/components/shared/X/ → ignored (shared is not directly under analytics)
 * - features/analytics/shared/utils/ → OK (shared is directly under analytics)
 */
function extractAllScopes(filePath: string, scopePattern: RegExp): ScopeInfo[] {
  const scopes: ScopeInfo[] = [];
  let searchFrom = 0;
  while (searchFrom < filePath.length) {
    const remaining = filePath.slice(searchFrom);
    const match = scopePattern.exec(remaining);
    if (!match) break;
    // If match[0] starts with "/", the scope begins at match.index + 1
    const scopeStart = match[0].startsWith("/") ? match.index + 1 : match.index;
    const absoluteScopeStart = searchFrom + scopeStart;

    // For nested scopes, verify it's directly under the previous scope
    if (scopes.length > 0) {
      const lastScope = scopes[scopes.length - 1];
      const expectedStart = lastScope.fullPath.length + 1; // +1 for "/"
      if (absoluteScopeStart !== expectedStart) {
        // Not directly under parent scope; skip and search further
        searchFrom += match.index + match[0].length;
        continue;
      }
    }

    scopes.push({
      scope: match[1],
      fullPath: filePath.slice(0, absoluteScopeStart + match[1].length),
    });
    searchFrom += match.index + match[0].length;
  }
  return scopes;
}

/**
 * Extract the deepest scope from a path.
 */
function extractDeepestScope(filePath: string, scopePattern: RegExp): ScopeInfo | undefined {
  const scopes = extractAllScopes(filePath, scopePattern);
  return scopes[scopes.length - 1];
}

/**
 * Extract the directory name portion (e.g. "features") from a scope string (e.g. "features/sidebar").
 */
function getScopeDir(scope: string): string {
  return scope.split("/")[0];
}

/**
 * Determine whether the import target points to a barrel file of the allowed scope.
 * Compares resolvedPath (absolute) against scopeFullPath (scope's absolute path).
 *
 * - resolvedPath equals the scope directory itself → barrel (implicit index resolution)
 * - resolvedPath matches a barrelFiles entry directly under the scope directory → barrel
 * - Otherwise → not a barrel
 */
function isBarrelImport(
  resolvedPath: string,
  scopeFullPath: string,
  barrelFiles: string[],
): boolean {
  // Points to the scope directory itself (extensionless directory import)
  if (resolvedPath === scopeFullPath) return true;

  // Points to a barrelFiles entry under the scope directory (explicit import with extension)
  for (const barrel of barrelFiles) {
    if (resolvedPath === `${scopeFullPath}/${barrel}`) return true;
  }

  return false;
}

/**
 * Determine whether the dependency from the source scope to the target scope is allowed.
 * Disallowed if not listed in dependsOn.
 */
function isDependencyAllowed(
  fromScopeDir: string,
  toScopeDir: string,
  scopes: Record<string, ScopeConfig>,
  dirToScope: Map<string, string>,
): boolean {
  // Same scope directory is always allowed
  if (fromScopeDir === toScopeDir) return true;

  const fromScopeName = dirToScope.get(fromScopeDir);
  const toScopeName = dirToScope.get(toScopeDir);
  if (!fromScopeName || !toScopeName) return true;

  // Different directories under the same scope name are allowed
  if (fromScopeName === toScopeName) return true;

  return scopes[fromScopeName].dependsOn.includes(toScopeName);
}

/**
 * Resolve an alias and return the absolute path.
 * Returns undefined if the import source doesn't match any alias.
 *
 * If the alias value is an absolute path (starts with /), use it as-is.
 * Otherwise, resolve it relative to cwd.
 */
function resolveAlias(
  importSource: string,
  aliases: Record<string, string>,
  cwd: string,
): string | undefined {
  for (const [alias, target] of Object.entries(aliases)) {
    const aliasPrefix = `${alias}/`;
    if (importSource === alias || importSource.startsWith(aliasPrefix)) {
      const rest = importSource === alias ? "" : importSource.slice(aliasPrefix.length);
      const base = path.isAbsolute(target) ? target : path.resolve(cwd, target);
      return normalizePath(path.resolve(base, rest));
    }
  }
  return undefined;
}

// ─── Rule Definition ────────────────────────────

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce imports from scoped directories only through barrel files",
    },
    messages: {
      noDirectImport:
        "Direct import of '{{importSource}}' is not allowed. Import through the barrel file of '{{scopeName}}' instead.",
      noDependency: "Dependency from '{{fromScope}}' to '{{toScope}}' is not allowed.",
      noCrossModuleDependency:
        "Cross-module dependency within '{{scopeName}}' scope is not allowed (isolateModules).",
      invalidConfig: "barrel-import: {{detail}}",
    },
    schema: [
      {
        type: "object",
        properties: {
          barrelFiles: {
            type: "array",
            items: { type: "string" },
            description:
              'List of filenames allowed as barrel files for explicit imports with extensions. Extensionless directory imports are always allowed (default: ["index.ts", "index.tsx"])',
          },
          scopes: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                directories: {
                  type: "array",
                  items: { type: "string" },
                  description: "List of directory names belonging to this scope",
                },
                dependsOn: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "List of scope names this scope is allowed to depend on. Dependencies on unlisted scopes are forbidden",
                },
                isolateModules: {
                  type: "boolean",
                  description: "When true, forbids imports between modules even within the same scope",
                },
              },
              required: ["directories", "dependsOn"],
              additionalProperties: false,
            },
            description:
              "Scope definitions. Keys are scope names; use directories to specify directory names, dependsOn to declare allowed dependencies",
          },
          aliases: {
            type: "object",
            additionalProperties: { type: "string" },
            description:
              'Path alias mapping. Keys are aliases, values are absolute paths or paths relative to cwd (e.g. { "@": "./src" })',
          },
        },
        required: ["scopes"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] as BarrelImportOptions;
    const barrelFiles = options?.barrelFiles ?? DEFAULT_BARREL_FILES;
    const scopes = options?.scopes;
    const aliases = options?.aliases ?? {};

    // ─── Scopes validation ────────────────────────
    const scopeNames = Object.keys(scopes);
    if (scopeNames.length === 0) {
      context.report({
        loc: { line: 1, column: 0 },
        messageId: "invalidConfig",
        data: { detail: "scopes must not be empty" },
      });
      return {};
    }

    const dirToScope = new Map<string, string>();
    for (const [scopeName, config] of Object.entries(scopes)) {
      if (config.directories.length === 0) {
        context.report({
          loc: { line: 1, column: 0 },
          messageId: "invalidConfig",
          data: {
            detail: `scopes.${scopeName}.directories must not be empty`,
          },
        });
        return {};
      }
      for (const dir of config.directories) {
        const existing = dirToScope.get(dir);
        if (existing) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: "invalidConfig",
            data: {
              detail: `Directory '${dir}' is duplicated in scopes '${existing}' and '${scopeName}'`,
            },
          });
          return {};
        }
        dirToScope.set(dir, scopeName);
      }
      for (const dep of config.dependsOn) {
        if (!scopeNames.includes(dep)) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: "invalidConfig",
            data: {
              detail: `scopes.${scopeName}.dependsOn contains undefined scope '${dep}'`,
            },
          });
          return {};
        }
      }
    }

    const scopePattern = buildScopePattern(scopes);
    const filename = normalizePath(context.filename);

    function check(sourceNode: Rule.Node, importSource: string) {
      // Resolve the import target to an absolute path
      let resolvedPath: string;

      if (importSource.startsWith(".")) {
        // Relative path
        resolvedPath = normalizePath(path.resolve(path.dirname(filename), importSource));
      } else {
        // Try to resolve as alias
        const resolved = resolveAlias(importSource, aliases, context.cwd);
        if (!resolved) return; // Skip external packages
        resolvedPath = resolved;
      }

      // Extract all scopes from the import target (shallowest first)
      const toScopeInfos = extractAllScopes(resolvedPath, scopePattern);
      if (toScopeInfos.length === 0) return;

      const toDeepest = toScopeInfos[toScopeInfos.length - 1]; // Deepest scope
      const toRoot = toScopeInfos[0]; // Shallowest scope (externally visible boundary)

      // Check dependency direction between scopes
      const fromScopeInfos = extractAllScopes(filename, scopePattern);
      if (fromScopeInfos.length > 0) {
        const fromRootDir = getScopeDir(fromScopeInfos[0].scope);
        const toRootDir = getScopeDir(toRoot.scope);
        if (!isDependencyAllowed(fromRootDir, toRootDir, scopes, dirToScope)) {
          const fromScopeName = dirToScope.get(fromRootDir) ?? fromRootDir;
          const toScopeName = dirToScope.get(toRootDir) ?? toRootDir;
          context.report({
            node: sourceNode,
            messageId: "noDependency",
            data: {
              fromScope: fromScopeName,
              toScope: toScopeName,
            },
          });
          return;
        }
      }

      // Extract the deepest scope of the import source
      const fromDeepest = extractDeepestScope(filename, scopePattern);

      // Files within the same scope can freely import each other (compared by fullPath to distinguish same-named child scopes)
      if (fromDeepest && fromDeepest.fullPath === toDeepest.fullPath) return;

      // isolateModules: forbid imports between modules even within the same scope
      if (fromDeepest && fromDeepest.fullPath !== toDeepest.fullPath) {
        const fromScopeDir = getScopeDir(fromDeepest.scope);
        const toScopeDir = getScopeDir(toDeepest.scope);
        if (fromScopeDir === toScopeDir) {
          const scopeName = dirToScope.get(fromScopeDir);
          if (scopeName && scopes[scopeName].isolateModules) {
            context.report({
              node: sourceNode,
              messageId: "noCrossModuleDependency",
              data: { scopeName },
            });
            return;
          }
        }
      }

      // Child scopes can freely access parent scope's internal files
      // If the source path contains the target scope's fullPath, the target is an ancestor scope
      if (
        fromDeepest &&
        fromDeepest.fullPath !== toDeepest.fullPath &&
        filename.includes(`${toDeepest.fullPath}/`)
      )
        return;

      // Determine whether the import source is inside the root scope
      // Inside = the source itself is the root scope, or a descendant of the root scope
      const isInsideRootScope =
        (fromDeepest && fromDeepest.fullPath === toRoot.fullPath) ||
        filename.includes(`${toRoot.fullPath}/`);

      // Barrel import check
      // Inside → OK if through the child scope's barrel (deepest scope)
      // Outside → only the root scope's barrel is OK (child scopes are internal to the parent)
      const allowedScopeInfo = isInsideRootScope ? toDeepest : toRoot;
      if (isBarrelImport(resolvedPath, allowedScopeInfo.fullPath, barrelFiles)) return;

      // Everything else is forbidden
      context.report({
        node: sourceNode,
        messageId: "noDirectImport",
        data: {
          importSource,
          scopeName: allowedScopeInfo.scope,
        },
      });
    }

    return {
      ImportDeclaration(node) {
        check(node, String(node.source.value));
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          check(node, String(node.source.value));
        }
      },
      ExportAllDeclaration(node) {
        check(node, String(node.source.value));
      },
      // Also check dynamic import() (only string literals or expression-free template literals)
      ImportExpression(node) {
        if (node.source.type === "Literal" && typeof node.source.value === "string") {
          check(node, node.source.value);
        } else if (
          node.source.type === "TemplateLiteral" &&
          node.source.expressions.length === 0 &&
          node.source.quasis[0]?.value.cooked
        ) {
          check(node, node.source.quasis[0].value.cooked);
        }
      },
      // TypeScript inline import type: type T = import("...").T / typeof import("...").default
      // TSImportType is not defined in ESLint's standard RuleListener, so we use Rule.Node
      TSImportType(node: Rule.Node) {
        if (!("source" in node)) return;

        const { source } = node;
        if (
          typeof source === "object" &&
          source !== null &&
          "type" in source &&
          source.type === "Literal" &&
          "value" in source &&
          typeof source.value === "string"
        ) {
          check(node, source.value);
        }
      },
    };
  },
};

export default rule;
