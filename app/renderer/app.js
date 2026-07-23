/* Clay 应用装配层 */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  /* 取色器配置:交给底座内置的 spectrum。
   * 色板偏 Tailwind 常用值(AI 页面多用它),按"中性灰阶 / 红橙 / 绿青 / 蓝紫 / 粉玫"分行,
   * 每行由浅到深。showSelectionPalette + localStorageKey 会自动记住你最近选过的颜色。 */
  const CLAY_COLOR_PICKER = {
    palette: [
      ['#ffffff', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#0f172a', '#000000'],
      ['#fee2e2', '#fca5a5', '#ef4444', '#dc2626', '#b91c1c', '#fed7aa', '#fb923c', '#f97316', '#ea580c', '#c2410c'],
      ['#fef9c3', '#fde047', '#facc15', '#eab308', '#ca8a04', '#dcfce7', '#4ade80', '#22c55e', '#16a34a', '#15803d'],
      ['#ccfbf1', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#cffafe', '#22d3ee', '#06b6d4', '#0891b2', '#0e7490'],
      ['#dbeafe', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#e0e7ff', '#818cf8', '#6366f1', '#4f46e5', '#4338ca'],
      ['#ede9fe', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#fce7f3', '#f472b6', '#ec4899', '#db2777', '#be185d'],
    ],
    showPalette: true,
    showSelectionPalette: true,      // 显示"最近用过"
    maxSelectionSize: 10,
    localStorageKey: 'clay-recent-colors',   // 最近颜色持久化到本地
    hideAfterPaletteSelect: false,
    showInput: true,                 // 顶部十六进制输入
    showInitial: false,              // 关掉"改前对比"—— 空色块会渲染成两个 × 干扰观感
    showAlpha: true,                 // 透明度滑条
    allowEmpty: true,                // 可清空成无色
    clickoutFiresChange: true,       // 点外面即应用当前选择
    preferredFormat: 'hex',
    chooseText: '确定',
    cancelText: '取消',
    clearText: '清除颜色',
    noColorSelectedText: '未选择颜色',
    togglePaletteMoreText: '更多',
    togglePaletteLessText: '收起',
  };

  let editor = null;
  let canvasTailwind = null;   // 当前画布是否带 Tailwind 运行时
  let docTailwind = false;     // 当前文档是否 Tailwind 页面
  let previewing = false;
  /* 导入/切换标签页时程序会批量改画布,撤销栈会收到一堆"变更"。
   * 那不是用户的操作:不能标脏、不能进历史。真人动手之前先把这门关上。 */
  let histSuppressed = false;

  /* 多文档:每个页面一份 GrapesJS 工程数据,标签页之间切换 */
  const docs = [];             // { id, name, isTailwind, scripts, data }
  let activeDocId = null;
  let docSeq = 0;

  /* 工作区持久化:关掉应用不丢活儿。
   * 桌面端写磁盘(userData/workspace.json)—— localStorage 只有 5-10MB,
   * 嵌几张图就爆,而这是有文件系统权限的 Electron 应用,没理由受那个限制。
   * 浏览器里跑(开发/预览)才回退 localStorage。 */
  const STORE_KEY = 'clay-workspace-v1';
  const hasDisk = !!(window.clay && window.clay.saveWorkspace);
  let persistTimer = null;
  let persistWarned = false;
  /* 关键闸门:磁盘还没读完之前,内存里的 docs 是空的。
   * 这期间若发生任何保存(尤其是关窗时的 beforeunload),就会拿空数组
   * 覆盖掉用户的存档 —— 真实丢过一次数据。读完之前一律禁止写。 */
  let restored = false;

  /* 最近编辑过的文件(MRU,最多 9 个,存路径)。跨重启持久化,和 docs 一起存。
   * 主页在"用过编辑"后用它显示最近记录;源文件删/移则渲染时过滤掉不显示。 */
  let recents = [];
  const RECENTS_MAX = 9;

  async function persist() {
    if (!restored) return;      // 没读完不许写,宁可不存也不能覆盖
    snapshotActive();
    const json = JSON.stringify({ docs, activeDocId, docSeq, recents });
    if (hasDisk) {
      const r = await window.clay.saveWorkspace(json);
      if (!r || !r.ok) {
        if (!persistWarned) { persistWarned = true; toast('自动保存失败,请及时导出:' + (r && r.error || '')); }
      } else {
        persistWarned = false;
      }
      return;
    }
    try {
      localStorage.setItem(STORE_KEY, json);
    } catch (e) {
      if (!persistWarned) { persistWarned = true; toast('自动保存失败:内容超出浏览器存储上限,请及时导出'); }
    }
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 900);
  }

  async function restoreWorkspace() {
    let raw = null;
    try {
      if (hasDisk) raw = await window.clay.loadWorkspace();
      else raw = localStorage.getItem(STORE_KEY);
    } catch (e) { /* 读失败:下面会保持 restored=false,绝不写入 */ }

    let saved = null;
    try { saved = JSON.parse(raw || 'null'); } catch (e) { /* 损坏则当空工作区 */ }

    if (saved && Array.isArray(saved.recents)) recents = saved.recents.slice(0, RECENTS_MAX);

    if (!saved || !saved.docs || !saved.docs.length) {
      restored = true;          // 确认过磁盘上本来就是空的,之后可以正常保存
      renderHome();             // 可能有最近记录 → 渲染最近区;没有则手绘引导页
      return false;
    }
    saved.docs.forEach((d) => docs.push(d));
    docSeq = saved.docSeq || docs.length;
    // 这个功能上线前的老工作区没有 recents:用已打开的文件文档补种,老用户也能立刻看到最近区
    if (!recents.length) docs.forEach((d) => { if (d.sourcePath) addRecent(d.sourcePath, d.name); });
    restored = true;            // 数据已进内存,现在保存才是安全的
    renderTabs();
    const target = docs.find((x) => x.id === saved.activeDocId) || docs[0];
    activateDoc(target.id);
    toast('已恢复上次的工作区(' + docs.length + ' 个页面)');
    return true;
  }

  /* ── 最近编辑过的文件 ────────────────────── */
  function addRecent(path, name) {
    if (!path) return;   // 粘贴进来的没有源文件,不进最近记录
    recents = recents.filter((r) => r.path !== path);   // 去重
    recents.unshift({ path, name: name || path.split('/').pop().replace(/\.html?$/i, '') });
    if (recents.length > RECENTS_MAX) recents.length = RECENTS_MAX;
  }
  function removeRecent(path) {
    recents = recents.filter((r) => r.path !== path);
    persist();
    renderHome();
  }
  async function openRecent(path) {
    if (!(window.clay && window.clay.readPath)) return;
    const f = await window.clay.readPath(path);
    if (!f) { toast('打不开:文件可能已被移动或删除'); removeRecent(path); return; }
    runImport(f.content, f.name.replace(/\.html?$/i, ''), f.path);
  }

  // 只显示父级文件夹名,别把整条长路径糊上去
  function prettyDir(p) {
    const parts = String(p).split('/').filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : '';
  }

  /* 主页两态:
   *  - 没有最近记录(第一次用)→ 保持原来的手绘引导页(带指向工具栏的箭头)
   *  - 有最近记录 → 左侧放"打开文件",右侧一格最近编辑卡片;删/移的文件不显示 */
  async function renderHome() {
    const es = $('#empty-state');
    if (!es || es.hidden) return;   // 不在主页就不折腾
    let list = recents.slice(0, RECENTS_MAX);
    // 过滤掉源文件已被删除/移动的(只是不显示,不从存储里删,挪回来还能再出现)
    if (list.length && window.clay && window.clay.filterExisting) {
      try {
        const existing = await window.clay.filterExisting(list.map((r) => r.path));
        const set = new Set(existing || []);
        list = list.filter((r) => set.has(r.path));
      } catch (e) { /* 查不了就先都显示 */ }
    }
    const card = $('.empty-card');
    const has = list.length > 0;
    card.classList.toggle('has-recents', has);
    $('#empty-recents').hidden = !has;
    renderRecentCards(list);
    drawSketch();   // drawSketch 内部会因 has-recents 而不画箭头
  }

  function renderRecentCards(list) {
    const mount = $('#empty-recents');
    if (!mount) return;
    mount.innerHTML = '';
    if (!list.length) return;
    const head = document.createElement('div');
    head.className = 'recent-head';
    head.textContent = '最近编辑';
    mount.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'recent-grid';
    // 按数量动态调整列数:1-2 个一列、3-4 两列、5-9 三列
    const cols = list.length <= 2 ? 1 : list.length <= 4 ? 2 : 3;
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
    list.forEach((r, i) => {
      const c = document.createElement('button');
      c.className = 'recent-card';
      c.style.transform = 'rotate(' + jitter(i * 4 + 1, 1).toFixed(2) + 'deg)';   // 手绘微歪
      c.innerHTML = '<span class="rc-ic">' + window.icon('file', 15) + '</span>' +
        '<span class="rc-name"></span>' +
        '<span class="rc-path"></span>' +
        '<span class="rc-remove" title="从最近移除">' + window.icon('close', 11) + '</span>';
      const nameEl = c.querySelector('.rc-name');
      nameEl.textContent = r.name || r.path.split('/').pop();
      nameEl.title = nameEl.textContent;   // 截断后仍能悬停看到完整文件名
      c.querySelector('.rc-path').textContent = prettyDir(r.path) || '本地文件';
      c.onclick = (e) => {
        if (e.target.closest('.rc-remove')) { removeRecent(r.path); return; }
        openRecent(r.path);
      };
      grid.appendChild(c);
    });
    mount.appendChild(grid);
    fitRecentCardNames();
  }

  /* 标题用的手写字体(--hand)是异步换字体:先拿系统备用字体量一次宽度、判定"不用截断",
   * 字体换好后再用更宽的手写字重绘,但浏览器不会为此重新触发一次 CSS text-overflow 判定——
   * 于是布局判定用的是窄字体的宽度,实际画出来的是宽字体,文字就真的溢出卡片边界了
   * (不是显示问题,是实测复现过的真 bug)。改成不依赖 CSS 自动截断:用 canvas 量出这个
   * 元素"此刻实际会用的字体"画这行字要多宽,超了就在 JS 里手动截短加省略号 —— 跟字体
   * 什么时候换好完全无关,量的就是最终会画出来的宽度。 */
  function truncateToWidth(text, maxPx, font) {
    const canvas = truncateToWidth._canvas || (truncateToWidth._canvas = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    if (ctx.measureText(text).width <= maxPx) return text;
    const ellipsis = '…';
    let lo = 0, hi = text.length;
    while (lo < hi) {   // 二分找能塞下的最长前缀
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxPx) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + ellipsis;
  }
  function fitRecentCardNames() {
    const run = () => {
      $$('.rc-name').forEach((el) => {
        // 存一份没截断过的原文,重复调用(布局稳定前会跑好几次)不会拿已经截断的文本再截一轮
        if (!el.dataset.full) el.dataset.full = el.textContent;
        // 量父卡片的内容宽度,不量它自己的 clientWidth —— flex 子项没设 min-width:0 时
        // 会被长文本撑宽(实测复现过),这时量自己等于拿"已经撑宽的盒子"去判断要不要截断,
        // 永远判断不需要。虽然 CSS 那边也补了 min-width:0,这里量父级是双重保险。
        const card = el.closest('.recent-card');
        if (!card) return;
        const cardCs = getComputedStyle(card);
        const avail = card.clientWidth - parseFloat(cardCs.paddingLeft) - parseFloat(cardCs.paddingRight);
        if (!avail || avail <= 0) return;
        const cs = getComputedStyle(el);
        const font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontFamily;
        el.textContent = truncateToWidth(el.dataset.full, avail, font);
      });
    };
    run();   // 先跑一次,大多数情况字体已经就绪
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);   // 字体换好后再量一遍兜底
    requestAnimationFrame(run);   // 布局(卡片宽度)稳定后再量一遍,双重保险
  }

  /* ── 样式面板(中文化,面向非技术用户)──────────
   * 数字属性必须声明 type:'integer' + units,否则输入 "30" 会写出无单位的
   * `font-size:30`(无效 CSS,浏览器静默忽略)。颜色属性用 type:'color' 出取色器。 */
  const LEN = ['px', '%', 'em', 'rem', 'vw', 'vh'];
  const num = (property, name, units, extra) => Object.assign(
    { property, name, type: 'integer', units: units || ['px', 'em', 'rem', '%'], min: 0 }, extra || {});
  const sel = (property, name, options) => ({
    property, name, type: 'select', defaults: '',
    options: [{ id: '', label: '默认' }].concat(options),
  });

  const SECTORS = [
    {
      name: '文字', open: true,
      properties: [
        num('font-size', '字号'),
        sel('font-weight', '粗细', [
          { id: '300', label: '细' }, { id: '400', label: '常规' }, { id: '500', label: '中等' },
          { id: '600', label: '半粗' }, { id: '700', label: '加粗' }, { id: '800', label: '特粗' },
        ]),
        { property: 'color', name: '颜色', type: 'color' },
        sel('text-align', '对齐', [
          { id: 'left', label: '左对齐' }, { id: 'center', label: '居中' },
          { id: 'right', label: '右对齐' }, { id: 'justify', label: '两端对齐' },
        ]),
        num('line-height', '行高'),
        num('letter-spacing', '字距', ['px', 'em'], { min: -20 }),
      ],
    },
    {
      name: '背景', open: false,
      properties: [
        { property: 'background-color', name: '背景色', type: 'color' },
        { property: 'background-image', name: '背景图/渐变' },
      ],
    },
    {
      name: '圆角与边框', open: false,
      properties: [
        num('border-radius', '圆角', ['px', '%', 'em']),
        {
          property: 'border', name: '边框', type: 'composite',
          properties: [
            num('border-width', '粗细', ['px', 'em']),
            sel('border-style', '线型', [
              { id: 'solid', label: '实线' }, { id: 'dashed', label: '虚线' },
              { id: 'dotted', label: '点线' }, { id: 'none', label: '无' },
            ]),
            { property: 'border-color', name: '颜色', type: 'color' },
          ],
        },
        {
          // stack 类型:可叠多层阴影,每层分字段调,不用手写 CSS
          property: 'box-shadow', name: '阴影', type: 'stack',
          properties: [
            num('box-shadow-h', '水平', ['px'], { min: -100 }),
            num('box-shadow-v', '垂直', ['px'], { min: -100 }),
            num('box-shadow-blur', '模糊', ['px']),
            num('box-shadow-spread', '扩散', ['px'], { min: -100 }),
            { property: 'box-shadow-color', name: '颜色', type: 'color' },
          ],
        },
      ],
    },
    {
      name: '间距', open: false,
      properties: [
        {
          property: 'margin', name: '外间距', type: 'composite',
          properties: [
            num('margin-top', '上', LEN), num('margin-right', '右', LEN),
            num('margin-bottom', '下', LEN), num('margin-left', '左', LEN),
          ],
        },
        {
          property: 'padding', name: '内间距', type: 'composite',
          properties: [
            num('padding-top', '上', LEN), num('padding-right', '右', LEN),
            num('padding-bottom', '下', LEN), num('padding-left', '左', LEN),
          ],
        },
      ],
    },
    {
      name: '尺寸', open: false,
      properties: [
        num('width', '宽度', LEN), num('height', '高度', LEN),
        num('max-width', '最大宽度', LEN), num('min-height', '最小高度', LEN),
      ],
    },
    {
      name: '排列(容器)', open: false,
      properties: [
        sel('display', '布局方式', [
          { id: 'block', label: '块' }, { id: 'flex', label: '弹性排列' },
          { id: 'grid', label: '网格' }, { id: 'inline-block', label: '行内块' },
          { id: 'none', label: '隐藏' },
        ]),
        sel('flex-direction', '方向', [
          { id: 'row', label: '横排' }, { id: 'column', label: '竖排' },
          { id: 'row-reverse', label: '横排(反)' }, { id: 'column-reverse', label: '竖排(反)' },
        ]),
        sel('justify-content', '主轴对齐', [
          { id: 'flex-start', label: '起始' }, { id: 'center', label: '居中' },
          { id: 'flex-end', label: '末尾' }, { id: 'space-between', label: '两端分散' },
          { id: 'space-around', label: '均匀分散' },
        ]),
        sel('align-items', '交叉轴对齐', [
          { id: 'flex-start', label: '起始' }, { id: 'center', label: '居中' },
          { id: 'flex-end', label: '末尾' }, { id: 'stretch', label: '拉伸' },
        ]),
        num('gap', '子项间距', ['px', 'em', 'rem']),
        sel('flex-wrap', '换行', [
          { id: 'nowrap', label: '不换行' }, { id: 'wrap', label: '换行' },
        ]),
      ],
    },
    {
      name: '效果', open: false,
      properties: [
        { property: 'opacity', name: '不透明度', type: 'slider', defaults: 1,
          min: 0, max: 1, step: 0.01 },
      ],
    },
  ];

  /* ── 编辑器创建/重建 ─────────────────────── */
  function ensureEditor(tailwind) {
    if (editor && canvasTailwind === tailwind) return editor;
    if (editor) {
      editor.destroy();
      ['#canvas', '#style-mount', '#layers-mount', '#selector-mount', '#traits-mount']
        .forEach((s) => { $(s).innerHTML = ''; });
    }
    canvasTailwind = tailwind;
    editor = grapesjs.init({
      container: '#canvas',
      height: '100%',
      fromElement: false,
      storageManager: false,
      panels: { defaults: [] },
      // 关键决策:样式默认写到"这一个元素"(内部用唯一标识),
      // 修复实测的"改一张卡片三张全变"与规则打架问题
      selectorManager: { componentFirst: true, appendTo: '#selector-mount' },
      styleManager: { appendTo: '#style-mount', sectors: SECTORS },
      layerManager: { appendTo: '#layers-mount' },
      traitManager: { appendTo: '#traits-mount' },
      deviceManager: {
        devices: [
          { id: 'desktop', name: '桌面', width: '' },
          { id: 'tablet', name: '平板', width: '768px', widthMedia: '992px' },
          { id: 'mobile', name: '手机', width: '375px', widthMedia: '480px' },
        ],
      },
      canvas: { scripts: tailwind ? ['vendor/tailwind-play.js'] : [] },
      // 取色器(底座内置 spectrum,本就带渐变色盘+色相+透明度):
      // 补一套精选常用色板 + 记住最近用过的颜色 + 中文按钮 + 可清空。
      colorPicker: CLAY_COLOR_PICKER,
    });
    wireEditorEvents(editor);
    window.__clayEditor = editor; // 调试句柄
    return editor;
  }

  /* 相对路径的图片/资源(常见于 AI 工具导出的"HTML + 素材文件夹"):浏览器直接打开
   * 原文件时,相对路径天然以文件所在目录为基准解析,能正常显示;但 Clay 画布是独立的
   * iframe,不带这个基准,同样的相对路径会解析错位,图裂成"未找到"占位符。
   * 修法:给 iframe 的 <head> 插一个指回源文件目录的 <base>,相对路径就能按浏览器里
   * 同样的方式解析。没有源文件(粘贴导入)时清空,不装错的。 */
  function applyCanvasBase(doc, sourcePath) {
    const old = doc.getElementById('clay-base');
    if (old) old.remove();
    if (!sourcePath) return;
    const dir = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
    const href = 'file://' + dir.split('/').map(encodeURIComponent).join('/');
    const base = doc.createElement('base');
    base.id = 'clay-base';
    base.href = href;
    doc.head.insertBefore(base, doc.head.firstChild);
  }

  /* 插入 base 这件事不跟 GrapesJS 的渲染时机打游击 —— 实测踩过两次坑:
   *  1) 本次会话第一次导入时,画布 iframe 的 document 还没就绪,插入静默落空;
   *  2) 就算插成功了,紧随其后的 setComponents()/loadProjectData() 会把 <head>
   *     按它自己的组件快照整个重置一遍(它不认识我们手动插的节点),又把它冲掉。
   * 索性都不在"装内容之前"插,统一放到装完之后的自愈扫描里、错开几拍反复补:
   * 不管 GrapesJS 什么时候把 head/图片弄乱,下一拍总能追上来修好。
   * 每一拍都校验"现在是不是还在看这个文档",避免快速切标签页时张冠李戴。 */
  function healCanvas(ed, docId) {
    if (ed !== editor || docId !== activeDocId) return;   // 早就切走了,别乱插手
    const d = docs.find((x) => x.id === docId);
    if (!d) return;
    try {
      const doc = ed.Canvas.getDocument();
      if (doc && doc.head) applyCanvasBase(doc, d.sourcePath);   // 幂等:href 没变就不动
      const wrapper = ed.getWrapper();
      if (!wrapper) return;
      // "DOM 显示的 src 跟组件模型里的原始 src 对不上"(被换成了失败占位图),或者
      // "src 没变但加载完了却是 0 宽"(失败但没触发占位替换)—— 从模型里的干净原值
      // 重新触发一次加载。先移除属性再设回去,确保浏览器一定当作"变了"重新发请求。
      wrapper.find('img').forEach((comp) => {
        const el = comp.getEl && comp.getEl();
        const real = comp.getAttributes && comp.getAttributes().src;
        if (!el || !real) return;
        const broken = el.getAttribute('src') !== real || (el.complete && el.naturalWidth === 0);
        if (!broken) return;
        el.removeAttribute('src');
        el.setAttribute('src', real);
      });
    } catch (e) { /* 这一拍画布没就绪就跳过,下一拍还会再试 */ }
  }
  function scheduleCanvasHeal(ed, docId) {
    [0, 300, 900, 2000].forEach((t) => setTimeout(() => healCanvas(ed, docId), t));
  }

  /* 选中元素后浮出的那四个按钮,原本全靠猜。这里给它们加悬停提示。
   * 按 toolbar 模型里的 command 认人,而不是认图标或位置 ——
   * 不同组件类型的按钮数量会变(第一个"选父级"在模型里没有 command)。 */
  const TOOLBAR_TIPS = {
    'tlb-move': '按住拖动',
    'tlb-clone': '同级复制',
    'clay:add-empty': '下方加空白同类',
    'tlb-delete': '删除',
  };

  function tipForToolbarItem(el) {
    const bar = el.parentElement;
    if (!bar) return '';
    const idx = [...bar.children].indexOf(el);
    const sel = editor && editor.getSelected();
    const model = (sel && sel.get('toolbar')) || [];
    const cmd = model[idx] && model[idx].command;
    if (typeof cmd === 'string' && TOOLBAR_TIPS[cmd]) return TOOLBAR_TIPS[cmd];
    return idx === 0 ? '选中上一层' : '';   // 首位固定是"选父级",模型里不带 command
  }

  function enableToolbarTips() {
    const tip = document.createElement('div');
    tip.id = 'tb-tip';
    tip.hidden = true;
    document.body.appendChild(tip);

    const show = (el) => {
      const text = tipForToolbarItem(el);
      if (!text) return;
      tip.textContent = text;
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      // 默认压在按钮上方;顶到窗口边就翻到下方
      let top = r.top - t.height - 7;
      if (top < 4) top = r.bottom + 7;
      let left = r.left + r.width / 2 - t.width / 2;
      left = Math.max(4, Math.min(left, document.documentElement.clientWidth - t.width - 4));
      tip.style.top = top + 'px';
      tip.style.left = left + 'px';
    };

    // 工具条是 GrapesJS 动态插进来的,只能用事件委托
    document.addEventListener('mouseover', (e) => {
      const item = e.target.closest && e.target.closest('.gjs-toolbar-item');
      if (item) show(item);
    });
    document.addEventListener('mouseout', (e) => {
      const item = e.target.closest && e.target.closest('.gjs-toolbar-item');
      if (item) tip.hidden = true;
    });
    // 一按下就收起,免得挡住拖拽
    document.addEventListener('mousedown', () => { tip.hidden = true; });
  }

  function wireEditorEvents(ed) {
    ed.on('component:selected', refreshSelectionUI);
    ed.on('component:deselected', refreshSelectionUI);
    ed.on('component:selected', scheduleComputed);
    ed.on('component:deselected', scheduleComputed);
    ed.on('component:styleUpdate', scheduleComputed);
    ed.on('update', schedulePersist);   // 任何修改后自动保存
    /* 撤销栈进出 → 重算历史并决定要不要标脏。
     * 关键:componentFirst 模式下"选中元素"会顺手建一条空占位规则,这也会进撤销栈,
     * 但它不是编辑。识别办法不去猜 GrapesJS 内部模型形状(实测时序不稳),而是复用
     * describeGroup —— 它能把真编辑分类成"调整…/删除…";它认不出的(占位)一律不算。 */
    ed.UndoManager.getStack().on('add', () => { if (!histSuppressed) scheduleEditReconcile(); });
    ed.UndoManager.getStack().on('remove reset', scheduleHistory);
    ed.on('undo redo', () => { if (!histSuppressed) scheduleEditReconcile(); });
    enableDirectDrag(ed);
    enableImageReplace(ed);
    enableAddEmpty(ed);
    enableCanvasFileDrop(ed);
  }

  /* 选中元素后的第五个工具:在它下方插入一个"同类型、继承相同类名(样式一致)、内容为空"的元素。
   * 和"同级复制"的区别:复制会把内容一起带过来,这个是给你一个干净的空壳去填。 */
  function enableAddEmpty(ed) {
    const TEXT_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'button', 'li', 'label', 'strong', 'em'];
    ed.Commands.add('clay:add-empty', {
      run(editor) {
        const sel = editor.getSelected();
        if (!sel) return;
        const parent = sel.parent();
        if (!parent) return;                       // 页面根节点没有父级,不处理
        const tag = (sel.get('tagName') || 'div').toLowerCase();
        // 只继承 class(共享样式),不继承 id 规则 —— 那是"这一个"的专属样式;新元素拿到自己的新 id
        const classes = (sel.getClasses && sel.getClasses().slice()) || [];
        const def = { tagName: tag, classes };
        // 纯空的文本元素高度为 0、看不见也点不到,给个占位字方便双击替换;容器类才真的留空
        if (TEXT_TAGS.indexOf(tag) > -1) def.content = '新' + (baseTextName(tag));
        const at = (typeof sel.index === 'function' ? sel.index() : 0) + 1;
        const added = parent.append(def, { at })[0];
        if (added) {
          // 给个中文名,图层树和历史里显示"标题/文本/容器"而不是"H1/DIV"
          added.set('custom-name', TEXT_TAGS.indexOf(tag) > -1 ? baseTextName(tag) : (sel.get('custom-name') || '容器'));
          editor.select(added);
          const el = added.getEl && added.getEl();
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      },
    });

    // 选中任一元素时,把这个按钮插到工具栏"同级复制"的后面(只插一次)
    ed.on('component:selected', (comp) => {
      if (!comp || comp === ed.getWrapper()) return;
      const tb = comp.get('toolbar');
      if (!tb || !tb.length) return;
      if (tb.some((t) => t.command === 'clay:add-empty')) return;   // 已经有了
      const i = tb.findIndex((t) => t.command === 'tlb-clone');
      const btn = { label: window.icon('addblank', 16), command: 'clay:add-empty' };
      tb.splice(i > -1 ? i + 1 : tb.length, 0, btn);
      comp.set('toolbar', tb.slice());   // 换新数组引用,触发工具栏重渲染
    });
  }

  // 给占位文案起个贴切的词
  function baseTextName(tag) {
    if (/^h[1-6]$/.test(tag)) return '标题';
    if (tag === 'a') return '链接';
    if (tag === 'button') return '按钮';
    if (tag === 'li') return '列表项';
    return '文本';
  }

  /* 自研吸附拖拽:按住已选元素直接拖动,紫色指示线提示落点,
   * 松手时通过 component.move() 换位(保持 DOM 结构干净,不产生绝对定位) */
  function enableDirectDrag(ed) {
    const bind = () => {
      const cdoc = ed.Canvas.getDocument();
      if (!cdoc || !cdoc.body || cdoc.__clayDragBound) return;
      cdoc.__clayDragBound = true;
      let start = null;   // 按下待判定
      let drag = null;    // 拖拽进行中 { comp, elMap, drop }
      let line = null;

      const ensureLine = () => {
        if (line && line.ownerDocument === cdoc) return line;
        line = cdoc.createElement('div');
        line.style.cssText =
          'position:fixed;z-index:99999;background:#7c5cff;border-radius:2px;' +
          'pointer-events:none;display:none;box-shadow:0 0 8px rgba(124,92,255,.9)';
        cdoc.body.appendChild(line);
        return line;
      };

      const mapEls = () => {
        const m = new Map();
        (function walk(c) {
          const el = c.getEl && c.getEl();
          if (el && el.nodeType === 1) m.set(el, c);
          if (c.components) c.components().forEach(walk);
        })(ed.getWrapper());
        return m;
      };

      const isDescendant = (comp, ancestor) => {
        let p = comp;
        while (p) { if (p === ancestor) return true; p = p.parent && p.parent(); }
        return false;
      };

      // 找落点:指针下最近的可作为"兄弟"的组件 + 前/后
      // 注:用 e.target 而非 elementFromPoint(画布 iframe 的 viewport 尺寸不可靠)
      const resolveDrop = (e) => {
        let el = e.target && e.target.nodeType === 1 ? e.target : null;
        while (el && el !== cdoc.body && !drag.elMap.has(el)) el = el.parentElement;
        if (!el || el === cdoc.body) return null;
        let target = drag.elMap.get(el);
        if (target === drag.comp || isDescendant(target, drag.comp)) return null;
        if (!target.parent || !target.parent()) return null;
        const r = el.getBoundingClientRect();
        const pEl = el.parentElement;
        // flex-direction 的 computed 值对普通 block 容器也默认是 'row',不能直接拿它判横排 ——
        // 否则竖直堆叠的 block 子元素会被误当成横排,插入线画成竖线、还按 X 坐标判前后。
        // 只有真的是 flex 容器才信 flex-direction;grid 视为横排;其余一律按竖排。
        const disp = pEl ? cdoc.defaultView.getComputedStyle(pEl).display : '';
        const horizontal = disp === 'grid'
          || ((disp === 'flex' || disp === 'inline-flex')
              && /^row/.test(cdoc.defaultView.getComputedStyle(pEl).flexDirection || ''));
        const after = horizontal
          ? e.clientX > r.x + r.width / 2
          : e.clientY > r.y + r.height / 2;
        return { target, after, rect: r, horizontal };
      };

      const drawLine = (drop) => {
        const l = ensureLine();
        if (!drop) { l.style.display = 'none'; return; }
        const { rect, after, horizontal } = drop;
        l.style.display = 'block';
        if (horizontal) {
          l.style.width = '3px';
          l.style.height = rect.height + 'px';
          l.style.top = rect.y + 'px';
          l.style.left = (after ? rect.x + rect.width : rect.x) - 1.5 + 'px';
        } else {
          l.style.height = '3px';
          l.style.width = rect.width + 'px';
          l.style.left = rect.x + 'px';
          l.style.top = (after ? rect.y + rect.height : rect.y) - 1.5 + 'px';
        }
      };

      const endDrag = (commit) => {
        if (!drag) return;
        if (commit && drag.drop) {
          const { target, after } = drag.drop;
          const parent = target.parent();
          const at = parent.components().indexOf(target) + (after ? 1 : 0);
          drag.comp.move(parent, { at }); // move() 的 at 采用移动前的原始索引语义
          toast('已移动「' + drag.comp.getName() + '」');
        }
        drawLine(null);
        cdoc.body.style.userSelect = '';
        drag = null;
      };

      const dbg = (window.__clayDragDbg = { down: '-', move: 0, dragOn: false });
      cdoc.addEventListener('mousedown', (e) => {
        start = null;
        if (e.button !== 0) return (dbg.down = 'button');
        const sel = ed.getSelected();
        if (!sel || sel === ed.getWrapper()) return (dbg.down = 'no-sel');
        const el = sel.getEl();
        if (!el || !el.contains(e.target)) return (dbg.down = 'outside');
        if (el.getAttribute('contenteditable') === 'true') return (dbg.down = 'rte');
        start = { x: e.clientX, y: e.clientY, comp: sel };
        dbg.down = 'armed';
      });

      cdoc.addEventListener('mousemove', (e) => {
        dbg.move++;
        if (start && !drag) {
          if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 8) {
            drag = { comp: start.comp, elMap: mapEls(), drop: null };
            cdoc.body.style.userSelect = 'none';
            start = null;
            dbg.dragOn = true;
          }
          return;
        }
        if (!drag) return;
        e.preventDefault();
        drag.drop = resolveDrop(e);
        drawLine(drag.drop);
      });

      cdoc.addEventListener('mouseup', () => { endDrag(true); start = null; });
      cdoc.addEventListener('keydown', (e) => { if (e.key === 'Escape') endDrag(false); });
      cdoc.defaultView.addEventListener('blur', () => endDrag(false));
    };
    ed.on('load', bind);
    ed.on('canvas:frame:load:body', bind);
    bind(); // load 事件可能已经错过,立即尝试
    // 兜底轮询:画布 iframe 就绪时机不可靠,绑上即停
    const timer = setInterval(() => {
      bind();
      const d = ed.Canvas.getDocument();
      if (d && d.__clayDragBound) clearInterval(timer);
    }, 200);
    setTimeout(() => clearInterval(timer), 15000);
    ed.on('destroy', () => clearInterval(timer));
  }

  /* 双击图片 → 选本地文件替换(接管默认的素材库弹窗)
   * 大图先压缩再嵌入:2MB 原图直接 base64 会把 HTML 撑到 2.7MB */
  function compressImage(file, cb) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const needResize = scale < 1;
      const needRecode = file.size > 250 * 1024;
      if (!needResize && !needRecode) {
        const r = new FileReader();
        r.onload = () => cb(r.result, false);
        r.readAsDataURL(file);
        return;
      }
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      // PNG 可能带透明,保持 PNG;其余转 JPEG 压质量
      const isPng = file.type === 'image/png';
      cb(cv.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85), true);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('读取图片失败'); };
    img.src = url;
  }

  function enableImageReplace(ed) {
    ed.Commands.add('open-assets', {
      run(_ed, _sender, opts) {
        const target = opts && opts.target;
        if (!target || target.get('type') !== 'image') return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
          const file = input.files[0];
          if (!file) return;
          compressImage(file, (dataUrl, compressed) => {
            target.set('src', dataUrl);
            toast(compressed ? '图片已替换(已压缩,便于导出)' : '图片已替换');
          });
        };
        input.click();
      },
    });
  }

  /* ── 选中状态与"应用到同款" ───────────────── */
  function classSig(comp) {
    return ((comp.getAttributes().class || '') + '').trim();
  }

  function findSimilar(comp) {
    const sig = classSig(comp);
    const tag = comp.get('tagName');
    if (!sig || sig.length < 16) return [];
    const all = [];
    (function walk(c) {
      if (c !== comp && c.get('tagName') === tag && classSig(c) === sig) all.push(c);
      if (c.components) c.components().forEach(walk);
    })(editor.getWrapper());
    return all;
  }

  function refreshSelectionUI() {
    const sel = editor && editor.getSelected();
    const nameEl = $('#selection-name');
    const parentBtn = $('#btn-select-parent');
    const similarBar = $('#apply-similar-bar');
    const hint = $('#style-hint');
    if (!sel || sel === editor.getWrapper()) {
      nameEl.textContent = '未选中元素';
      nameEl.classList.add('muted');
      parentBtn.hidden = true;
      similarBar.hidden = true;
      hint.style.display = '';
      $('#style-mount').style.display = 'none'; // 没选中时不露出空字段
      return;
    }
    nameEl.textContent = sel.getName();
    nameEl.classList.remove('muted');
    parentBtn.hidden = !sel.parent();
    hint.style.display = 'none';
    $('#style-mount').style.display = '';
    const similar = findSimilar(sel);
    if (similar.length) {
      $('#btn-apply-similar').textContent = `把修改应用到 ${similar.length} 个同款元素`;
      similarBar.hidden = false;
    } else {
      similarBar.hidden = true;
    }
  }

  /* ── 计算样式回显:面板显示元素的真实渲染值 ──
   * GrapesJS 只显示编辑器写过的规则;元素从类/样式表继承的实际值读不到。
   * 这里读 getComputedStyle,灰字占位回显到每个输入框,并更新信息卡。 */
  function rgb2hex(v) {
    const m = v && v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return v || '';
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return '透明';
    const hex = '#' + [1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, '0')).join('');
    return m[4] !== undefined && parseFloat(m[4]) < 1
      ? hex + ' ' + Math.round(parseFloat(m[4]) * 100) + '%' : hex;
  }

  function computedMap(el) {
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    const none = (v, n) => (v === n ? '' : v);
    const m = {
      'font-size': cs.fontSize,
      'font-weight': cs.fontWeight,
      'color': rgb2hex(cs.color),
      'text-align': cs.textAlign,
      'line-height': none(cs.lineHeight, 'normal'),
      'letter-spacing': none(cs.letterSpacing, 'normal'),
      'background-color': rgb2hex(cs.backgroundColor),
      'background-image': none(cs.backgroundImage, 'none'),
      'border-radius': cs.borderRadius,
      'border': cs.borderTopWidth === '0px' ? '' :
        cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + rgb2hex(cs.borderTopColor),
      'box-shadow': none(cs.boxShadow, 'none'),
      'margin': [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].join(' '),
      'padding': [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      'width': cs.width, 'height': cs.height,
      'max-width': none(cs.maxWidth, 'none'), 'min-height': cs.minHeight,
      'display': cs.display,
      'flex-direction': cs.flexDirection,
      'justify-content': cs.justifyContent,
      'align-items': cs.alignItems,
      'gap': none(cs.gap, 'normal'),
      'flex-wrap': cs.flexWrap,
      'opacity': cs.opacity,
      // 复合控件的分格子属性
      'border-width': cs.borderTopWidth, 'border-style': cs.borderTopStyle,
      'border-color': rgb2hex(cs.borderTopColor),
    };
    ['margin', 'padding'].forEach((p) => ['Top', 'Right', 'Bottom', 'Left'].forEach((s) => {
      m[p + '-' + s.toLowerCase()] = cs[p + s];
    }));
    [['top-left', 'TopLeft'], ['top-right', 'TopRight'],
     ['bottom-left', 'BottomLeft'], ['bottom-right', 'BottomRight']].forEach(([k, j]) => {
      m['border-' + k + '-radius'] = cs['border' + j + 'Radius'];
    });
    return m;
  }

  function setSwatch(swId, txtId, val) {
    const sw = $(swId), txt = $(txtId);
    txt.textContent = val || '—';
    sw.style.background = (!val || val === '透明') ? 'transparent' : val.split(' ')[0];
  }

  /* 输入即生效:GrapesJS 默认只在失焦时提交(回车都不认),对非技术用户很不直观。
   * 这里补上"回车提交"和"停止输入 350ms 后实时预览",并在面板重建后找回焦点与光标。 */
  function enableLiveStyleInput() {
    const mount = $('#style-mount');
    let timer = null;

    const commit = (inp) => {
      const propEl = inp.closest('[class*="gjs-sm-property__"]');
      const propCls = propEl && [...propEl.classList].find((c) => c.indexOf('gjs-sm-property__') === 0);
      const caret = inp.selectionStart;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      // 面板可能被重建,把焦点和光标放回同一个属性的输入框
      setTimeout(() => {
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
        const back = propCls && $('.' + propCls + ' input');
        if (!back) return;
        back.focus();
        try { back.setSelectionRange(caret, caret); } catch (e) { /* 非文本框忽略 */ }
      }, 0);
    };

    mount.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      clearTimeout(timer);
      commit(e.target);
    });

    mount.addEventListener('input', (e) => {
      const inp = e.target;
      if (inp.tagName !== 'INPUT') return;
      if (inp.type !== 'text' && inp.type !== 'number') return;
      clearTimeout(timer);
      timer = setTimeout(() => commit(inp), 350);
    });
  }

  let sizeObserver = null;
  let observedEl = null;
  function watchSelectedSize(el) {
    if (observedEl === el) return;
    if (sizeObserver) { sizeObserver.disconnect(); sizeObserver = null; }
    observedEl = el;
    if (!el) return;
    const W = el.ownerDocument.defaultView;
    if (!W || !W.ResizeObserver) return;
    // 布局稳定(Tailwind JIT/图片加载)后自动刷新回显
    sizeObserver = new W.ResizeObserver(() => injectComputed());
    sizeObserver.observe(el);
  }

  function injectComputed() {
    if (!editor) return;
    const sel = editor.getSelected();
    const info = $('#el-info');
    if (!sel || sel === editor.getWrapper() || !sel.getEl()) {
      info.hidden = true;
      watchSelectedSize(null);
      return;
    }
    const el = sel.getEl();
    watchSelectedSize(el);
    const map = computedMap(el);
    // 1) 每个属性输入框的灰字占位
    $$('#style-mount [class*="gjs-sm-property__"]').forEach((propEl) => {
      const cls = [...propEl.classList].find((c) => c.indexOf('gjs-sm-property__') === 0);
      const prop = cls && cls.slice('gjs-sm-property__'.length);
      const val = map[prop];
      if (val === undefined) return;
      propEl.querySelectorAll('input').forEach((inp) => {
        if (inp.type === 'text' && !inp.value) inp.placeholder = val || '—';
      });
      // 只回显"取值下拉框";整数属性旁边的单位下拉框不能碰
      const select = propEl.querySelector('.gjs-field-select select');
      if (select && !select.classList.contains('gjs-input-unit')) {
        const defOpt = [...select.options].find((o) => !o.value);
        if (defOpt) defOpt.textContent = val ? '默认 · ' + val : '默认';
      }
    });
    // 2) 信息卡
    const r = el.getBoundingClientRect();
    $('#info-size').textContent = Math.round(r.width) + ' × ' + Math.round(r.height) + ' px';
    $('#info-font').textContent = map['font-size'] + ' / ' + map['font-weight'];
    setSwatch('#info-color-sw', '#info-color', map['color']);
    if (map['background-color'] === '透明' && map['background-image']) {
      $('#info-bg').textContent = map['background-image'].indexOf('gradient') > -1 ? '渐变' : '图片';
      $('#info-bg-sw').style.background = map['background-image'];
    } else {
      setSwatch('#info-bg-sw', '#info-bg', map['background-color']);
    }
    $('#info-radius').textContent = map['border-radius'] === '0px' ? '无' : map['border-radius'];
    info.hidden = false;
  }

  let computedTimers = [];
  function scheduleComputed() {
    computedTimers.forEach(clearTimeout);
    // 面板重渲染是异步的,且导入初期 Tailwind JIT 尚未完成布局,分三拍注入
    computedTimers = [60, 300, 1200].map((t) => setTimeout(injectComputed, t));
  }

  /* ── 多文档管理 ──────────────────────────── */
  function snapshotActive() {
    if (!activeDocId || !editor) return;
    const d = docs.find((x) => x.id === activeDocId);
    if (d) d.data = editor.getProjectData();
  }

  function renderTabs() {
    const list = $('#tabs-list');
    list.innerHTML = '';
    docs.forEach((d) => {
      const tab = document.createElement('button');
      tab.className = 'doc-tab' + (d.id === activeDocId ? ' active' : '');
      tab.title = d.name;
      tab.dataset.id = d.id;
      tab.innerHTML = window.icon('file', 13) +
        '<span class="dt-name"></span>' +
        (d.dirty ? '<span class="dt-dot" title="有未保存的修改"></span>' : '') +
        '<span class="dt-close" title="关闭">' + window.icon('close', 11) + '</span>';
      tab.querySelector('.dt-name').textContent = d.name;
      tab.onclick = (e) => {
        if (tab.dataset.dragged === '1') { tab.dataset.dragged = ''; return; }  // 拖完别顺手触发点击
        if (e.target.closest('.dt-close')) { closeDoc(d.id); return; }
        activateDoc(d.id);
      };
      tab.addEventListener('mousedown', (e) => startTabDrag(e, tab));
      list.appendChild(tab);
    });
    $('#doctabs').hidden = docs.length === 0;
    // 工具栏保存按钮上的小圆点跟标签页同步
    const act = docs.find((x) => x.id === activeDocId);
    const sd = $('#save-dot');
    if (sd) sd.hidden = !(act && act.dirty);
  }

  /* 脏标记 = 「有没保存到文件里的修改」,和 Word 的语义一致。
   * 工作区自动存盘只保证关掉 Clay 不丢活儿,不等于用户的 .html 文件已更新。
   * 具体判定在 scheduleEditReconcile:相对"保存点"的增量里有真编辑才算脏。 */

  /* 标签页拖拽排序(仿 Chrome):按住横向拖,其余标签实时让位,松手落位。
   * 用鼠标事件手写而非 HTML5 drag —— 后者没法做出"边拖边让位"的实时效果。 */
  function startTabDrag(e, tab) {
    if (e.button !== 0 || e.target.closest('.dt-close')) return;
    const list = $('#tabs-list');
    const startX = e.clientX;
    const from = [...list.children].indexOf(tab);
    let dragging = false;
    let to = from;
    let sibs = [];

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < 6) return;      // 阈值:免得点一下就被当成拖
        dragging = true;
        tab.dataset.dragged = '1';
        tab.classList.add('dt-dragging');
        // 记下起手时各标签的中心点,拖动过程中不再重新测量(否则会自激振荡)
        sibs = [...list.children].map((el) => {
          const r = el.getBoundingClientRect();
          return { el, center: r.left + r.width / 2, width: r.width };
        });
      }
      tab.style.transform = 'translateX(' + dx + 'px)';

      // 指针越过谁的中心,谁就让位
      const px = startX + dx;
      let idx = 0;
      for (let i = 0; i < sibs.length; i++) if (px > sibs[i].center) idx = i;
      if (px < sibs[0].center) idx = 0;
      to = idx;

      const w = sibs[from].width + 2;   // 2 = 标签间距
      sibs.forEach((s, i) => {
        if (s.el === tab) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -w;
        else if (from > to && i >= to && i < from) shift = w;
        s.el.style.transform = shift ? 'translateX(' + shift + 'px)' : '';
      });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragging) return;
      [...list.children].forEach((el) => { el.style.transform = ''; });
      tab.classList.remove('dt-dragging');
      if (to !== from) {
        const [moved] = docs.splice(from, 1);
        docs.splice(to, 0, moved);
        renderTabs();
        persist();
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /* <svg> 是 SVGElement,不继承 HTMLElement —— 它没有 hidden 这个 IDL 属性。
   * 写 svg.hidden=false 只会挂个无用的 JS 属性,DOM 上的 hidden 特性还在,CSS [hidden] 继续把它藏着。
   * 必须直接操作特性。 */
  function setSketchHidden(hide) {
    const s = $('#sketch-layer');
    if (!s) return;
    if (hide) s.setAttribute('hidden', '');
    else s.removeAttribute('hidden');
  }

  function showCanvas() {
    $('#empty-state').hidden = true;
    $('#sidebar').hidden = false;
    setSketchHidden(true);   // 进画布后收掉标注,别挡着干活
  }

  function goHome() {
    snapshotActive();
    if (editor) editor.select(null);
    activeDocId = null;
    $('#empty-state').hidden = false;
    // 没打开页面时属性面板是空的,收起来把画布让出来
    $('#sidebar').hidden = true;
    // 主页没有页面可跟随,回到用户自己的偏好
    applyTheme(localStorage.getItem('clay-theme') !== 'dark');
    refreshSelectionUI();
    renderTabs();
    renderHome();
  }

  /* ── 主题 ──────────────────────────────────
   * 编辑器皮肤跟着画布里页面的配色走:页面是深色的,编辑器就深色,
   * 免得深色作品四周围着一圈刺眼的白边。 */
  function applyTheme(light) {
    const btn = $('#btn-theme');
    document.body.classList.toggle('light', light);
    if (btn) {
      btn.innerHTML = window.icon(light ? 'moon' : 'sun');
      btn.title = light ? '切到深色' : '切到浅色';
    }
  }

  /* 判断画布里的页面整体是深是浅:取实际渲染出来的底色算亮度。
   * 不看 prefers-color-scheme —— 那是"页面支不支持深色模式",
   * 这里要的是"这个页面此刻长得深还是浅"。 */
  function pageIsDark(ed) {
    try {
      const doc = ed.Canvas.getDocument();
      const win = doc.defaultView;
      const solid = (el) => {
        if (!el) return null;
        const m = String(win.getComputedStyle(el).backgroundColor)
          .match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) return null;
        const a = m[4] === undefined ? 1 : parseFloat(m[4]);
        if (a < 0.5) return null;            // 透明的不算数,继续往下找
        return [+m[1], +m[2], +m[3]];
      };
      const rgb = solid(ed.getWrapper().getEl()) || solid(doc.body) || solid(doc.documentElement);
      if (!rgb) return false;                // 一片透明 → 当作浅色
      const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
      return lum < 0.5;
    } catch (e) {
      return false;
    }
  }

  // 页面渲染完(Tailwind 现场编译也得等)再判色,否则量到的是中间态
  function syncThemeToPage(ed, doc) {
    setTimeout(() => {
      if (!doc || doc.id !== activeDocId) return;   // 期间切走了就别乱改
      if (doc.theme) { applyTheme(doc.theme === 'light'); return; }  // 用户手动定过就听他的
      // 自动跟随不落盘:doc.theme 只留给用户手动的选择,
      // 否则第一次自动识别就把字段占了,之后永远分不清是"他选的"还是"我猜的"
      applyTheme(!pageIsDark(ed));
    }, 700);
  }

  /* ── 手绘标注:箭头指向工具栏真实按钮 ──────────
   * 位置全部实测(getBoundingClientRect),不写死坐标,
   * 所以换窗口宽度、换语言、按钮增删都不会指偏。 */
  /* 标注:每条挂在自己按钮的正下方居中,row 控制纵向分层。
   * 早期版本让标签横向铺开,结果左侧四个按钮只占 250px、而标签各有 90px 宽,
   * 必然互相挤开 → 箭头交叉指错。现在靠 row 错开,箭头短且一一对应。
   * 撤销/重做在空状态没意义,不标注,顺带给左侧腾出间距。 */
  const SKETCH_NOTES = [
    { sel: '#btn-home',    text: '点这儿随时回来', row: 0 },
    { sel: '#device-seg',  text: '换设备看效果',   row: 1 },
    { sel: '#btn-preview', text: '全屏预览',       row: 0 },
    { sel: '#btn-theme',   text: '深色/浅色',      row: 0 },
    { sel: '#btn-save',    text: '改完存回文件',   row: 1 },
  ];

  // 确定性抖动:同一坐标每次算出同一个偏移,重绘时线条不会乱跳
  function jitter(seed, amp) {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return (x - Math.floor(x) - 0.5) * 2 * amp;
  }

  function sketchArrow(x1, y1, x2, y2, seed) {
    // 标注在按钮正下方,连线基本垂直:控制点往侧向推,才有手绘的弯,
    // 否则直上直下像根棍子。侧推方向按 seed 定,左右交替更自然。
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(22, len * 0.34) * (jitter(seed, 1) > 0 ? 1 : -1);
    const mx = (x1 + x2) / 2 + (-dy / len) * bow + jitter(seed, 3);
    const my = (y1 + y2) / 2 + (dx / len) * bow + jitter(seed + 1, 3);
    const d = 'M ' + x1 + ' ' + y1 + ' Q ' + mx + ' ' + my + ' ' + x2 + ' ' + y2;
    // 箭头:根据末段切线方向张开两笔
    const ang = Math.atan2(y2 - my, x2 - mx);
    const L = 8;
    const a1 = ang + Math.PI - 0.42, a2 = ang + Math.PI + 0.42;
    const head =
      'M ' + x2 + ' ' + y2 + ' L ' + (x2 + Math.cos(a1) * L) + ' ' + (y2 + Math.sin(a1) * L) +
      ' M ' + x2 + ' ' + y2 + ' L ' + (x2 + Math.cos(a2) * L) + ' ' + (y2 + Math.sin(a2) * L);
    return d + ' ' + head;
  }

  function drawSketch() {
    const svg = $('#sketch-layer');
    if (!svg) return;
    // 只在「主页 + 一个页面都没开 + 没有最近记录(第一次用)」时才画箭头:
    // 标注是给第一次上手的人的;有最近记录时右侧已经是文件列表,再画箭头就是噪音。
    const show = !$('#empty-state').hidden && docs.length === 0
      && !$('.empty-card').classList.contains('has-recents');
    setSketchHidden(!show);
    if (!show) return;

    const NS = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';
    // 窄窗口下标注会和正文打架,宁可不画。
    // 注意:某些嵌入式/离屏渲染环境量出来是 0,那种情况不能当成"窄",否则永远不画。
    const vw = document.documentElement.clientWidth || window.innerWidth || 0;
    if (vw > 0 && vw < 900) return;

    const card = $('.empty-card').getBoundingClientRect();

    const placed = [];   // 已落位的文字盒,用来兜底防重叠

    SKETCH_NOTES.forEach((note, i) => {
      const el = $(note.sel);
      if (!el || el.offsetParent === null) return;
      const r = el.getBoundingClientRect();   // 视口坐标,与 SVG 固定层同一坐标系
      const tx = r.left + r.width / 2;
      const ty = r.bottom + 5;                // 箭头终点:按钮正下方

      // 文字就挂在按钮正下方居中 —— 箭头几乎垂直,一一对应,不可能读错
      const lx = tx + jitter(i * 3, 3);
      const ly = ty + 34 + note.row * 30 + jitter(i * 7, 3);

      const label = document.createElementNS(NS, 'text');
      label.setAttribute('class', 'sk-label');
      label.setAttribute('x', lx);
      label.setAttribute('y', ly);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('transform', 'rotate(' + jitter(i * 5, 1.8).toFixed(2) + ' ' + lx + ' ' + ly + ')');
      label.textContent = note.text;
      svg.appendChild(label);

      const lb = label.getBBox();
      const hits = (a, b) => a.x < b.x + b.width + 10 && a.x + a.width + 10 > b.x &&
                             a.y < b.y + b.height + 6 && a.y + a.height + 6 > b.y;
      // 和正文卡片或已有标注打架就整条丢掉,宁可少画也不要糊成一团
      const cardBox = { x: card.left, y: card.top, width: card.width, height: card.height };
      if (hits(lb, cardBox) || placed.some((p) => hits(lb, p))) {
        svg.removeChild(label);
        return;
      }
      placed.push({ x: lb.x, y: lb.y, width: lb.width, height: lb.height });

      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', 'sk-path');
      path.setAttribute('d', sketchArrow(lx, lb.y - 5, tx, ty, i * 11));
      svg.appendChild(path);
    });
  }
  window.addEventListener('resize', () => { clearTimeout(drawSketch._t); drawSketch._t = setTimeout(drawSketch, 120); });

  function activateDoc(id) {
    if (id === activeDocId) { showCanvas(); return; }
    snapshotActive();
    const d = docs.find((x) => x.id === id);
    if (!d) return;
    activeDocId = id;
    docTailwind = d.isTailwind;
    const ed = ensureEditor(d.isTailwind);
    scheduleCanvasHeal(ed, d.id);   // 相对路径图片要指回这个文档的源目录;装完内容后再补,见函数注释
    histSuppressed = true;
    ed.loadProjectData(d.data);
    // 上一个文档的撤销栈对这个文档毫无意义,还会串门:清掉,历史从本次打开重新记
    ed.UndoManager.clear();
    histSuppressed = false;
    // 会话基线:记下打开时刻的内容签名;打开时就带的脏要一直背着,直到真的存盘
    setSessionMark(d.id, claySig(ed), !!d.dirty);
    scheduleHistory();
    ed.select(null);          // 别把上一个文档的选中项带过来
    refreshSelectionUI();
    showCanvas();
    renderTabs();
    setDevice('desktop');
    syncThemeToPage(ed, d);   // 编辑器皮肤跟着这个页面的配色
  }

  async function closeDoc(id) {
    let d = docs.find((x) => x.id === id);
    if (!d) return;

    /* 有没存的修改就先问,Word 的三选一。
     * 先把这个标签页亮出来再问 —— 不能让用户对着别的页面替它做决定。 */
    if (d.dirty) {
      if (id !== activeDocId) activateDoc(id);
      const hasSrc = !!d.sourcePath;
      const r = await confirmBox({
        type: 'question',
        message: hasSrc ? `「${d.name}」有未保存的修改` : `「${d.name}」还没有保存成文件`,
        detail: hasSrc
          ? `关闭前要把修改保存到 ${d.sourcePath.split('/').pop()} 吗?`
          : '不保存的话,这个页面和你做的修改会一起消失。',
        buttons: [hasSrc ? '保存' : '存为文件…', '不保存', '取消'],
        defaultId: 0,
        cancelId: 2,
      });
      if (r === 2) return;
      if (r === 0) {
        const ok = await (hasSrc ? saveToSource() : saveAsCopy());
        if (!ok) return;   // 保存框被取消,关闭也一并作罢
      }
    }

    const i = docs.findIndex((x) => x.id === id);   // 弹窗期间顺序可能变了,重新找
    if (i < 0) return;
    const wasActive = id === activeDocId;
    docs.splice(i, 1);
    if (!wasActive) { renderTabs(); persist(); return; }
    activeDocId = null;
    const next = docs[i] || docs[i - 1];
    if (next) activateDoc(next.id);
    else goHome();
    persist();
  }

  /* ── 同一份内容不重复开 ────────────────────
   * 同一个文件开成两个标签页,两边各改各的,最后存哪个?
   * 所以给每份来源一个身份:文件按路径、示例按名字、粘贴按内容指纹。 */
  function hashOf(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* 内容指纹:用页面自身的特征认人,不依赖来源。
   * 作用有二:
   *  1) 这个功能上线前导入的老文档没有 sourceKey,靠它照样能查重;
   *  2) 同一个页面换个路径/换个方式导入,也认得出是同一份。
   * 用导入时的原始 styleText(不随 Clay 里的编辑改变),所以是稳定的身份。 */
  function sigOf(docTitle, styleText, name) {
    return 'sig:' + hashOf((docTitle || '') + '|' + (styleText || '') + '|' + (name || ''));
  }
  function docSig(d) {
    return d.sig || sigOf(d.docTitle, d.styleText, d.name);
  }

  async function confirmBox(opts) {
    if (window.clay && window.clay.confirm) return window.clay.confirm(opts);
    // 浏览器里跑没有原生对话框;confirm 的"确定"对应按钮 1
    return window.confirm(opts.message + '\n\n' + (opts.detail || '')) ? 1 : 0;
  }

  /* 已经开着同一份来源时:内容没变就切过去;
   * 磁盘上变过了就问要不要重新载入(会丢掉 Clay 里的修改,必须让用户选)。 */
  async function handleDuplicate(existing, raw) {
    // 老文档没有 sourceHash;此时是靠内容指纹匹配上的,说明内容本来就一样,
    // 不该拿"指纹缺失"当成"磁盘变过了"去吓唬用户。
    const changed = existing.sourceHash ? existing.sourceHash !== hashOf(raw) : false;
    if (!changed) {
      activateDoc(existing.id);
      toast('这个页面已经打开了,已切过去');
      return true;
    }
    const r = await confirmBox({
      type: 'question',
      message: '这个文件已经在 Clay 里打开了,但磁盘上的版本已经变了',
      detail: '重新载入会用磁盘上的新版本替换,你在 Clay 里对它做的修改会丢失。',
      buttons: ['切到已打开的', '重新载入(丢弃 Clay 里的修改)'],
      defaultId: 0,
      cancelId: 0,
    });
    if (r !== 1) {
      activateDoc(existing.id);
      toast('已切到打开着的那个');
      return true;
    }
    // 安静地摘掉旧的:不走 closeDoc,免得它顺手激活别的文档或跳回主页,
    // 而紧接着 runImport 又要新建并激活 —— 白闪一下还容易打架。
    const i = docs.findIndex((x) => x.id === existing.id);
    if (i > -1) docs.splice(i, 1);
    if (activeDocId === existing.id) activeDocId = null;
    renderTabs();
    return false;   // 让调用方走正常导入流程
  }

  /* ── 导入流程 ──────────────────────────────
   * 主场景是「本地已经有 html」,所以点导入直接开系统文件框,
   * 粘贴代码退居次选(通过弹窗)。 */
  async function openFilePicker() {
    if (window.clay && window.clay.openFile) {
      const f = await window.clay.openFile();
      if (f) runImport(f.content, f.name.replace(/\.html?$/i, ''), f.path);
      return;
    }
    // 浏览器里跑(开发预览)没有原生对话框,退回 input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      file.text().then((t) => runImport(t, file.name.replace(/\.html?$/i, ''), ''));
    };
    input.click();
  }

  /* 从桌面把 HTML 文件拖进窗口 → 自动打开。全窗口都能接(顶层 UI + 画布 iframe 内部
   * 都单独绑了一份,见下面 enableCanvasFileDrop),因为这本质上和 ⌘O 打开文件是同一件事。
   * 拖来的 File 对象不带磁盘路径(渲染进程沙箱化后 File.path 拿不到了),
   * 用 preload 里的 webUtils.getPathForFile 换真实路径,再走 readPath 读内容——
   * 和"打开文件"、"最近编辑"走的是同一条读取路径,行为完全一致。 */
  let dropDepth = 0;   // dragenter/dragleave 会在子元素间反复触发,用计数器防止提前收起遮罩;
                        // 顶层和画布 iframe 两套监听共用同一个计数器,跨边界移动也不会提前收起
  function isFileDrag(e) { return e.dataTransfer && [...e.dataTransfer.types].includes('Files'); }

  async function importDroppedFiles(fileList) {
    const files = [...fileList].filter((f) => /\.html?$/i.test(f.name));
    if (!files.length) { toast('只能拖 .html / .htm 文件'); return; }
    // 依次导入,不并发 —— runImport 里可能弹"文件已打开/磁盘变了"确认框,
    // 并发跑会导致好几个确认框同时弹出、互相打架
    for (const f of files) {
      const p = window.clay.getPathForFile(f);
      if (!p) continue;
      const got = await window.clay.readPath(p);
      if (got) await runImport(got.content, got.name.replace(/\.html?$/i, ''), got.path);
    }
  }

  // 挂一套拖拽监听到任意 EventTarget(顶层 window 或画布 iframe 的 document 都用这套)
  function bindFileDropTarget(target) {
    const overlay = $('#drop-overlay');
    target.addEventListener('dragenter', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dropDepth++;
      overlay.hidden = false;
    });
    target.addEventListener('dragover', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();   // 必须 preventDefault,否则浏览器默认行为是拒绝 drop
      e.dataTransfer.dropEffect = 'copy';
    });
    target.addEventListener('dragleave', (e) => {
      if (!isFileDrag(e)) return;
      dropDepth = Math.max(0, dropDepth - 1);
      if (dropDepth === 0) overlay.hidden = true;
    });
    target.addEventListener('drop', async (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dropDepth = 0;
      overlay.hidden = true;
      await importDroppedFiles(e.dataTransfer.files);
    });
  }

  function enableFileDrop() {
    if (!(window.clay && window.clay.getPathForFile && window.clay.readPath)) return;   // 浏览器预览环境跳过
    bindFileDropTarget(window);
  }

  /* 画布是独立的 iframe(有自己的 document/window),原生文件拖拽落在它上面时,
   * 事件根本不会冒泡到外层的 window —— 实测过:一旦打开了任意文档,画布区域
   * 中心点 elementFromPoint 命中的就是 IFRAME 本身,顶层监听彻底收不到。
   * 所以画布内部要单独绑一份同样的处理。iframe 文档就绪时机不可靠(这坑在
   * enableDirectDrag 那儿也踩过),用同一套"事件 + 轮询兜底"来绑,绑过一次
   * 就在 document 上打标记,防止重复绑。 */
  function enableCanvasFileDrop(ed) {
    if (!(window.clay && window.clay.getPathForFile && window.clay.readPath)) return;
    const bind = () => {
      const cdoc = ed.Canvas.getDocument();
      if (!cdoc || !cdoc.body || cdoc.__clayFileDropBound) return false;
      cdoc.__clayFileDropBound = true;
      bindFileDropTarget(cdoc);
      return true;
    };
    ed.on('load', bind);
    ed.on('canvas:frame:load:body', bind);
    bind();
    const timer = setInterval(() => { if (bind()) clearInterval(timer); }, 200);
    setTimeout(() => clearInterval(timer), 15000);
    ed.on('destroy', () => clearInterval(timer));
  }

  async function runImport(raw, fileName, sourcePath, sampleKey) {
    if (!raw || !raw.trim()) { toast('先粘贴 HTML 代码'); return; }

    // 身份:文件看路径,示例看名字,粘贴看内容指纹
    const sourceKey = sourcePath ? 'file:' + sourcePath
      : sampleKey ? 'sample:' + sampleKey
      : 'paste:' + hashOf(raw);

    // 先解析一遍,好算出内容指纹(老文档没有 sourceKey,只能靠这个认)
    const probe = window.ClayImporter.parseOnly(raw);
    const name = fileName || probe.title || '';
    const sig = sigOf(probe.docTitle, probe.styleText, name);

    /* 有身份的按身份认(路径不同就是不同文件,哪怕内容一模一样 ——
     * 用户复制模板改两个变体是常规操作,不能拦);
     * 只有老文档(没身份)才退回内容指纹。 */
    const existing = docs.find((d) => (d.sourceKey ? d.sourceKey === sourceKey : docSig(d) === sig));
    if (existing && await handleDuplicate(existing, raw)) {
      closeModal('#import-modal');
      $('#import-textarea').value = '';
      return;
    }

    snapshotActive();
    const tw = window.ClayImporter.detectTailwind(raw);
    const ed = ensureEditor(tw);
    histSuppressed = true;
    const result = window.ClayImporter.importIntoEditor(ed, raw);
    ed.UndoManager.clear();   // 导入过程的程序性变更不算历史,用户的第一步从这儿起算
    histSuppressed = false;
    scheduleHistory();
    docTailwind = result.isTailwind;

    const doc = {
      id: 'doc' + ++docSeq,
      name: fileName || result.title || '未命名页面 ' + docSeq,
      isTailwind: result.isTailwind,
      scripts: result.scripts || [],
      sourcePath: sourcePath || '',   // 记住原文件,另存为时用来避开它
      sourceKey: sourceKey,           // 身份:用来判断"这份已经开着了"
      sig: sig,                       // 内容指纹:不依赖来源也能认出同一个页面
      sourceHash: hashOf(raw),        // 导入时的内容指纹,用来发现磁盘上变过了
      // 从文件/示例来的,刚打开 = 干净;粘贴来的从没落过盘,天生就是"未保存"
      dirty: !sourcePath && !sampleKey,
      // 导出时原样还原,不被 Clay 的模板覆盖
      styleText: result.styleText || '',
      docTitle: result.docTitle || '',
      headMeta: result.headMeta || [],
      headLinks: result.headLinks || [],
      data: ed.getProjectData(),
    };
    docs.push(doc);
    activeDocId = doc.id;
    scheduleCanvasHeal(ed, doc.id);   // 相对路径图片要指回源目录,见函数注释里踩过的坑
    // 会话基线:记下导入时刻的内容签名;粘贴来的天生未保存(baseDirty=true)
    setSessionMark(doc.id, claySig(ed), !!doc.dirty);
    if (sourcePath) addRecent(sourcePath, doc.name);   // 有源文件才进"最近编辑"

    showCanvas();
    renderTabs();
    syncThemeToPage(ed, doc);   // 编辑器皮肤跟着新页面的配色
    closeModal('#import-modal');
    $('#import-textarea').value = '';
    $('#import-note').textContent = '';
    const bits = [];
    if (result.report.kept) bits.push(result.report.kept);
    if (result.report.dropped.length) bits.push('已忽略:' + result.report.dropped.join('、'));
    toast(bits.length ? '导入完成。' + bits.join(';') : '导入完成,点击任意元素开始编辑');
    setDevice('desktop');
    persist();
  }

  /* ── 保存(⌘S)────────────────────────────
   * Word 语义:直接写回源文件。粘贴进来的没有源文件,第一次保存
   * 等于另存为,存完这个文档就"住"进那个文件,以后 ⌘S 直接写。 */
  async function saveToSource() {
    if (!editor || !activeDocId) { toast('还没有可保存的页面'); return false; }
    const d = docs.find((x) => x.id === activeDocId);
    if (!d) return false;
    if (!d.sourcePath || !(window.clay && window.clay.writeFile)) return saveAsCopy();

    const result = window.ClayExporter.build(editor, d);
    const r = await window.clay.writeFile(d.sourcePath, result.code);
    if (!r || !r.ok) { toast('保存失败:' + ((r && r.error) || '未知错误')); return false; }
    d.dirty = false;
    d.sourceHash = hashOf(result.code);   // 磁盘上现在就是这份,别再误报"文件在磁盘上变了"
    setSessionMark(d.id, claySig(editor), false);   // 保存基线:此后签名一致即干净
    renderTabs();
    persist();
    toast('已保存到 ' + d.sourcePath.split('/').pop());
    return true;
  }

  /* ── 另存为(⇧⌘S)──────────────────────────
   * 源文件不动。默认名去掉已有的 -clay 再补一个,不然 A-clay 再另存
   * 会滚雪球成 A-clay-clay。存完按 Word 语义换住处:手上打开的就是新文件。 */
  async function saveAsCopy() {
    if (!editor || !activeDocId) { toast('还没有可保存的页面'); return false; }
    const d = docs.find((x) => x.id === activeDocId);
    if (!d) return false;
    const result = window.ClayExporter.build(editor, d);
    const base = (d.sourcePath
      ? d.sourcePath.split('/').pop().replace(/\.html?$/i, '')
      : (d.name || 'page'))
      .replace(/[\/\\:*?"<>|]/g, '-').replace(/(-clay)+$/i, '').slice(0, 40);
    const fname = base + '-clay.html';

    if (window.clay && window.clay.saveFile) {
      const p = await window.clay.saveFile(fname, result.code, d.sourcePath || '');
      if (!p) return false;   // 用户取消了保存框
      d.sourcePath = p;
      d.sourceKey = 'file:' + p;
      d.name = p.split('/').pop().replace(/\.html?$/i, '');
      d.sourceHash = hashOf(result.code);
      d.dirty = false;
      setSessionMark(d.id, claySig(editor), false);   // 保存基线:此后签名一致即干净
      addRecent(p, d.name);   // 另存为的新文件也进"最近编辑"
      renderTabs();
      persist();
      toast('已保存为 ' + p.split('/').pop() + ',之后 ⌘S 直接存到这里');
      return true;
    }
    const blob = new Blob([result.code], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    toast('已下载 ' + fname);
    return true;
  }

  /* 导出 PDF:交给主进程用隐藏窗口渲染那份自包含 HTML 再 printToPDF。
   * 这是"给人看"的终点(发老板、贴周报),和"给开发"的复制代码是两条路。 */
  /* PDF 用哪个宽度渲染:跟着工具栏当前选中的视图走,不再固定死一个值。
   * 平板/手机是设备管理器里配好的固定宽度;桌面视图本身是流式的(没有固定宽),
   * 所以直接量画布 iframe 此刻的真实渲染宽度 —— 你在 Clay 里看到的是什么宽度,
   * 导出就按什么宽度截,所见即所得。 */
  function currentExportWidth() {
    const id = (editor && editor.getDevice && editor.getDevice()) || 'desktop';
    if (id === 'tablet') return 768;
    if (id === 'mobile') return 375;
    try {
      const fr = editor.Canvas.getFrameEl();
      const w = fr && fr.clientWidth;
      if (w > 0) return w;
    } catch (e) { /* 量不到就退回下面的默认值 */ }
    return 1440;   // 常见的桌面设计宽度,量不到画布宽度时兜底
  }

  async function exportPdf() {
    if (!editor || !activeDocId) { toast('还没有可导出的页面'); return; }
    const d = docs.find((x) => x.id === activeDocId);
    if (!d) return;
    if (!(window.clay && window.clay.exportPdf)) { toast('PDF 导出仅桌面版可用'); return; }
    const result = window.ClayExporter.build(editor, d);
    const base = (d.name || 'page').replace(/[\/\\:*?"<>|]/g, '-').replace(/(-clay)+$/i, '').slice(0, 40);
    toast('正在生成 PDF…');
    // 相对路径图片(素材文件夹场景)要指回源目录 —— PDF 渲染用的临时文件不和原文件同目录,
    // 跟画布里那个问题是同一类,这里传源路径给主进程去插 base 修
    const r = await window.clay.exportPdf(base + '.pdf', result.code, currentExportWidth(), d.sourcePath || '');
    if (!r) return;                                   // 用户取消了保存框
    if (!r.ok) { toast('PDF 导出失败:' + (r.error || '未知错误')); return; }
    toast('已导出 ' + r.path.split('/').pop());
  }

  /* 给开发的交接通道:整页代码进剪贴板。代码从主流程里退场,
   * 不再把一屏源码怼到不看代码的人脸上。 */
  async function copyCode() {
    if (!editor || !activeDocId) { toast('还没有可复制的页面'); return; }
    const d = docs.find((x) => x.id === activeDocId);
    if (!d) return;
    const result = window.ClayExporter.build(editor, d);
    await navigator.clipboard.writeText(result.code);
    toast('整页代码已复制,可以直接发给开发');
  }

  /* 一个撤销动作是不是"有意义的编辑"。
   * 只有"选中元素时建的那条空占位样式规则"不算(它是 add 一条规则,不是组件)。
   * 其余都算真编辑:改样式/内容(change)、重置组件集合(reset —— 富文本输入文字就是它)、
   * 增删组件。之前只认 describeGroup 能命名的动作,把富文本文字编辑这类误杀了,这里放宽。 */
  function isMeaningfulAction(a) {
    if (!a) return false;
    const isComp = (x) => !!(x && typeof x.getName === 'function');
    // 规则/选择器模型带不带真实样式:选中产生的占位规则是空壳;
    // 但"选中后立刻改样式"时样式会直接写进新建的规则里(栈里只有 add、没有 change),
    // 所以 add/remove 的规则只要带着样式就是真编辑,空壳才不算。
    const hasStyle = (x) => {
      if (!x || isComp(x)) return false;
      const st = (x.getStyle && x.getStyle()) || (x.attributes && x.attributes.style) || {};
      return Object.keys(st).filter((k) => !/^__/.test(k)).length > 0;
    };
    if (a.type === 'change') return true;          // 样式/内容/属性改动一定是真改
    if (a.type === 'reset') return true;           // 组件集合被重置 = 内容变了(RTE 改字)
    if (a.type === 'add') return isComp(a.after) || hasStyle(a.after);
    if (a.type === 'remove') return isComp(a.before) || hasStyle(a.before);
    return false;
  }
  function groupIsRealEdit(g) {
    return g.actions.some(isMeaningfulAction);
  }

  /* 内容签名:页面 HTML(模型序列化,确定性)+ 用户改动出的 #id 规则(去重排序)。
   * 脏与否不再解读撤销栈里动作的形状 —— 那些内部模型(规则/选择器/组件绑定)的
   * 结构和时序反复变化,按形状分类已连续误判两次。签名对比语义上无可争议:
   *  - 占位空规则没有样式,天然不进签名 → 纯选中不脏
   *  - 任何真实编辑(样式/文字/结构,不论产生什么栈形状)都会改变签名 → 必然识别
   *  - 撤销回到保存点签名复原 → 圆点自动消失
   * 规则去重 + 排序,是为了容忍底座在选中往返时对规则集的重复/换序噪音。 */
  function claySig(ed) {
    const CLAY_ID = /#i[a-z0-9]{3,}/;
    const parts = [];
    try {
      ed.Css.getRules().forEach((rule) => {
        const sel = rule.selectorsToString ? rule.selectorsToString() : '';
        if (!sel || !CLAY_ID.test(sel)) return;
        const styleText = (rule.styleToString ? rule.styleToString() : '').trim();
        if (!styleText) return;   // 空占位规则不算内容
        parts.push(sel + '{' + styleText.toLowerCase().replace(/\s+/g, '') + '}@' + (rule.get('mediaText') || ''));
      });
    } catch (e) { /* 读不了就只按 HTML 算 */ }
    const rules = [...new Set(parts)].sort().join('\n');
    // 选中元素时底座会往元素上写 id="iXXX"(为规则占位)——这是内部记账不是用户编辑,
    // 从签名里归一化掉,否则"点一下"就会因 HTML 多了个 id 而误判为改过。
    const html = ed.getHtml().replace(/ id="i[a-z0-9]{2,}"/g, '');
    return hashOf(html + '␟' + rules);
  }

  /* 每个文档在本次会话里的"保存基线":上次存盘(或打开)那一刻的内容签名。
   * 打开时就带的旧脏(baseDirty)要一直背着,直到真的存盘。 */
  const sessionMark = {};   // docId -> { sig, baseDirty }
  function setSessionMark(docId, sig, baseDirty) {
    sessionMark[docId] = { sig, baseDirty };
  }

  // 编辑/撤销/重做后统一收口:重画历史 + 按"当前签名 vs 保存基线"重算脏(可标脏也可清脏)
  let reconcileTimer = null;
  function scheduleEditReconcile() {
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
      scheduleHistory();
      const d = docs.find((x) => x.id === activeDocId);
      if (!d || !editor) return;
      const m = sessionMark[activeDocId];
      if (!m) return;   // 基线未建立(理论上不会:导入/切换/保存都会建),保持现状
      const next = m.baseDirty || claySig(editor) !== m.sig;
      if (next !== !!d.dirty) {
        d.dirty = next;
        renderTabs();
        schedulePersist();
      }
    }, 140);
  }

  /* ── 历史记录(Photoshop 式)────────────────
   * 直接读 GrapesJS 的撤销栈,不自己另记一份账 —— 两本账迟早对不上。
   * getGroupedStack() 把一次手势的多条底层变更并成一组,
   * 点某一条 = 撤销/重做若干步走到那个位置。 */
  const PROP_ZH = {
    'font-size': '字号', 'font-weight': '字重', 'font-family': '字体', 'font-style': '字形',
    color: '文字色', 'text-align': '对齐', 'line-height': '行高', 'letter-spacing': '字距',
    'text-decoration': '装饰线', 'background-color': '背景色', background: '背景',
    'background-image': '背景图', 'border-radius': '圆角', 'box-shadow': '阴影',
    opacity: '不透明度', width: '宽度', height: '高度', 'max-width': '最大宽度',
    'min-height': '最小高度', display: '布局方式', 'flex-direction': '排列方向',
    'justify-content': '主轴对齐', 'align-items': '交叉对齐', gap: '间隔', position: '定位',
  };
  function propZh(p) {
    if (PROP_ZH[p]) return PROP_ZH[p];
    if (/^margin/.test(p)) return '外间距';
    if (/^padding/.test(p)) return '内间距';
    if (/^border/.test(p)) return '描边';
    if (/^font|^text|^letter|^line/.test(p)) return '文字样式';
    return p;
  }
  function compName(c) {
    if (!c || !c.get) return '元素';
    return c.get('custom-name') || (c.getName && c.getName()) || '元素';
  }
  // componentFirst 下样式改动落在 #id 规则上,从选择器倒查是哪个元素
  function ruleToComp(rule) {
    try {
      const sel = rule.getSelectorsString ? rule.getSelectorsString() : '';
      const m = String(sel).match(/#[\w-]+/);
      if (m && editor) {
        const found = editor.getWrapper().find(m[0]);
        if (found && found[0]) return found[0];
      }
    } catch (e) { /* 查不到就叫"元素" */ }
    return null;
  }
  function styleLabel(owner, beforeStyle, afterStyle) {
    const bs = beforeStyle || {}, fs = afterStyle || {};
    // 只报真正变了的属性 —— 规则的快照里还带着以前改过的旧属性,全列就是撒谎
    const props = Object.keys(Object.assign({}, bs, fs))
      .filter((p) => !/^__/.test(p) && String(bs[p]) !== String(fs[p]));
    const names = [...new Set(props.map(propZh))].slice(0, 3).join('、');
    return '调整 ' + compName(owner) + (names ? ' 的' + names : ' 的样式');
  }
  /* 撤销栈里的动作是普通对象 {index, type, before, after, object, options}
   * (实测形态,不是 Backbone 模型)。一次样式修改会顺带产生选择器模型的
   * 增删噪音,所以先认"规则 change",再看组件级的增删。 */
  function describeGroup(actions) {
    // 1) 样式 / 属性修改
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a.type !== 'change' || !a.object) continue;
      const b = a.before || {}, f = a.after || {};
      if (a.object.getSelectorsString) {            // CSS 规则(componentFirst 的落点)
        return styleLabel(ruleToComp(a.object), b.style, f.style);
      }
      if (a.object.getName) {                       // 组件自身的变化
        const keys = Object.keys(Object.assign({}, b, f));
        if (keys.indexOf('style') > -1) return styleLabel(a.object, b.style, f.style);
        if (keys.indexOf('content') > -1) return '修改 ' + compName(a.object) + ' 的文字';
        if (keys.indexOf('attributes') > -1) {
          const attrs = Object.assign({}, b.attributes || {}, f.attributes || {});
          if ('src' in attrs) return '更换 ' + compName(a.object) + ' 的图片';
          return '修改 ' + compName(a.object);
        }
      }
    }
    // 2) 结构变化:只认"组件"级增删,选择器等内部模型不算
    const isComp = (x) => !!(x && x.getName && x.get);
    let added = null, removed = null, hadReset = false;
    actions.forEach((a) => {
      if (a.type === 'add' && isComp(a.after)) added = a.after;
      if (a.type === 'remove' && isComp(a.before)) removed = a.before;
      if (a.type === 'reset') hadReset = true;
    });
    if (added && removed) return '移动 ' + compName(added);
    // 双击改字 = 原文字整段 reset 后放回一个新文本节点
    if (added && (hadReset || added.get('type') === 'textnode')) {
      const parent = added.parent && added.parent();
      return '修改 ' + compName(parent || added) + ' 的文字';
    }
    if (added) return '加入 ' + compName(added);
    if (removed) return '删除 ' + compName(removed);
    // 富文本输入产生的是 reset(组件集合重置)但没冒出可命名的组件 —— 也算改文字
    if (hadReset) return '修改文字';
    // 过滤已由 groupIsRealEdit 结构化判定完成,能走到这里的都是真编辑,给个兜底标签
    return '编辑内容';
  }

  let histTimer = null;
  function scheduleHistory() {
    clearTimeout(histTimer);
    histTimer = setTimeout(renderHistory, 150);
  }

  function renderHistory() {
    const mount = $('#history-mount');
    const hint = $('#history-hint');
    if (!mount) return;
    mount.innerHTML = '';
    if (!editor || !activeDocId) { if (hint) hint.hidden = false; return; }

    const um = editor.UndoManager;
    // 只保留"真编辑"组:选中占位规则这类 describeGroup 认不出的一律滤掉
    const groups = um.getGroupedStack().filter(groupIsRealEdit);
    const pointer = um.getPointer();   // 栈里"当前执行到"的位置;-1 = 全撤销了

    if (!groups.length) {
      /* 撤销栈是每次打开才重建的,不跨重启;而"未保存"标记会持久化。
       * 所以一个"改了没存到文件、然后重开 App"的页面,会出现:标签页有圆点、
       * 关闭时警告有未保存修改,但历史却是空的 —— 之前那些修改的操作记录已经不在了。
       * 这时候不能显示"还没有任何修改"的空状态(自相矛盾),得如实说明。 */
      const d = docs.find((x) => x.id === activeDocId);
      if (d && d.dirty) {
        if (hint) hint.hidden = true;
        const note = document.createElement('div');
        note.className = 'pane-hint';
        note.innerHTML = '<p>这一页有<b>未保存的修改</b>,是在上次使用时做的。</p>'
          + '<ul class="hint-list">'
          + '<li>这些旧修改无法在这里逐步回退</li>'
          + '<li>从现在起的新修改会记录在下面</li>'
          + '<li>按 ⌘S 存回文件后,圆点会消失</li>'
          + '</ul>';
        mount.appendChild(note);
      } else if (hint) {
        hint.hidden = false;   // 真·干净:确实还没做任何修改
      }
      return;
    }
    if (hint) hint.hidden = true;

    const list = document.createElement('div');
    list.className = 'hist-list';

    // 组的落点 = 组内最后一个动作的栈位置(动作对象自带 index,实测可靠)
    const items = groups.map((g) => ({
      label: describeGroup(g.actions),
      at: typeof g.index === 'number' ? g.index : g.actions[g.actions.length - 1].index,
    }));
    // 当前行 = 落点不超过指针的最后一组;都超过则停在"打开页面"基线
    let currentAt = -1;
    items.forEach((it) => { if (it.at <= pointer) currentAt = it.at; });

    const row = (label, at, isBase) => {
      const b = document.createElement('button');
      b.className = 'hist-item' +
        (at === currentAt ? ' current' : '') +
        (at > pointer ? ' future' : '');
      b.innerHTML = window.icon(isBase ? 'file' : 'history', 12) + '<span class="hi-label"></span>';
      b.querySelector('.hi-label').textContent = label;
      b.onclick = () => jumpHistory(at);
      list.appendChild(b);
    };

    row('打开页面时的样子', -1, true);
    items.forEach((it) => row(it.label, it.at, false));
    mount.appendChild(list);

    const cur = list.querySelector('.current');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  // 跳到栈位置 at:按"整组"为步长撤销/重做,绝不停在一次手势的中间
  function jumpHistory(at) {
    if (!editor) return;
    const um = editor.UndoManager;
    let guard = 400;
    while (um.getPointer() > at && guard--) um.undo(1);
    while (um.getPointer() < at && guard--) um.redo(1);
    scheduleHistory();
    scheduleComputed();
  }

  /* ── 小部件 ─────────────────────────────── */
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function openModal(s) { $(s).hidden = false; }
  function closeModal(s) { $(s).hidden = true; }

  function setDevice(id) {
    if (!editor) return;
    editor.setDevice(id);
    // 选择器必须跟着 HTML 走:工具栏改成分段控件后类名从 .device-btn 变成了 .seg-item,
    // 这里没跟着改,导致画布切了但高亮不动。
    $$('#device-seg .seg-item').forEach((b) => b.classList.toggle('active', b.dataset.device === id));
  }

  /* ── 图标填充 ────────────────────────────── */
  function paintIcons() {
    const I = window.icon;
    const set = (sel, name, size) => { const e = $(sel); if (e) e.innerHTML = I(name, size); };
    // 品牌标记(与 .app 图标同款),工具栏 20px / 主页 48px
    $('.brand-logo').innerHTML = window.brandMark(20, 24);
    $('.empty-mark').innerHTML = window.brandMark(48, 24);
    $$('#device-seg .seg-item').forEach((b) => { b.innerHTML = I(b.dataset.device, 15); });
    set('#btn-undo', 'undo'); set('#btn-redo', 'redo'); set('#btn-preview', 'eye');
    set('#btn-newtab', 'plus', 15);
    set('#btn-save .btn-ic', 'save', 14);
    set('#btn-export-pdf .btn-ic', 'pdf', 14);
    set('#btn-empty-import .btn-ic', 'upload', 15);
    set('.drop-ic', 'upload', 34);
    set('#btn-open-file .btn-ic', 'folder', 14);
    set('#btn-select-parent', 'parent', 12);
    $('#btn-select-parent').insertAdjacentText('beforeend', '上一层');
    const TAB_IC = { style: 'sliders', layers: 'layers', history: 'history' };
    $$('#sidebar-tabs .tab').forEach((t) => {
      t.querySelector('.tab-ic').innerHTML = I(TAB_IC[t.dataset.tab] || 'sliders', 13);
    });
    $$('.modal-x').forEach((b) => { b.innerHTML = I('close', 14); });
  }

  /* ── 事件接线 ────────────────────────────── */
  function wireUI() {
    paintIcons();
    $('#btn-home').onclick = goHome;
    // 主场景:本地已有文件 → 直接开系统文件框,不再多一层弹窗
    $('#btn-newtab').onclick = openFilePicker;
    $('#btn-empty-import').onclick = openFilePicker;
    $('#btn-paste-code').onclick = () => openModal('#import-modal');
    $$('[data-close]').forEach((b) => { b.onclick = () => b.closest('.modal-backdrop').hidden = true; });
    $$('[data-sample]').forEach((b) => {
      b.onclick = () => {
        const key = b.dataset.sample;
        const name = key === 'tailwind' ? 'v0 风格落地页' : 'Bolt 风格官网';
        runImport(window.CLAY_SAMPLES[key], name, '', key);
      };
    });

    // 弹窗里也留一条去开文件的路
    $('#btn-open-file').onclick = () => { closeModal('#import-modal'); openFilePicker(); };
    // 粘贴进来的没有原文件,sourcePath 留空
    $('#btn-do-import').onclick = () => runImport($('#import-textarea').value, '', '');

    $$('.seg-item').forEach((b) => { b.onclick = () => setDevice(b.dataset.device); });

    $('#btn-undo').onclick = () => editor && editor.UndoManager.undo();
    $('#btn-redo').onclick = () => editor && editor.UndoManager.redo();
    $('#btn-preview').onclick = () => {
      if (!editor) return;
      previewing = !previewing;
      if (previewing) editor.runCommand('core:preview');
      else editor.stopCommand('core:preview');
      $('#btn-preview').classList.toggle('on', previewing);
      $('#btn-preview').title = previewing ? '退出预览' : '预览';
    };

    $('#btn-select-parent').onclick = () => {
      const sel = editor && editor.getSelected();
      if (sel && sel.parent()) editor.select(sel.parent());
    };

    $('#btn-apply-similar').onclick = () => {
      const sel = editor && editor.getSelected();
      if (!sel) return;
      const style = sel.getStyle();
      const similar = findSimilar(sel);
      similar.forEach((c) => c.addStyle(style));
      toast(`已把修改应用到 ${similar.length} 个同款元素`);
    };

    $('#btn-save').onclick = saveToSource;
    $('#btn-export-pdf').onclick = exportPdf;

    // 侧栏 tab(pane 的 id 跟着 data-tab 走,加新面板不用回来改这里)
    $$('#sidebar-tabs .tab').forEach((t) => {
      t.onclick = () => {
        $$('#sidebar-tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
        $$('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + t.dataset.tab));
        if (t.dataset.tab === 'history') renderHistory();
      };
    });

    // 快捷键
    document.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (meta && k === 'o') { e.preventDefault(); openFilePicker(); }
      if (meta && e.shiftKey && k === 'v') { e.preventDefault(); openModal('#import-modal'); }
      if (meta && k === 's') { e.preventDefault(); if (e.shiftKey) saveAsCopy(); else saveToSource(); }
      if (meta && k === 'e') { e.preventDefault(); copyCode(); }
      if (e.key === 'Escape') $$('.modal-backdrop').forEach((m) => { m.hidden = true; });
    });

    // 深浅色切换。手动切时:若当前有打开的页面,把选择记在这个页面上
    // (下次切回这个标签页还是你选的那样,不会被自动识别覆盖)
    const themeBtn = $('#btn-theme');
    applyTheme(localStorage.getItem('clay-theme') === 'light');
    themeBtn.onclick = () => {
      const light = !document.body.classList.contains('light');
      localStorage.setItem('clay-theme', light ? 'light' : 'dark');
      applyTheme(light);
      const d = docs.find((x) => x.id === activeDocId);
      if (d) d.theme = light ? 'light' : 'dark';
      persist();
    };

    // Electron 菜单触发
    if (window.clay && window.clay.onMenu) {
      window.clay.onMenu((action) => {
        if (action === 'open') openFilePicker();
        if (action === 'paste') openModal('#import-modal');
        if (action === 'save') saveToSource();
        if (action === 'save-as') saveAsCopy();
        if (action === 'export-pdf') exportPdf();
        if (action === 'copy-code') copyCode();
      });
    }
  }

  // 调试句柄(自动化验证用,和 __clayEditor 一个性质):不参与任何用户路径
  window.__clay = { runImport, getDocs: () => docs, getRecents: () => recents, saveToSource, saveAsCopy, exportPdf, copyCode, closeDoc, jumpHistory, renderHistory, renderHome, openRecent };

  wireUI();
  enableFileDrop();
  enableLiveStyleInput();
  enableToolbarTips();
  refreshSelectionUI();
  // 冷启动是空工作区:先收起面板;restoreWorkspace 会渲染主页(有最近记录则显示,否则手绘引导)
  $('#sidebar').hidden = true;
  requestAnimationFrame(renderHome);
  restoreWorkspace();
  // 关窗时 async IPC 来不及往返,这里同步落一份(桌面端由主进程 sendSync 兜底)
  window.addEventListener('beforeunload', () => {
    if (!restored) return;   // 还没读完磁盘就关窗 → 什么都别写,否则会用空数据覆盖存档
    clearTimeout(persistTimer);
    snapshotActive();
    const json = JSON.stringify({ docs, activeDocId, docSeq, recents });
    if (window.clay && window.clay.saveWorkspaceSync) window.clay.saveWorkspaceSync(json);
    else { try { localStorage.setItem(STORE_KEY, json); } catch (e) { /* 超限则依赖上一次自动保存 */ } }
  });
})();
