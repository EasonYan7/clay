/* SVG editing keeps the original vector model, attributes, groups and references.
 * SVG text uses a plain-text sidebar editor: HTML rich text cannot safely edit
 * SVG text/tspan nodes without flattening their layout or changing namespaces. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const DRAWABLE = new Set(['g', 'text', 'tspan', 'textpath', 'rect', 'circle', 'ellipse', 'line', 'path', 'polyline', 'polygon', 'image', 'use', 'a']);
  const HIDDEN = new Set(['defs', 'marker', 'clippath', 'mask', 'pattern', 'lineargradient', 'radialgradient', 'symbol']);
  const TEXT = new Set(['text', 'tspan', 'textpath']);
  const DIMENSIONS = { rect: ['width', 'height', 'rx'], circle: ['r'], ellipse: ['rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'] };
  const t = (key) => window.ClayI18n.t('svg.' + key);
  const tag = (c) => String(c && c.get('tagName') || '').toLowerCase();

  function isEditable(comp) {
    if (!comp || comp.get('type') !== 'svg-in' || !DRAWABLE.has(tag(comp))) return false;
    for (let parent = comp.parent(); parent; parent = parent.parent()) {
      if (HIDDEN.has(tag(parent))) return false;
      if (tag(parent) === 'svg') return true;
    }
    return false;
  }

  function offset(value) {
    const raw = String(value || '');
    const match = /^\s*translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)/.exec(raw);
    return match && Number.isFinite(+match[1]) && Number.isFinite(+(match[2] || 0))
      ? { x: +match[1], y: +(match[2] || 0), rest: raw.slice(match[0].length).trim() }
      : { x: 0, y: 0, rest: raw };
  }
  function transform(value, x, y) {
    return `translate(${+x.toFixed(3)} ${+y.toFixed(3)})${value.rest ? ' ' + value.rest : ''}`;
  }
  function point(matrix, x, y) {
    // Chromium exposes SVGMatrix here; it has no DOMMatrix.transformPoint.
    return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
  }
  function hex(value) {
    const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value || '');
    return rgb ? '#' + rgb.slice(1, 4).map((n) => (+n).toString(16).padStart(2, '0')).join('') : '#000000';
  }
  function plainText(comp) {
    return TEXT.has(tag(comp)) && comp.components().every((child) => child.get('type') === 'textnode');
  }

  function install(ed, { onChange = () => {} } = {}) {
    ed.Components.addType('svg-in', { model: { defaults: {
      selectable: true, hoverable: true, editable: false, draggable: false, droppable: false, resizable: false,
    } } });

    const panel = document.createElement('section');
    panel.className = 'svg-properties';
    panel.id = 'svg-properties';
    panel.hidden = true;
    document.getElementById('pane-style').prepend(panel);
    let selected = null;
    let controls = [];
    let drag = null;
    let suppressClick = null;

    function element(name, className, text) {
      const el = document.createElement(name);
      if (className) el.className = className;
      if (text) el.textContent = text;
      return el;
    }
    function normalize(comp) {
      if (comp.get('type') !== 'svg-in') return;
      const editable = isEditable(comp);
      comp.set({ selectable: editable, hoverable: editable, draggable: false, droppable: false, editable: false, resizable: false }, { silent: true });
      if (editable) {
        const toolbar = comp.get('toolbar');
        if (Array.isArray(toolbar)) comp.set('toolbar', toolbar.filter((item) => !['tlb-move', 'clay:add-empty'].includes(item.command)), { silent: true });
        const attrs = comp.getAttributes();
        comp.set('custom-name', attrs['data-node'] || t(TEXT.has(tag(comp)) ? 'textName' : tag(comp) === 'g' ? 'groupName' : 'shapeName'), { silent: true });
      }
    }
    function updateAttr(comp, values) { comp.addAttributes(values); onChange(); }
    function field(key, input, read, apply) {
      const label = element('label', 'svg-field');
      label.dataset.svgField = key;
      label.append(element('span', '', t(key)), input);
      panel.append(label);
      input.addEventListener('change', () => {
        if (selected !== ed.getSelected() || typeof input.checkValidity !== 'function' || !input.checkValidity()) return;
        apply(input.value);
      });
      controls.push({ input, read });
    }
    function numeric(key, read, apply, min) {
      const input = element('input');
      input.type = 'number'; input.step = 'any';
      if (min !== undefined) input.min = min;
      field(key, input, read, (value) => {
        if (value.trim() && Number.isFinite(+value)) apply(+value);
      });
    }
    function paint(key) {
      const row = element('div', 'svg-paint');
      const color = element('input'); color.type = 'color'; color.setAttribute('aria-label', t(key));
      const none = element('input'); none.type = 'checkbox';
      const label = element('label', 'svg-none'); label.append(none, document.createTextNode(t('none')));
      row.append(color, label);
      field(key, row, () => '', () => {});
      const apply = () => {
        if (!selected || selected !== ed.getSelected()) return;
        selected.addStyle({ [key]: none.checked ? 'none' : color.value }); onChange();
      };
      color.addEventListener('input', apply); none.addEventListener('change', apply);
      controls.push({ input: color, read: () => {
        const el = selected.getEl();
        const value = el.ownerDocument.defaultView.getComputedStyle(el).getPropertyValue(key);
        none.checked = value === 'none'; color.disabled = none.checked;
        return hex(value);
      } });
    }
    function rebuild(comp) {
      panel.replaceChildren(); controls = [];
      if (!comp) return;
      panel.append(element('h3', '', t('title')), element('p', 'svg-hint', t('hint')));
      if (plainText(comp)) {
        const input = element('textarea'); input.rows = 3; input.spellcheck = false;
        input.id = 'svg-text';
        field('content', input, () => comp.getEl().textContent, (value) => {
          if (value === comp.getEl().textContent) return;
          // Textnode models render and serialize literal text; do not pass HTML
          // through the component parser or pre-escape it a second time.
          comp.components([{ type: 'textnode', content: value }]); onChange();
        });
      } else if (TEXT.has(tag(comp))) {
        panel.append(element('p', 'svg-hint', t('nestedText')));
      }
      paint('fill'); paint('stroke');
      numeric('strokeWidth', () => comp.getEl().ownerDocument.defaultView.getComputedStyle(comp.getEl()).strokeWidth.replace(/px$/, ''), (n) => comp.addStyle({ 'stroke-width': String(n) }), 0);
      if (TEXT.has(tag(comp))) {
        numeric('fontSize', () => parseFloat(comp.getEl().ownerDocument.defaultView.getComputedStyle(comp.getEl()).fontSize), (n) => comp.addStyle({ 'font-size': n + 'px' }), 1);
        const weight = element('select');
        [100, 200, 300, 400, 500, 600, 700, 800, 900].forEach((n) => {
          const option = element('option', '', String(n)); option.value = String(n); weight.append(option);
        });
        field('fontWeight', weight, () => comp.getEl().ownerDocument.defaultView.getComputedStyle(comp.getEl()).fontWeight, (value) => comp.addStyle({ 'font-weight': value }));
      }
      ['x', 'y'].forEach((axis) => numeric('offset' + axis.toUpperCase(), () => offset(comp.getAttributes().transform)[axis], (n) => {
        const value = offset(comp.getAttributes().transform); value[axis] = n;
        updateAttr(comp, { transform: transform(value, value.x, value.y) });
      }));
      (DIMENSIONS[tag(comp)] || []).forEach((name) => numeric(name, () => comp.getAttributes()[name] || 0, (n) => updateAttr(comp, { [name]: String(n) }), /^(width|height|r|rx|ry)$/.test(name) ? 0 : undefined));
      panel.append(element('p', 'svg-hint', t('moveHint')));
    }
    function render(force = false) {
      const comp = ed.getSelected();
      const editable = isEditable(comp);
      panel.hidden = !editable;
      if (comp !== selected) { selected = editable ? comp : null; rebuild(selected); }
      if (!selected) return;
      controls.forEach(({ input, read }) => {
        if (force || document.activeElement !== input) {
          const value = read();
          if ('value' in input) input.value = value;
        }
      });
    }
    function modelFor(el) {
      let found = null;
      function visit(comp) {
        if (comp.getEl() === el) found = comp;
        if (!found) comp.components().forEach(visit);
      }
      visit(ed.getWrapper());
      return found;
    }
    function finish(cancelled) {
      if (!drag) return;
      const current = drag; drag = null;
      try { current.capture.releasePointerCapture(current.pointerId); } catch (err) { /* Capture may already be released. */ }
      if (current.moved) {
        if (current.original === undefined) current.el.removeAttribute('transform');
        else current.el.setAttribute('transform', current.original);
        if (!cancelled) {
          updateAttr(current.comp, { transform: current.preview });
          ed.select(current.comp);
          suppressClick = { comp: current.comp, until: Date.now() + 250 };
        }
      } else if (!cancelled) ed.select(current.clicked);
    }
    function bind() {
      const doc = ed.Canvas.getDocument();
      if (!doc || !doc.body || doc.__claySvgEditing) return;
      doc.__claySvgEditing = true;
      doc.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.isPrimary === false || ed.Commands.isActive('core:preview')) return;
        const el = event.target;
        if (!el || el.namespaceURI !== NS || !el.ownerSVGElement) return;
        const clicked = modelFor(el);
        if (!isEditable(clicked)) return;
        const old = ed.getSelected();
        const comp = isEditable(old) && tag(old) === 'g' && old.getEl().contains(el) ? old : clicked;
        ed.select(comp);
        const target = comp.getEl();
        const matrix = target.parentElement.getScreenCTM && target.parentElement.getScreenCTM();
        if (!matrix) return;
        try {
          const inverse = matrix.inverse();
          drag = { comp, clicked, el: target, inverse, start: point(inverse, event.clientX, event.clientY),
            original: comp.getAttributes().transform, base: offset(comp.getAttributes().transform), moved: false, pointerId: event.pointerId, capture: doc.documentElement };
        } catch (err) { /* Non-invertible author transforms cannot be dragged. */ }
      }, true);
      doc.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const p = point(drag.inverse, event.clientX, event.clientY);
        const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        if (!drag.moved) {
          try { drag.capture.setPointerCapture(event.pointerId); } catch (err) { /* Synthetic events have no active pointer. */ }
        }
        drag.moved = true;
        drag.preview = transform(drag.base, drag.base.x + dx, drag.base.y + dy);
        drag.el.setAttribute('transform', drag.preview);
        event.preventDefault(); event.stopPropagation();
      }, true);
      doc.addEventListener('pointerup', () => finish(false), true);
      doc.addEventListener('pointercancel', () => finish(true), true);
      doc.addEventListener('click', (event) => {
        const last = suppressClick; suppressClick = null;
        if (!last || last.until < Date.now()) return;
        event.preventDefault(); event.stopImmediatePropagation(); ed.select(last.comp);
      }, true);
      doc.addEventListener('dblclick', (event) => {
        if (ed.Commands.isActive('core:preview')) return;
        const comp = modelFor(event.target);
        if (!isEditable(comp) || !plainText(comp)) return;
        event.preventDefault(); event.stopImmediatePropagation(); ed.select(comp); render(true);
        document.querySelector('#sidebar-tabs [data-tab="style"]').click();
        const input = panel.querySelector('textarea');
        input.focus(); input.select();
      }, true);
      doc.addEventListener('keydown', (event) => {
        const comp = ed.getSelected();
        if (!isEditable(comp) || ed.Commands.isActive('core:preview') || event.metaKey || event.ctrlKey
          || event.target.closest('input,textarea,[contenteditable="true"]')) return;
        if (event.key === 'Escape') { finish(true); return; }
        const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!moves[event.key]) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const value = offset(comp.getAttributes().transform), step = event.shiftKey ? 10 : 1;
        updateAttr(comp, { transform: transform(value, value.x + moves[event.key][0] * step, value.y + moves[event.key][1] * step) });
      }, true);
      doc.defaultView.addEventListener('blur', () => finish(true));
    }
    ed.on('component:mount', (comp) => { normalize(comp); bind(); });
    ed.on('canvas:frame:load canvas:frame:load:body load', bind);
    ed.on('component:selected component:deselected', () => render(true));
    let renderFrame;
    ed.on('component:update update', () => {
      cancelAnimationFrame(renderFrame); renderFrame = requestAnimationFrame(() => render());
    });
    ed.on('undo redo', () => { render(true); requestAnimationFrame(() => render(true)); });
    ed.on('destroy', () => { finish(true); panel.remove(); });
    bind();
    return { flush: () => { finish(true); const input = panel.contains(document.activeElement) && document.activeElement; if (input) input.dispatchEvent(new Event('change', { bubbles: true })); } };
  }
  window.ClaySvgEditor = { install, isEditable };
})();
