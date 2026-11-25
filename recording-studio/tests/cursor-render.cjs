// Run with node local-walkthrough/tests/cursor-render.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { ServerStyleSheet } = require('styled-components');
const { chromium } = require('playwright');

// Compile only the local components, so the check uses the actual player SVG/CSS.
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    });
    module._compile(result.outputText, filename);
  };
}
const { normalizeCursorSettings } = require('../src/cursorSettings.ts');
const { CursorGraphic } = require('../src/CursorGraphic.tsx');
const { PlayerCursor } = require('../src/styles.tsx');
const { getCursorHotspot, getPlaybackCursorShape } = require('../src/cursorGeometry.ts');

async function main() {
  assert.equal(getPlaybackCursorShape('arrow', true), 'arrow');
  assert.equal(normalizeCursorSettings({shape:'arrow',size:58,shadow:'strong'}).size,24);
  assert.equal(normalizeCursorSettings({shape:'arrow',size:58,shadow:'strong'}).shadow,'none');
  assert.equal(normalizeCursorSettings({shape:'arrow',size:72}).size,72);
  for (const shape of ['dot', 'ring', 'crosshair']) {
    assert.equal(getPlaybackCursorShape(shape, true), shape);
  }
  const sheet = new ServerStyleSheet();
  const children = [];
  for (const [row, size] of [24, 58, 128].entries()) {
    for (const [column, shape] of ['arrow', 'pointer', 'dot', 'ring', 'crosshair'].entries()) {
      const x = 70 + column * 170;
      const y = 65 + row * 170;
      for (const clicking of [false, true]) {
        const targetX = x + (clicking ? 70 : 0);
        children.push(React.createElement(PlayerCursor, {
          key: `${size}-${shape}-${clicking}`,
          'data-shape': shape, 'data-x': targetX, 'data-y': y,
          $size: size, $shape: shape, $x: targetX, $y: y,
          $visible: true, $opacity: 1, $shadow: 'none', $clicking: clicking,
        }, React.createElement(CursorGraphic, {
          shape, fillColor: '#ffffff', borderColor: '#111111', outlineWidth: 4,
        })));
      }
    }
  }
  const markup = renderToStaticMarkup(sheet.collectStyles(React.createElement('div', null, children)));
  const styles = sheet.getStyleTags();
  sheet.seal();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const zoom of [0.8, 1]) {
      for (const dpr of [1, 3840 / 1470]) {
        const context = await browser.newContext({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: dpr });
        const page = await context.newPage();
        await page.setContent(`<html style="zoom:${zoom}"><head>${styles}</head><body style="margin:0;background:#e5edf2">${markup}</body></html>`);
        const positions = await page.locator('[data-shape]').evaluateAll((elements) => elements.map((element) => {
          const svg = element.querySelector('svg');
          const matrix = svg.getScreenCTM();
          return {
            shape: element.dataset.shape, x: Number(element.dataset.x), y: Number(element.dataset.y),
            matrix: { a: matrix.a, d: matrix.d, e: matrix.e, f: matrix.f },
          };
        }));
        for (const { shape, x, y, matrix } of positions) {
          const hotspot = getCursorHotspot(shape);
          assert.ok(Math.abs(matrix.a * hotspot.x * 100 + matrix.e - x * zoom) < 0.2, `${shape} horizontal tip drift`);
          assert.ok(Math.abs(matrix.d * hotspot.y * 100 + matrix.f - y * zoom) < 0.2, `${shape} vertical tip drift`);
        }
        // Capture through CDP, the same browser surface used by the video exporter.
        const session = await context.newCDPSession(page);
        const capture = await session.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(os.tmpdir(), `moonshot-cursors-${zoom}-${dpr.toFixed(2)}.png`), Buffer.from(capture.data, 'base64'));
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log('Cursor rendering passed: all shapes, three sizes, click states, 80%/100% zoom, standard/export DPR.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
