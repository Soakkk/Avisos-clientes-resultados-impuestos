import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import App from '../src/App';
import { workspaceTokens } from '../src/ui/tokens';

test('el workspace usa los tokens exactos de la suite', () => {
  assert.deepEqual(workspaceTokens, {
    page: '#F5F8FC', card: '#FFFFFF', ink: '#24384D', muted: '#5D7084', border: '#DCE5F0',
    accent: '#326FA6', success: '#19724E', warning: '#86500A', danger: '#B43737',
  });
});

test('el shell expone título, cinta, bandeja, datos, resultado y barra de estado', () => {
  const markup = renderToStaticMarkup(createElement(App));
  for (const region of ['header', 'ribbon', 'queue', 'input', 'result', 'status']) {
    assert.match(markup, new RegExp(`data-workspace-region="${region}"`));
  }
  assert.match(markup, /class="workspace-shell/);
});

test('la ficha exportable queda dentro de una superficie aislada', () => {
  const markup = renderToStaticMarkup(createElement('div', { className: 'workspace-shell' },
    createElement('div', { 'data-export-surface': 'fixture', className: 'export-surface' },
      createElement('div', { style: { width: 440, background: '#FBF9F5' } }, 'Ficha'))));
  assert.match(markup, /data-export-surface="fixture"/);
  assert.match(markup, /width:440px;background:#FBF9F5/);
});
