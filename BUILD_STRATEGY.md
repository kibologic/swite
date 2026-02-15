# SWITE Build Strategy - Unified Builder

> **Note:** Alpine and skltn have been removed from the monorepo. References below are historical.

## Goal
**ONE builder (SWITE) that builds the entire app including all workspace dependencies in a single pass.**

## Current State

### Dev Server (SWITE Server)
- ✅ Compiles `.ui`/`.uix` files on-the-fly when requested
- ✅ Resolves workspace packages via ModuleResolver
- ✅ Works for development

### Production Builder (SWITE Builder)
- ❌ Only compiles files in app's `src/` directory
- ❌ Does NOT compile workspace dependencies
- ❌ Marks dependencies as `external` (not bundled)
- ❌ Dependencies must be pre-built separately

## Required Strategy

### Single-Pass Build Flow

```
Build app
  ↓
1. Discover workspace dependencies
   - @swiss-package/* (e.g. ai-agents, event-bus)
  ↓
2. Compile ALL .ui/.uix files (app + dependencies)
   - App: src/**/*.{ui,uix}
   - Workspace packages as resolved
  ↓
3. Bundle everything together
   - OR serve from compiled locations
```

## Implementation Plan

### Option A: Bundle Everything (Recommended)
- Compile all dependencies to temp directory
- Bundle app + dependencies into single output
- All workspace packages included in bundle

### Option B: Compile & Link
- Compile each dependency to its own location
- Bundle app with references to compiled deps
- Runtime resolution to compiled files

### Option C: Dev Mode (Current)
- Compile on-the-fly when requested
- Works for dev, but not for production

## Key Changes Needed

1. **Discover Dependencies**
   - Parse app's package.json dependencies
   - Filter for workspace packages
   - Resolve their locations

2. **Compile Dependencies**
   - Find all .ui/.uix files in dependency packages
   - Compile them to JavaScript
   - Store in temp or output location

3. **Bundle Strategy**
   - Include dependencies in bundle (Option A)
   - OR reference compiled dependencies (Option B)

4. **Module Resolution**
   - During build, resolve workspace packages
   - Include their compiled files in bundle
   - Handle import rewriting

