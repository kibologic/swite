# Build System Analysis

> **Note:** Alpine and skltn have been removed from the monorepo. Sections below that reference them are kept for historical context.

## Current State

### Alpine App (removed)
- **Location**: `SwissEnterpriseRepo/apps/alpine/`
- **Build**: Uses SWISS CLI (`node ../../../SWISS/packages/cli/dist/index.js build`)
- **Status**: ✅ Correct - uses SWISS build system
- **Files**: `.uix`, `.ts`

### skltn Package (removed)
- **Location**: `SwissEnterpriseRepo/lib/skltn/`
- **Build**: Uses `tsc` (plain TypeScript compiler) ❌
- **Status**: ❌ **WRONG** - has `.ui`/`.uix` files but uses plain TypeScript
- **Files**: `.ui`, `.uix`, `.ts`
- **Exports**: Point to `dist/` but package is never built
- **Issue**: `tsc` cannot compile `.ui`/`.uix` files

### cart Package  
- **Location**: `SwissEnterpriseRepo/packages/cart/`
- **Build**: Uses SWISS CLI ✅
- **Status**: ✅ Correct - uses SWISS build system
- **Files**: `.ui`, `.uix`
- **Exports**: Point to source files (`./src/...`) ✅

## Problems Identified

### 1. skltn Build Configuration
**Current**:
```json
{
  "scripts": {
    "build": "tsc",  // ❌ Wrong - can't handle .ui/.uix
    "dev": "tsc --watch"
  },
  "exports": {
    "./shell": {
      "import": "./dist/shell/index.js"  // ❌ Points to dist but never built
    }
  }
}
```

**Should be**:
```json
{
  "scripts": {
    "build": "node ../../../SWISS/packages/cli/dist/index.js build",
    "dev": "node ../../../SWISS/packages/cli/dist/index.js dev"
  },
  "exports": {
    "./shell": "./src/shell/index.ui"  // ✅ Point to source (like cart)
  }
}
```

### 2. skltn Source File Imports
**Current** (`src/index.ui`):
```typescript
export * from './shell/index.js';  // ❌ Points to .js but file is .ui
```

**Should be**:
```typescript
export * from './shell/index.ui';  // ✅ Point to actual file
```

### 3. Missing tsconfig.json
- skltn has no `tsconfig.json`
- SWISS CLI build needs it for TypeScript compilation

## Required Fixes

1. **Update skltn package.json**:
   - Change build script to use SWISS CLI
   - Update exports to point to source files (like cart)
   
2. **Fix skltn source imports**:
   - Change `.js` imports to `.ui`/`.uix` in source files
   
3. **Add tsconfig.json to skltn**:
   - Create proper TypeScript config for SWISS build

4. **Build skltn**:
   - Run build to generate dist/ if needed
   - OR keep exports pointing to source (recommended for dev)

