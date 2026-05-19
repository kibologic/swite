/**
 * Build the HMR client script served to the browser at /__swite_hmr_client.
 *
 * The client is plain JavaScript (no TS syntax) because it is injected into
 * browser pages as-is. Keeping it in a separate module rather than embedded
 * inside hmr.ts makes it editable with syntax highlighting and avoids
 * template-literal escaping issues.
 */
export function buildHmrClientScript(port: number): string {
  return `// SWITE HMR Client
console.log('[SWITE] HMR enabled');

const socket = new WebSocket('ws://' + window.location.hostname + ':${port}');
const moduleGraph = new Map();
const hotModules = new Map();

socket.addEventListener('open', () => {
  console.log('[SWITE] HMR connected');
});

socket.addEventListener('message', async (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'update') {
    console.log('[SWITE] Processing update:', data.path, 'Type:', data.updateType);

    if (data.updateType === 'style') {
      updateStyles();
      console.log('[SWITE] Styles hot updated');
    } else if (data.updateType === 'hot') {
      const moduleName = extractModuleName(data.path);

      if (moduleName && hotModules.has(moduleName)) {
        try {
          invalidateModule(moduleName);
          invalidateDependents(moduleName);

          const updatedModule = await import(data.path + '?t=' + Date.now());
          hotModules.set(moduleName, updatedModule);

          updateComponent(moduleName, updatedModule);
          console.log('[SWITE] Component hot updated:', moduleName);
        } catch (error) {
          console.error('[SWITE] Hot update failed:', error);
          window.location.reload();
        }
      } else {
        console.log('[SWITE] New component detected, reloading page');
        window.location.reload();
      }
    } else {
      console.log('[SWITE] Full page reload required');
      window.location.reload();
    }
  }
});

function updateStyles() {
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      const base = href.replace(/[?&]t=\\d+/, '');
      link.setAttribute('href', base + (base.includes('?') ? '&' : '?') + 't=' + Date.now());
    }
  });
}

function extractModuleName(filePath) {
  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1];
  return fileName ? fileName.replace(/\\.[^.]+$/, '') : null;
}

function invalidateModule(moduleName) {
  if (window.__swiss_modules__) {
    delete window.__swiss_modules__[moduleName];
  }
}

function invalidateDependents(moduleName) {
  const dependents = moduleGraph.get(moduleName);
  if (dependents) {
    for (const dependent of dependents) {
      invalidateModule(dependent);
    }
  }
}

function updateComponent(moduleName, newModule) {
  if (window.__swiss_instances__) {
    const instances = window.__swiss_instances__[moduleName];
    if (instances && Array.isArray(instances)) {
      instances.forEach(instance => {
        if (instance && typeof instance.update === 'function') {
          instance.update(newModule.default || newModule);
        }
      });
    }
  }
}

socket.addEventListener('close', () => {
  console.log('[SWITE] HMR disconnected');
});

socket.addEventListener('error', (error) => {
  console.error('[SWITE] HMR error:', error);
});

window.__swiss_modules__ = window.__swiss_modules__ || {};
window.__swiss_instances__ = window.__swiss_instances__ || {};

const currentScript = document.currentScript;
if (currentScript && currentScript.src) {
  const moduleName = extractModuleName(currentScript.src);
  if (moduleName) {
    window.__swiss_modules__[moduleName] = true;
  }
}
`;
}
