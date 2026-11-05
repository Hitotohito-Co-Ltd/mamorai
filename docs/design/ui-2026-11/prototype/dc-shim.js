// MAMOR-AI UI案 プロトタイプ用の最小ランタイム（.dc.html の {{穴}} / sc-for / sc-if / onClick を解釈する）。
// 本番コードではありません。画面イメージを手元のブラウザで動かして確認するためだけのものです。
(function () {
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(p) { this.state = Object.assign({}, this.state, typeof p === 'function' ? p(this.state) : p); window.__dcRender(); }
    forceUpdate() { window.__dcRender(); }
  }
  const lookup = (path, scope) => {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
  };
  const HOLE = /\{\{([^}]+)\}\}/g;
  const interp = (s, scope) => s.replace(HOLE, (_, p) => { const v = lookup(p, scope); return v == null ? '' : String(v); });
  const linkFix = (v) => v.replace(/([A-Za-z0-9_-]+)\.dc\.html/g, '$1.html');
  function processChildren(parent, scope) { Array.from(parent.childNodes).forEach((n) => processNode(n, scope)); }
  function processNode(node, scope) {
    if (node.nodeType === 3) { if (HOLE.test(node.nodeValue)) node.nodeValue = interp(node.nodeValue, scope); HOLE.lastIndex = 0; return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'sc-for') {
      const list = lookup((node.getAttribute('list') || '').replace(/[{}]/g, ''), scope) || [];
      const as = node.getAttribute('as') || 'item';
      const frag = document.createDocumentFragment();
      list.forEach((item, i) => {
        const wrap = document.createElement('div');
        Array.from(node.childNodes).forEach((c) => wrap.appendChild(c.cloneNode(true)));
        const sc = Object.assign({}, scope, { [as]: item, $index: i });
        processChildren(wrap, sc);
        while (wrap.firstChild) frag.appendChild(wrap.firstChild);
      });
      node.replaceWith(frag);
      return;
    }
    if (tag === 'sc-if') {
      const v = lookup((node.getAttribute('value') || '').replace(/[{}]/g, ''), scope);
      if (!v) { node.remove(); return; }
      processChildren(node, scope);
      node.replaceWith(...Array.from(node.childNodes));
      return;
    }
    Array.from(node.attributes).forEach((a) => {
      const name = a.name, val = a.value;
      if (/^on[a-z]+$/.test(name)) {
        const m = val.match(/^\s*\{\{([^}]+)\}\}\s*$/);
        node.removeAttribute(name);
        if (m) { const fn = lookup(m[1], scope); if (typeof fn === 'function') node.addEventListener(name.slice(2), fn); }
        return;
      }
      if (name.startsWith('hint-')) { node.removeAttribute(name); return; }
      let nv = val;
      if (val.indexOf('{{') >= 0) nv = interp(val, scope);
      if (name === 'href') nv = linkFix(nv);
      if (nv !== val) node.setAttribute(name, nv);
    });
    processChildren(node, scope);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const host = document.querySelector('x-dc');
    const helmet = host.querySelector('helmet');
    if (helmet) { Array.from(helmet.children).forEach((c) => document.head.appendChild(c)); helmet.remove(); }
    const tpl = document.createElement('template');
    tpl.innerHTML = host.innerHTML;
    const s = document.querySelector('script[data-dc-script]');
    const Component = new Function('DCLogic', s.textContent + '\n;return Component;')(DCLogic);
    const inst = new Component({});
    if (!inst.state) inst.state = {};
    const root = document.createElement('div');
    root.id = 'dc-root';
    host.replaceWith(root);
    window.__dcRender = () => {
      const vals = inst.renderVals();
      const frag = document.importNode(tpl.content, true);
      const box = document.createElement('div');
      box.appendChild(frag);
      processChildren(box, vals);
      root.replaceChildren(...Array.from(box.childNodes));
    };
    window.__dcRender();
  });
})();
