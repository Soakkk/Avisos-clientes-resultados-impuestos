import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'SVGElement', 'Element', 'Event', 'MouseEvent', 'navigator', 'localStorage']) {
  Object.defineProperty(globalThis, name, { value: (dom.window as any)[name], configurable: true });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
