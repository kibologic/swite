# Import Rewriting Troubleshooting Guide

## The Problem

**Browser Error:**
```
Failed to resolve module specifier "@swiss-enterprise/ai-agents". 
Relative references must start with either "/", "./", or "../".
```

**Root Cause:**
The browser cannot resolve bare module specifiers (like `@swiss-enterprise/ai-agents`). SWITE must rewrite them to valid paths (like `/EnterpriseRepo/packages/ai-agents/src/index.ui`) before sending code to the browser.

## Why This Keeps Happening

### 1. **es-module-lexer Returns Unquoted Specifiers**

`es-module-lexer` sometimes returns import positions WITHOUT including the surrounding quotes. For example:
- Code: `import { X } from '@swiss-enterprise/ai-agents'`
- Lexer returns: `@swiss-enterprise/ai-agents` (no quotes)
- Our code must detect the quotes in the original code

### 2. **Quote Detection Logic Fails**

If quote detection fails, the import rewriter skips the import, leaving bare imports in the code sent to the browser.

### 3. **Browser Can't Resolve Bare Imports**

Browsers require:
- Absolute paths: `/path/to/file.js`
- Relative paths: `./file.js` or `../file.js`
- NOT bare specifiers: `@package/name`

## The Fix

### Detection Strategy

1. **Check if lexer included quotes:**
   ```typescript
   const hasQuotes = (firstChar === '"' || firstChar === "'") && firstChar === lastChar;
   ```

2. **If no quotes, check surrounding code:**
   ```typescript
   const codeBefore = code.slice(start - 1, start);
   const codeAfter = code.slice(end, end + 1);
   const hasQuotesInCode = codeBefore === codeAfter && (codeBefore === '"' || codeBefore === "'");
   ```

3. **If still no quotes, search for quoted version:**
   ```typescript
   const quotedPattern = new RegExp(`(['"])${specifier}\\1`);
   const match = quotedPattern.exec(code);
   ```

4. **If found, use those positions for replacement**

### Replacement Strategy

- Always preserve the original quote style (`'` or `"`)
- Replace the ENTIRE quoted string, not just the specifier
- Ensure the resolved path is also properly quoted

## What Breaks

### ❌ What Breaks:
1. **Skipping unquoted specifiers** - Leaves bare imports in browser code
2. **Wrong quote detection** - Replaces wrong parts of code
3. **Not finding quoted version** - Skips valid imports
4. **Variable references** - Accidentally rewriting `import(variable)` as module specifiers

### ✅ What Works:
1. **Proper quote detection** - Finds quotes even when lexer doesn't include them
2. **Regex fallback** - Searches code for quoted version if direct detection fails
3. **Variable validation** - Skips property access patterns (`def.componentUrl`)
4. **Package name validation** - Only processes valid package names (`@scope/name`)

## How to Avoid This

### For Developers:

1. **Always use quoted imports:**
   ```typescript
   // ✅ Good
   import { X } from '@swiss-enterprise/ai-agents';
   
   // ❌ Bad (if compiler removes quotes)
   import { X } from @swiss-enterprise/ai-agents;
   ```

2. **Check server logs:**
   ```
   [SWITE] import-rewriter: ⚠️ SKIPPING unquoted specifier
   [.ui] ERROR: Bare imports still present after rewriting
   ```

3. **Verify rewritten code:**
   ```bash
   curl http://localhost:3001/src/index.ui | grep "@swiss-enterprise"
   # Should return nothing (all imports rewritten)
   ```

### For SWITE Maintainers:

1. **Test with real code:**
   - Don't just test with simple strings
   - Test with actual compiled `.ui` files
   - Test with `es-module-lexer` output

2. **Handle edge cases:**
   - Unquoted specifiers from lexer
   - Mixed quote styles
   - Dynamic imports with variables

3. **Add comprehensive logging:**
   - Log when quotes are detected
   - Log when quotes are NOT detected
   - Log when regex fallback is used

## Current Status

✅ **Fixed:** Quote detection now uses regex fallback to find quoted versions in code
✅ **Fixed:** Properly adjusts positions when quotes are found
✅ **Fixed:** Preserves original quote style during replacement

## Testing

```bash
# Test import rewriter
cd SWS/SWISS/packages/swite
node test-import-rewriter.mjs

# Check server logs
tail -f /tmp/alpine-dev.log | grep "import-rewriter"

# Verify browser code
curl http://localhost:3001/src/index.ui | grep "@swiss-enterprise"
```

