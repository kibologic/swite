<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# Quickstart

Get a SwissJS application running under SWITE in a few minutes.

---

## Prerequisites

- Node.js 18.19.x or later
- pnpm 10.x
- A SwissJS application (`src/index.ui` as entry point)

---

## 1. Install SWITE

In your application package:

```bash
pnpm add -D @swissjs/swite
```

Add the CLI commands to `package.json`:

```json
{
  "scripts": {
    "dev": "swite dev",
    "build": "swite build",
    "start": "swite start"
  }
}
```

---

## 2. Start the dev server

```bash
pnpm dev
```

SWITE starts on `http://localhost:3000` by default. Every `.ui`, `.uix`, `.ts`, and `.js` request is compiled and import-rewritten on demand. HMR is active on port 24678.

---

## 3. Project layout

A minimal SWITE project:

```
my-app/
├── src/
│   ├── index.ui          # entry point — mounted by public/index.html
│   ├── App.ui            # root component
│   └── components/
├── public/
│   └── index.html        # shell HTML — SWITE injects import map here
├── package.json
└── swiss.config.ts       # optional
```

SWITE resolves files relative to the directory where `swite dev` is invoked (the project root). The `src/` prefix in URLs maps directly to `<root>/src/` on disk.

---

## 4. Write a component

```typescript
// src/components/Counter.ui

component Counter {
  state {
    let count: number = 0;
  }

  render() {
    return html`
      <div>
        <p>Count: ${this.count}</p>
        <button onclick="${() => this.count++}">+1</button>
      </div>
    `;
  }
}
```

SWITE pipes `.ui` files through `@swissjs/compiler` (the SwissJS syntax transformer), then through esbuild's TypeScript stripper, rewrites all bare imports to browser-resolvable URLs, and serves the result as `application/javascript`.

---

## 5. Build for production

```bash
pnpm build
```

Output goes to `dist/`. The build entry is fixed to `src/index.ui`. See [`swite build`](../cli/build.md) for details.

---

## Next

- [Project structure](./project-structure.md) — layout conventions
- [Configuration](./configuration.md) — server port, Python service options
- [CLI reference](../cli/index.md) — all commands
- [Architecture](../architecture/index.md) — how SWITE works internally
