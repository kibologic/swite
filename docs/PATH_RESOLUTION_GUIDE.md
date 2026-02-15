# Path Resolution Guide

## Overview

SWITE must correctly resolve URL paths to filesystem paths for different types of resources:
- **App files**: `/src/index.ui` → `apps/alpine/src/index.ui`
- **Workspace packages**: `/packages/ai-agents/...` → `SwissEnterpriseRepo/packages/ai-agents/...`
- **Business modules**: `/businessModules/cart/...` → `SwissEnterpriseRepo/businessModules/cart/...`
- **SWISS packages**: `/swiss-packages/core/...` → `SWISS/packages/core/...`

## Common Issues

### Issue 1: 500 Errors for `/businessModules/` Files

**Browser Error:**
```
GET http://localhost:3001/businessModules/cart/src/context/PosContext.js 
net::ERR_ABORTED 500 (Internal Server Error)
```

**Server Error:**
```
Error: File not found: /businessModules/cart/src/context/PosContext.js (tried .js, .ts, .ui, .uix)
filePath was: C:\...\apps\alpine\businessModules\cart\src\context\PosContext.js
```

**Root Cause:**

The file resolver was looking in the WRONG location:
- ❌ Looking in: `apps/alpine/businessModules/cart/...`
- ✅ Should look in: `SwissEnterpriseRepo/businessModules/cart/...` (workspace root)

**Why This Happened:**

The `file-path-resolver.ts` only had special handling for `/lib/` and `/packages/` paths. When a URL like `/businessModules/cart/...` was requested, it fell through to generic path resolution logic that incorrectly resolved to the app directory instead of workspace root.

**The Fix:**

Added `/businessModules/` to the workspace-level directory list in `src/utils/file-path-resolver.ts`:

```typescript
// Workspace-level directories: always resolve from workspace root
if (url.startsWith("/lib/") || 
    url.startsWith("/packages/") || 
    url.startsWith("/businessModules/")) {
    const wsRoot = workspaceRoot || (await findWorkspaceRoot(root));
    if (wsRoot) {
        return path.join(wsRoot, url);
    } else {
        return path.join(root, url);
    }
}
```

**Testing:**

```bash
# Should return compiled JavaScript code
curl http://localhost:3001/businessModules/cart/src/context/PosContext.js

# Should NOT return error
```

## Path Resolution Rules

### 1. SWISS Packages (`/swiss-packages/*`)

**URL Pattern:** `/swiss-packages/core/src/index.ts`

**Resolution:**
1. Try: `SWS/SWISS/packages/core/src/index.ts`
2. Try: Alternative SWISS monorepo locations
3. Fallback: First path even if file doesn't exist (will error later)

**Location:** Always in SWISS monorepo, not SwissEnterpriseRepo

### 2. Workspace Packages (`/packages/*`, `/lib/*`, `/businessModules/*`)

**URL Pattern:** 
- `/packages/ai-agents/src/index.ui`
- `/lib/skltn/src/index.ui`
- `/businessModules/cart/src/context/PosContext.uix`

**Resolution:**
1. Find workspace root (pnpm-workspace.yaml)
2. Join: `{workspaceRoot}{url}`
3. Example: `SwissEnterpriseRepo` + `/packages/ai-agents/...`

**Location:** Always at workspace root

### 3. App Files (`/src/*`, `/public/*`, `/assets/*`)

**URL Pattern:** `/src/index.ui`

**Resolution:**
1. Join: `{appRoot}{url}`
2. Example: `apps/alpine` + `/src/index.ui`

**Location:** Always in app directory

### 4. Generic Absolute URLs (`/*`)

**URL Pattern:** `/some/path/file.js`

**Resolution:**
1. Try: workspace root first
2. Check if file exists
3. Fallback: app root

**Location:** Depends on file existence

## Extension Resolution

The handlers try multiple extensions when a file isn't found:

**For `.js` URL:** Try in order:
1. `.js` - Actual JavaScript file
2. `.ts` - TypeScript source (compiled on-the-fly)
3. `.ui` - Swiss UI component (compiled on-the-fly)
4. `.uix` - Swiss UIX component (compiled on-the-fly)

**Example:**
- Request: `/businessModules/cart/src/context/PosContext.js`
- File exists as: `.../PosContext.uix`
- Handler compiles `.uix` → JavaScript and returns it

## Debugging Path Resolution

### 1. Check Server Logs

```bash
tail -f /tmp/alpine-dev.log | grep "file-path-resolver"
```

Look for:
```
[file-path-resolver] Found SWISS package at: ...
[file-path-resolver] SWISS package not found, using: ...
```

### 2. Check Handler Logs

```bash
tail -f /tmp/alpine-dev.log | grep "\[.js\]"
```

Look for:
```
[.js→.ts] C:\...\file.ts not found, trying next...
[.js→.ui] C:\...\file.ui not found, trying next...
[.js→.uix] C:\...\file.uix not found, trying next...
[.js] File not found: /path/to/file.js (tried .js, .ts, .ui, .uix)
[.js] filePath was: C:\actual\path\tried
```

### 3. Test Specific URLs

```bash
# Test workspace package
curl -I http://localhost:3001/packages/ai-agents/src/index.ui

# Test business module
curl -I http://localhost:3001/businessModules/cart/src/context/PosContext.js

# Test SWISS package
curl -I http://localhost:3001/swiss-packages/core/src/index.ts

# Test app file
curl -I http://localhost:3001/src/index.ui
```

Expected: `200 OK` for all valid paths

## Adding New Workspace Directories

If you add a new workspace-level directory (like `/modules/` or `/components/`), add it to the resolver:

1. **Edit:** `src/utils/file-path-resolver.ts`
2. **Add to condition:**
   ```typescript
   if (url.startsWith("/lib/") || 
       url.startsWith("/packages/") || 
       url.startsWith("/businessModules/") ||
       url.startsWith("/YOUR_NEW_DIR/")) {
   ```
3. **Rebuild:** `pnpm build`
4. **Test:** Restart dev server and test URLs

## Static Files vs. Compiled Files

### Static Files (express.static)
- **Served by:** Express static middleware
- **Directories:** `/public`, `/node_modules`, some `/lib`, some `/packages`
- **Processing:** None (direct file serving)
- **Use for:** CSS, images, pre-built JS

### Compiled Files (handlers)
- **Served by:** SWITE middleware (handlers)
- **Extensions:** `.ts`, `.ui`, `.uix`
- **Processing:** Compilation + import rewriting
- **Use for:** Source files that need compilation

**Note:** `/businessModules/`, `/packages/`, and `/lib/` are NOT served as static files because they may contain `.ui`/`.uix` files that need compilation. The handlers process them on-demand.

## Troubleshooting Checklist

- [ ] URL starts with correct prefix (`/swiss-packages/`, `/packages/`, `/businessModules/`, `/src/`)
- [ ] File exists at expected location (check filesystem)
- [ ] File has correct extension (`.ts`, `.ui`, `.uix`, `.js`)
- [ ] Workspace root is detected correctly (has `pnpm-workspace.yaml`)
- [ ] Path resolver includes the directory in special handling
- [ ] Server has been restarted after code changes
- [ ] Browser cache has been cleared (hard refresh)

## Related Files

- `src/utils/file-path-resolver.ts` - Main path resolution logic
- `src/handlers/base-handler.ts` - Handler base class with file resolution
- `src/handlers/js-handler.ts` - Extension resolution for .js URLs
- `src/middleware/static-files.ts` - Static file serving setup

