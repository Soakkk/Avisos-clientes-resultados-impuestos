import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoaderOverlay } from '../src/components/LoaderOverlay';

test('el progreso de la bandeja es un estado en flujo y no cubre el aviso revisado', () => {
  const html = renderToStaticMarkup(createElement(LoaderOverlay as any, { step: 2, takingLong: true, inline: true }));
  assert.match(html, /role="status"/);
  assert.match(html, /Gemini está analizando/);
  assert.doesNotMatch(html, /inset-0|backdrop-blur|position:fixed|class="fixed/);
});
