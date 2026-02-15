# Import Rewriting in SWITE

## Overview

SWITE automatically rewrites bare module specifiers (e.g., `@swissjs/core`) to valid URLs that the browser can resolve. This document explains how it works and common issues.

## How It Works

### Static Imports

Static imports like `import { X } from '@swissjs/core'` are automatically rewritten to use the resolved path:

```javascript
// Before
import { SwissApp } from '@swissjs/core';

// After (rewritten)
import { SwissApp } from '/swiss-packages/core/src/index.ts';
```

### Dynamic Imports

Dynamic imports with **string literals** are rewritten:

```javascript
// ✅ This WILL be rewritten
const module = await import('@swissjs/router');

// ❌ This will NOT be rewritten (variable reference)
const module = await import(def.componentUrl);
```

## Critical Rule: Variable References Are NOT Rewritten

**IMPORTANT**: SWITE only rewrites **string literal** module specifiers. Variable references in dynamic imports are left unchanged.

### Why?

Variable references like `import(def.componentUrl)` are runtime values that cannot be statically analyzed. Rewriting them would break the code:

```javascript
// ❌ WRONG - This would break
const module = await import(https://esm.sh/def.componentUrl); // Syntax error!

// ✅ CORRECT - Variable references are left as-is
const module = await import(def.componentUrl);
```

### How SWITE Detects This

1. **es-module-lexer path**: Only processes imports with quoted string literals
2. **Regex fallback path**: Only matches patterns like `import('"specifier"')` with quotes

## Common Issues

### SyntaxError: Unexpected token ':'

**Symptom**: Browser error like `ShellRouter.js:41 Uncaught SyntaxError: Unexpected token ':'`

**Cause**: The import rewriter incorrectly rewrote a variable reference in a dynamic import.

**Solution**: Use an intermediate variable to ensure the import rewriter skips it:

```javascript
// ✅ REQUIRED - Use intermediate variable
const url = def.componentUrl;
const module = await import(url);

// ❌ Wrong - Property access may be incorrectly processed
const module = await import(def.componentUrl);

// ❌ Wrong - Template literals are still processed
const module = await import(`${def.componentUrl}`);
```

### Module Not Found After Rewriting

**Symptom**: Module resolves but file doesn't exist

**Cause**: The resolver returned a path that doesn't exist (e.g., pointing to `dist/` when only `src/` exists)

**Solution**: SWITE automatically prefers `src/` over `dist/` in development. If issues persist, check:
1. The package's `package.json` exports field
2. The file actually exists at the resolved path
3. Server logs for resolution details

## Debugging

Enable verbose logging to see what's being rewritten:

```bash
# Check server logs for:
[SWITE] import-rewriter: Resolved <specifier> -> <resolved>
```

If you see a variable being resolved (e.g., `def.componentUrl`), that's a bug - report it.

## Implementation Details

### es-module-lexer Path (Primary)

1. Parses the code to find all imports
2. Extracts specifiers (with quotes)
3. Only processes specifiers that have quotes (string literals)
4. Skips variable references automatically

### Regex Fallback Path

Used when es-module-lexer fails to parse (e.g., complex template literals):

1. Matches only quoted string literals: `/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g`
2. Validates specifier looks like a module path
3. Skips property access patterns (e.g., `def.componentUrl`)

## Best Practices

1. **Use string literals for static module paths**:
   ```javascript
   const module = await import('@swissjs/router');
   ```

2. **Use intermediate variables for runtime-determined paths**:
   ```javascript
   // ✅ REQUIRED PATTERN - Use intermediate variable
   const url = def.componentUrl;
   const module = await import(url);
   
   // ❌ WRONG - Property access may be incorrectly processed
   const module = await import(def.componentUrl);
   ```

3. **Why intermediate variables?**
   - Import rewriter skips simple identifiers (like `url`, `x`, etc.)
   - Property access patterns (like `def.componentUrl`) may be incorrectly processed
   - This ensures the variable is treated as a variable, not a module specifier

## Required Pattern for Dynamic Imports with Variables

**ALWAYS** use this pattern when importing from a variable:

```typescript
// Extract to simple identifier first
const url = def.componentUrl;
const module = await import(url);
```

**Why this works:**
- Import rewriter validates specifiers and skips simple identifiers
- Simple identifiers (single word, no dots, no @) are treated as variables
- Property access patterns may pass validation and be incorrectly processed
- Using an intermediate variable ensures the import rewriter skips it

**What NOT to do:**
```typescript
// ❌ Don't use property access directly
const module = await import(def.componentUrl);

// ❌ Don't use template literals
const module = await import(`${def.componentUrl}`);

// ❌ Don't use complex expressions
const module = await import(config.paths.component);
```

