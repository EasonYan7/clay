/* Clay 图标集:16×16 描边图标,统一 1.5px 线宽、圆角端点。
 * 用 SVG 而非 emoji —— emoji 在不同系统渲染不一致,且带彩色噪点,不适合工具类界面。 */
(function () {
  const P = {
    home: '<path d="M2.75 7.2 8 2.75l5.25 4.45V12.5a.75.75 0 0 1-.75.75h-9a.75.75 0 0 1-.75-.75V7.2Z"/><path d="M6.5 13.25V9.25h3v4"/>',
    plus: '<path d="M8 3.5v9M3.5 8h9"/>',
    close: '<path d="m4.75 4.75 6.5 6.5m0-6.5-6.5 6.5"/>',
    file: '<path d="M9.25 2.25H4.5a.75.75 0 0 0-.75.75v10a.75.75 0 0 0 .75.75h7a.75.75 0 0 0 .75-.75V5.25l-3-3Z"/><path d="M9 2.5v3h3"/>',
    desktop: '<rect x="2.25" y="3.25" width="11.5" height="7.5" rx="1"/><path d="M6 13.25h4M8 10.75v2.5"/>',
    tablet: '<rect x="4.25" y="2.25" width="7.5" height="11.5" rx="1.25"/><path d="M7.25 11.75h1.5"/>',
    mobile: '<rect x="5.25" y="2.25" width="5.5" height="11.5" rx="1.25"/><path d="M7.25 11.75h1.5"/>',
    undo: '<path d="M5.5 4.75 2.75 7.5 5.5 10.25"/><path d="M2.75 7.5h6.75a3.25 3.25 0 0 1 0 6.5H6.5"/>',
    redo: '<path d="M10.5 4.75 13.25 7.5 10.5 10.25"/><path d="M13.25 7.5H6.5a3.25 3.25 0 0 0 0 6.5h3"/>',
    eye: '<path d="M1.75 8S4.25 3.75 8 3.75 14.25 8 14.25 8 11.75 12.25 8 12.25 1.75 8 1.75 8Z"/><circle cx="8" cy="8" r="1.85"/>',
    sun: '<circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v1.4M8 13.1v1.4M14.5 8h-1.4M2.9 8H1.5M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1"/>',
    moon: '<path d="M13.25 9.4A5.6 5.6 0 0 1 6.6 2.75 5.65 5.65 0 1 0 13.25 9.4Z"/>',
    upload: '<path d="M8 10.5V2.75m0 0L5.25 5.5M8 2.75 10.75 5.5"/><path d="M2.75 9.75v2.5a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-2.5"/>',
    export: '<path d="M6.25 2.75H3.75a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-2.5"/><path d="M9.75 2.75h3.5v3.5"/><path d="m8.25 7.75 5-5"/>',
    sliders: '<path d="M2.75 4.75h10.5M2.75 11.25h10.5"/><circle cx="6" cy="4.75" r="1.6"/><circle cx="10" cy="11.25" r="1.6"/>',
    layers: '<path d="M8 2.25 2.25 5.5 8 8.75 13.75 5.5 8 2.25Z"/><path d="m2.25 10.5 5.75 3.25 5.75-3.25"/>',
    parent: '<path d="M8 12.75V3.25m0 0L4.75 6.5M8 3.25l3.25 3.25"/>',
    folder: '<path d="M1.75 4.25a1 1 0 0 1 1-1h3l1.5 1.75h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1v-7.75Z"/>',
    save: '<path d="M3.75 2.75h7l2.5 2.5v7a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1Z"/><path d="M5.25 2.75v3h5v-3"/><path d="M5 13.25V9.5h6v3.75"/>',
    history: '<path d="M8 4.9V8l2.2 1.6"/><path d="M2.9 6.25A5.5 5.5 0 1 1 2.5 8"/><path d="M2.5 5.25v3h3"/>',
    addblank: '<rect x="2.5" y="2.5" width="11" height="4.4" rx="1.3"/><path d="M8 9.4v3.9M6.05 11.35h3.9"/>',
    pdf: '<path d="M9 2.25H4.5a.75.75 0 0 0-.75.75v10a.75.75 0 0 0 .75.75h7a.75.75 0 0 0 .75-.75V5.25L9 2.25Z"/><path d="M8.75 2.5v3h3"/><path d="M8 7.75v3.5m0 0L6.5 9.75M8 11.25l1.5-1.5"/>',
  };
  window.icon = function (name, size) {
    const s = size || 16;
    return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 16 16" fill="none" ' +
      'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + (P[name] || '') + '</svg>';
  };

  /* 品牌标记:与 .app 图标同一套几何(陶土 C,终端斜切)。
   * id 必须唯一,同页多处使用时渐变才不会互相覆盖。 */
  let markSeq = 0;
  window.brandMark = function (size, radius) {
    const id = 'clayg' + (++markSeq);
    const r = radius === undefined ? 24 : radius;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 100 100" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#8c66ff"/><stop offset=".5" stop-color="#7c5cff"/>' +
      '<stop offset="1" stop-color="#b64cff"/></linearGradient></defs>' +
      '<rect width="100" height="100" rx="' + r + '" fill="url(#' + id + ')"/>' +
      '<path d="M69 34 A22 22 0 1 0 69 66 L58 57 A11 11 0 1 1 58 43 Z" fill="#fff"/>' +
      '</svg>';
  };
})();
