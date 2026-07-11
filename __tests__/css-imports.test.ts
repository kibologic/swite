import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteCssImports } from "../src/dev-engine/handlers/css-imports.js";

describe("rewriteCssImports", () => {
  it("replaces a default CSS-module import with an empty object binding", () => {
    const out = rewriteCssImports(`import styles from './x.module.css';\nconsole.log(styles);`);
    assert.match(out, /const styles = \{\};/);
    assert.ok(!out.includes("from './x.module.css'"));
  });

  it("replaces a named CSS-module import with empty object bindings", () => {
    const out = rewriteCssImports(`import { a, b as c } from './x.module.css';`);
    assert.match(out, /const a = \{\};/);
    assert.match(out, /const c = \{\};/);
  });

  it("strips a side-effect CSS import entirely", () => {
    const out = rewriteCssImports(`import './x.css';\nconsole.log('after');`);
    assert.ok(!out.includes(".css"));
    assert.ok(out.includes("console.log('after');"));
  });

  it("replaces a dynamic CSS import with an empty object expression", () => {
    const out = rewriteCssImports(`const p = import('./x.css');`);
    assert.match(out, /const p = \(\{\}\);/);
  });

  it("leaves non-CSS imports untouched", () => {
    const src = `import { foo } from './bar.js';\nimport styles from './x.module.css';`;
    const out = rewriteCssImports(src);
    assert.ok(out.includes("import { foo } from './bar.js';"));
    assert.match(out, /const styles = \{\};/);
  });
});
