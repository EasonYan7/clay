/* Clay 导入管线:把任意 AI 生成的 HTML 消化成可编辑画布
 * 解决实测发现的问题(docs/grapesjs-findings.md):
 *  1. body 级样式丢失 → 迁移到画布 wrapper
 *  2. 脚本/外链污染 → 剥离并提示
 *  3. 图层匿名 div 汤 → 语义化中文命名 + 重复卡片识别
 *  4. Tailwind 检测 → 决定画布运行时与导出策略
 */
(function () {
  /* Tailwind 检测:必须逐个 class 令牌做完整匹配。
   * 早期版本用 /\bgrid\b/ 之类的子串匹配,会把 class="feature-grid" 这种普通语义类名
   * 误判成 Tailwind(连字符也是词边界),导致普通 CSS 页面被塞进 Tailwind 运行时。 */
  const COLORS = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
  const TW_TOKEN = new RegExp('^(?:(?:sm|md|lg|xl|2xl|hover|focus|active|dark|group-hover):)*(?:' + [
    'flex|grid|block|inline-block|inline-flex|hidden|relative|absolute|fixed|sticky|container|mx-auto|antialiased',
    '(?:p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|inset|top|bottom|left|right)-(?:\\d+(?:\\.\\d+)?|px|auto|full|0)',
    '(?:w|h|min-w|min-h|max-w|max-h)-(?:\\d+|full|screen|auto|fit|min|max|xs|sm|md|lg|xl|\\dxl)',
    'text-(?:xs|sm|base|lg|xl|\\dxl|left|center|right|justify|white|black|transparent)',
    'text-(?:' + COLORS + ')-\\d{2,3}',
    'bg-(?:white|black|transparent|(?:' + COLORS + ')-\\d{2,3})',
    'bg-gradient-to-(?:r|l|t|b|tr|tl|br|bl)',
    '(?:from|via|to)-(?:' + COLORS + ')-\\d{2,3}',
    'rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?',
    'shadow(?:-(?:sm|md|lg|xl|2xl|inner|none))?',
    'font-(?:thin|light|normal|medium|semibold|bold|extrabold|black|sans|serif|mono)',
    'items-(?:start|center|end|baseline|stretch)',
    'justify-(?:start|center|end|between|around|evenly)',
    'flex-(?:row|col|wrap|nowrap|1|auto)',
    'grid-cols-\\d+|col-span-\\d+',
    'border(?:-[trbl])?(?:-\\d+)?|border-(?:' + COLORS + ')-\\d{2,3}',
    'z-\\d+|opacity-\\d+|overflow-(?:hidden|auto|scroll)|transition|backdrop-blur(?:-\\w+)?|leading-\\w+|tracking-\\w+',
  ].join('|') + ')(?:\\/\\d{1,3})?$');

  function detectTailwind(raw) {
    if (/cdn\.tailwindcss\.com|tailwindcss/i.test(raw)) return true;
    const re = /class\s*=\s*["']([^"']+)["']/gi;
    let m, hits = 0;
    const seen = {};
    while ((m = re.exec(raw))) {
      const toks = m[1].split(/\s+/);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (!t || seen[t] || !TW_TOKEN.test(t)) continue;
        seen[t] = 1;
        if (++hits >= 3) return true;   // 需要 3 个不同的工具类才判定
      }
    }
    return false;
  }

  function parse(raw) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const report = { dropped: [] };

    // 收集内嵌样式
    const styleText = [...doc.querySelectorAll('style')]
      .map((s) => s.textContent).join('\n');

    // 脚本不丢弃:暂存起来,编辑器内不执行,导出时原样还原
    // (AI 页面常带汉堡菜单/轮播等交互;早期版本直接删除会导出"死按钮")
    const scriptEls = [...doc.querySelectorAll('script')];
    const scripts = scriptEls
      .filter((s) => !/tailwindcss/i.test(s.getAttribute('src') || '')) // Tailwind 运行时另行处理
      .map((s) => ({ src: s.getAttribute('src') || '', content: s.src ? '' : s.textContent }));
    if (scripts.length) report.kept = `${scripts.length} 段交互脚本已暂存,导出时自动还原(编辑时不运行)`;
    scriptEls.forEach((n) => n.remove());
    const links = doc.querySelectorAll('link[rel="stylesheet"]');
    if (links.length) report.dropped.push(`${links.length} 个外部样式表链接`);
    links.forEach((n) => n.remove());
    doc.querySelectorAll('style').forEach((n) => n.remove());

    const body = doc.body;
    // 页面标题:优先 <title>,没有就退回第一个大标题
    const titleEl = doc.querySelector('title');
    const h1 = doc.querySelector('h1, h2');
    const docTitle = titleEl ? titleEl.textContent.trim() : '';
    const title = (docTitle || (h1 && h1.textContent) || '')
      .trim().replace(/\s+/g, ' ').slice(0, 24);

    // head 里值得原样带走的东西(导出时还原,不能被 Clay 的品牌覆盖)
    const headMeta = [...doc.querySelectorAll('meta')]
      .filter((m) => {
        const n = (m.getAttribute('name') || '').toLowerCase();
        const p = (m.getAttribute('property') || '').toLowerCase();
        // charset / viewport 由导出模板统一提供,其余(SEO、og:)保留
        return !m.hasAttribute('charset') && n !== 'viewport' && (n || p);
      })
      .map((m) => m.outerHTML);
    const headLinks = [...doc.querySelectorAll('link[rel*="icon"], link[rel="manifest"]')]
      .map((l) => l.outerHTML);

    return {
      bodyHtml: body.innerHTML,
      bodyClass: (body.getAttribute('class') || '').trim(),
      bodyStyle: (body.getAttribute('style') || '').trim(),
      styleText,
      title,
      docTitle,
      headMeta,
      headLinks,
      scripts,
      isTailwind: detectTailwind(raw),
      report,
    };
  }

  /* ── 语义化命名 ────────────────────────────── */
  function textOf(comp, max) {
    const el = comp.getEl && comp.getEl();
    const t = el ? (el.textContent || '').trim().replace(/\s+/g, ' ') : '';
    return t ? (t.length > max ? t.slice(0, max) + '…' : t) : '';
  }

  function baseName(comp) {
    const tag = (comp.get('tagName') || '').toLowerCase();
    const type = comp.get('type');
    switch (tag) {
      case 'header': return '页头';
      case 'nav': return '导航';
      case 'footer': return '页脚';
      case 'main': return '正文';
      case 'aside': return '侧栏';
      case 'ul': case 'ol': return '列表';
      case 'li': return '列表项';
      case 'img': return '图片';
      case 'svg': return '图标';
      case 'button': return withText('按钮', comp);
      case 'a': return withText(looksLikeButton(comp) ? '按钮' : '链接', comp);
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return withText('标题', comp);
      case 'p': return withText('文本', comp);
      case 'span': return withText('文字', comp);
      case 'section': return withHeading('区块', comp);
      case 'form': return '表单';
      case 'input': case 'textarea': case 'select': return '输入框';
      case 'table': return '表格';
      case 'video': return '视频';
      default:
        if (type === 'textnode') return null;
        return null; // div 等交给结构推断
    }
  }

  function withText(prefix, comp) {
    const t = textOf(comp, 8);
    return t ? `${prefix}「${t}」` : prefix;
  }

  function withHeading(prefix, comp) {
    const el = comp.getEl && comp.getEl();
    const h = el && el.querySelector('h1,h2,h3,h4');
    const t = h ? h.textContent.trim().replace(/\s+/g, ' ').slice(0, 10) : '';
    return t ? `${prefix}「${t}」` : prefix;
  }

  function looksLikeButton(comp) {
    const cls = (comp.getAttributes().class || '') + '';
    return /btn|button|rounded-full|rounded-lg|cta/i.test(cls);
  }

  function classSig(comp) {
    return ((comp.getAttributes().class || '') + '').trim();
  }

  function nameTree(root) {
    // 第一遍:按标签语义命名
    walk(root, (comp) => {
      const n = baseName(comp);
      if (n) comp.set('custom-name', n);
    });
    // 第二遍:识别"同款兄弟"(AI 生成的重复卡片),命名为 卡片 1/2/3
    walk(root, (comp) => {
      const kids = comp.components ? comp.components().filter((c) => c.get('type') !== 'textnode') : [];
      if (kids.length < 2) return;
      const sig = classSig(kids[0]);
      if (sig.length < 16) return;
      if (!kids.every((k) => classSig(k) === sig)) return;
      const tag = (kids[0].get('tagName') || '').toLowerCase();
      if (!['div', 'article', 'li', 'a'].includes(tag)) return;
      kids.forEach((k, i) => {
        const h = k.getEl && k.getEl() && k.getEl().querySelector('h1,h2,h3,h4');
        const t = h ? h.textContent.trim().slice(0, 8) : '';
        k.set('custom-name', t ? `卡片「${t}」` : `卡片 ${i + 1}`);
      });
    });
    // 兜底:还叫默认名的容器
    walk(root, (comp) => {
      if (comp.get('custom-name')) return;
      const tag = (comp.get('tagName') || '').toLowerCase();
      if (tag === 'div') comp.set('custom-name', '容器');
    });
  }

  function walk(comp, fn) {
    fn(comp);
    if (comp.components) comp.components().forEach((c) => walk(c, fn));
  }

  /* ── 主入口 ───────────────────────────────── */
  // 返回 { isTailwind, report };调用方负责在 Tailwind 模式切换时重建编辑器
  function importIntoEditor(editor, raw) {
    const parsed = parse(raw);
    const wrapper = editor.getWrapper();

    // 编辑器可能被上一个文档复用过:先彻底清场,否则上一页的 body 类和样式规则
    // 会漏进这一页(表现为浅色页面被上一页的 bg-slate-950 染黑)
    wrapper.getClasses().slice().forEach((c) => wrapper.removeClass(c));
    wrapper.setStyle({});
    editor.Css.clear();

    editor.setComponents(parsed.bodyHtml);
    editor.setStyle(parsed.styleText);

    // body 类迁移(修复:深色主题导入变白底)
    if (parsed.bodyClass) {
      parsed.bodyClass.split(/\s+/).forEach((c) => wrapper.addClass(c));
    }
    if (parsed.bodyStyle) {
      const styleObj = {};
      parsed.bodyStyle.split(';').forEach((d) => {
        const i = d.indexOf(':');
        if (i > 0) styleObj[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      });
      wrapper.addStyle(styleObj);
    }
    wrapper.set('custom-name', '页面');
    nameTree(wrapper);
    return parsed;
  }

  // 只解析、不碰画布 —— 查重时需要先知道这份内容的特征,再决定要不要真导入
  function parseOnly(raw) {
    return parse(raw);
  }

  window.ClayImporter = { importIntoEditor, detectTailwind, parseOnly };
})();
