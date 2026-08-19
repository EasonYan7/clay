/* Clay 导入管线:把任意 AI 生成的 HTML 消化成可编辑画布
 * 解决实测发现的问题(docs/grapesjs-findings.md):
 *  1. body 级样式丢失 → 迁移到画布 wrapper
 *  2. 脚本/外链污染 → 剥离并提示
 *  3. 图层匿名 div 汤 → 语义化中文命名 + 重复卡片识别
 *  4. Tailwind 检测 → 决定画布运行时与导出策略
 */
(function () {
  const t = (key, vars) => window.ClayI18n.t(key, vars);
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

  function attrsOf(el) {
    const out = {};
    if (!el) return out;
    [...el.attributes].forEach((a) => { out[a.name] = a.value; });
    return out;
  }

  function inlineStyleOf(el) {
    const out = {};
    if (!el || !el.style) return out;
    for (let i = 0; i < el.style.length; i++) {
      const name = el.style[i];
      let value = el.style.getPropertyValue(name);
      if (el.style.getPropertyPriority(name)) value += ' !important';
      out[name] = value;
    }
    return out;
  }

  /* 只解析 Tailwind config 的“纯数据子集”:对象/数组/字符串/数字/布尔/null。
   * 不用 eval/Function,遇到函数、变量引用、getter、展开等任何可执行语法就放弃,
   * 这样能覆盖 AI 页面最常见的自定义颜色/字体/spacing,又不会把任意业务脚本带进画布。 */
  function parseDataLiteral(source) {
    let i = 0;
    const ws = () => {
      while (i < source.length) {
        if (/\s/.test(source[i])) { i++; continue; }
        if (source.slice(i, i + 2) === '//') {
          i += 2; while (i < source.length && source[i] !== '\n') i++;
          continue;
        }
        if (source.slice(i, i + 2) === '/*') {
          const end = source.indexOf('*/', i + 2);
          if (end < 0) throw new Error('comment');
          i = end + 2; continue;
        }
        break;
      }
    };
    const string = () => {
      const quote = source[i++];
      let out = '';
      while (i < source.length) {
        const ch = source[i++];
        if (ch === quote) return out;
        if (ch !== '\\') { out += ch; continue; }
        if (i >= source.length) throw new Error('escape');
        const e = source[i++];
        const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
        if (e === 'u') {
          const hex = source.slice(i, i + 4);
          if (!/^[0-9a-f]{4}$/i.test(hex)) throw new Error('unicode');
          out += String.fromCharCode(parseInt(hex, 16)); i += 4;
        } else out += Object.prototype.hasOwnProperty.call(map, e) ? map[e] : e;
      }
      throw new Error('string');
    };
    const ident = () => {
      const m = source.slice(i).match(/^[A-Za-z_$][\w$-]*/);
      if (!m) throw new Error('identifier');
      i += m[0].length;
      return m[0];
    };
    const value = () => {
      ws();
      const ch = source[i];
      if (ch === '"' || ch === "'") return string();
      if (ch === '{') {
        i++; const out = Object.create(null); ws();
        if (source[i] === '}') { i++; return out; }
        while (i < source.length) {
          ws();
          const key = source[i] === '"' || source[i] === "'" ? string() : ident();
          ws(); if (source[i++] !== ':') throw new Error('colon');
          out[key] = value(); ws();
          if (source[i] === '}') { i++; return out; }
          if (source[i++] !== ',') throw new Error('comma');
          ws(); if (source[i] === '}') { i++; return out; }
        }
      }
      if (ch === '[') {
        i++; const out = []; ws();
        if (source[i] === ']') { i++; return out; }
        while (i < source.length) {
          out.push(value()); ws();
          if (source[i] === ']') { i++; return out; }
          if (source[i++] !== ',') throw new Error('comma');
          ws(); if (source[i] === ']') { i++; return out; }
        }
      }
      const num = source.slice(i).match(/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
      if (num) { i += num[0].length; return Number(num[0]); }
      const word = ident();
      if (word === 'true') return true;
      if (word === 'false') return false;
      if (word === 'null') return null;
      throw new Error('executable');
    };
    const result = value();
    ws(); if (source[i] === ';') { i++; ws(); }
    if (i !== source.length) throw new Error('trailing');
    return result;
  }

  function tailwindConfigOf(scriptEls) {
    for (const s of scriptEls) {
      const text = s.textContent || '';
      const m = text.match(/(?:window\s*\.\s*)?tailwind\s*\.\s*config\s*=/);
      if (!m) continue;
      try { return parseDataLiteral(text.slice(m.index + m[0].length).trim()); }
      catch (e) { /* 含可执行语法:安全起见不在编辑画布运行,导出仍原样保留 */ }
    }
    return null;
  }

  function parse(raw) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const report = { dropped: [] };

    /* 保真所需的 head 不能只压成一坨 CSS 文本:
     * - <link rel="stylesheet"> 常承载字体/图标/整站样式;
     * - 多个 style/link 的先后顺序就是 cascade 的一部分;
     * - <style media> 的 media 属性一旦丢掉,打印样式会错误地套到屏幕上。
     * 因此保留原始节点及顺序,画布和导出都复用这一份。charset/viewport/title
     * 由导出器单独正规化,避免重复。 */
    const headNodes = [...doc.head.children].map((el) => {
      const tag = el.tagName.toLowerCase();
      const name = (el.getAttribute('name') || '').toLowerCase();
      if (tag === 'title' || (tag === 'meta' && (el.hasAttribute('charset') || name === 'viewport'))) return null;
      return { tag, html: el.outerHTML };
    }).filter(Boolean);
    // 不规范但常见的生成页会把 style/link 放进 body。视觉上它们仍参与全局级联；
    // 统一追加到结构化样式序列，避免导入时删除后在画布和导出里彻底消失。
    [...doc.body.querySelectorAll('style, link[rel~="stylesheet" i]')].forEach((el) => {
      headNodes.push({ tag: el.tagName.toLowerCase(), html: el.outerHTML });
    });
    const viewportEl = doc.querySelector('meta[name="viewport" i]');
    const viewport = viewportEl ? viewportEl.getAttribute('content') || '' : '';
    const baseEl = doc.head.querySelector('base[href]');
    const baseHref = baseEl ? baseEl.getAttribute('href') || '' : '';

    // 收集内嵌样式
    const styleEls = [...doc.querySelectorAll('style')];
    const styleText = styleEls.map((s) => s.textContent).join('\n');
    // CssComposer 仍要拿到作者规则,供样式面板/修改基线使用;但必须把 style[media]
    // 翻成真正的 @media,不能像旧实现那样剥掉 media 后让打印规则污染屏幕。
    const editorStyleText = styleEls.map((s) => {
      const media = (s.getAttribute('media') || '').trim();
      return media ? `@media ${media} {\n${s.textContent}\n}` : s.textContent;
    }).join('\n');

    // 脚本不丢弃:暂存起来,编辑器内不执行,导出时按原位置原样还原。
    // body 里的脚本用不可见 template 占位,否则全部挪到 </body> 前会改变执行时序。
    const scriptEls = [...doc.querySelectorAll('script')];
    const tailwindConfig = tailwindConfigOf(scriptEls);
    const bodyScripts = [];
    const scripts = scriptEls.map((s) => ({
      src: s.getAttribute('src') || '',
      content: s.getAttribute('src') ? '' : s.textContent,
      html: s.outerHTML,
      location: doc.body.contains(s) ? 'body' : 'head',
    }));
    if (scripts.length) report.kept = t('import.scriptsKept', { count: scripts.length });
    scriptEls.forEach((n) => {
      if (doc.body.contains(n)) {
        const i = bodyScripts.length;
        bodyScripts.push(n.outerHTML);
        const marker = doc.createElement('template');
        marker.setAttribute('data-clay-script', String(i));
        n.replaceWith(marker);
      } else {
        n.remove();
      }
    });
    const links = doc.querySelectorAll('link[rel="stylesheet"]');
    if (links.length) {
      const note = t('import.stylesKept', { count: links.length });
      report.kept = report.kept ? report.kept + `;${note}` : note;
    }
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
      bodyAttrs: attrsOf(body),
      bodyStyleMap: inlineStyleOf(body),
      bodyClass: (body.getAttribute('class') || '').trim(),
      bodyStyle: (body.getAttribute('style') || '').trim(),
      htmlAttrs: attrsOf(doc.documentElement),
      viewport,
      baseHref,
      headNodes,
      bodyScripts,
      tailwindConfig,
      fidelityVersion: 2,
      styleText,
      editorStyleText,
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
      case 'header': return t('element.header');
      case 'nav': return t('element.nav');
      case 'footer': return t('element.footer');
      case 'main': return t('element.main');
      case 'aside': return t('element.aside');
      case 'ul': case 'ol': return t('element.list');
      case 'li': return t('element.listItem');
      case 'img': return t('element.image');
      case 'svg': return t('element.icon');
      case 'button': return withText(t('element.button'), comp);
      case 'a': return withText(t(looksLikeButton(comp) ? 'element.button' : 'element.link'), comp);
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return withText(t('element.heading'), comp);
      case 'p': return withText(t('element.text'), comp);
      case 'span': return withText(t('element.text'), comp);
      case 'section': return withHeading(t('element.section'), comp);
      case 'form': return t('element.form');
      case 'input': case 'textarea': case 'select': return t('element.input');
      case 'table': return t('element.table');
      case 'td': case 'th': return withText(t('element.cell'), comp);
      case 'video': return t('element.video');
      default:
        if (type === 'textnode') return null;
        return null; // div 等交给结构推断
    }
  }

  function withText(prefix, comp) {
    const t = textOf(comp, 8);
    return t ? (window.ClayI18n.getLocale() === 'en-US' ? `${prefix} “${t}”` : `${prefix}「${t}」`) : prefix;
  }

  function withHeading(prefix, comp) {
    const el = comp.getEl && comp.getEl();
    const h = el && el.querySelector('h1,h2,h3,h4');
    const t = h ? h.textContent.trim().replace(/\s+/g, ' ').slice(0, 10) : '';
    return t ? (window.ClayI18n.getLocale() === 'en-US' ? `${prefix} “${t}”` : `${prefix}「${t}」`) : prefix;
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
        k.set('custom-name', t ? window.ClayI18n.t('element.cardNamed', { name: t }) : window.ClayI18n.t('element.card', { count: i + 1 }));
      });
    });
    // 兜底:还叫默认名的容器
    walk(root, (comp) => {
      if (comp.get('custom-name')) return;
      const tag = (comp.get('tagName') || '').toLowerCase();
      if (tag === 'div') comp.set('custom-name', t('element.container'));
    });
  }

  function walk(comp, fn) {
    fn(comp);
    if (comp.components) comp.components().forEach((c) => walk(c, fn));
  }

  function cssBaseline(editor) {
    const out = {};
    try {
      editor.Css.getRules().forEach((rule) => {
        const sel = rule.selectorsToString ? rule.selectorsToString() : '';
        const style = rule.styleToString ? rule.styleToString() : '';
        if (!sel || !style.trim()) return;
        const key = (rule.get('mediaText') || '') + '\u241f' + sel;
        out[key] = style.replace(/\s+/g, ' ').trim();
      });
    } catch (e) { /* 老底座没有 Css API 时回退为空基线 */ }
    return out;
  }

  /* ── 主入口 ───────────────────────────────── */
  // 返回 { isTailwind, report };调用方负责在 Tailwind 模式切换时重建编辑器
  function importIntoEditor(editor, raw) {
    const parsed = parse(raw);
    const wrapper = editor.getWrapper();

    // 编辑器可能被上一个文档复用过:先彻底清场,否则上一页的 body 类和样式规则
    // 会漏进这一页(表现为浅色页面被上一页的 bg-slate-950 染黑)
    wrapper.getClasses().slice().forEach((c) => wrapper.removeClass(c));
    // class/style 之外的 body 属性(data-theme/dir/lang/id...)也会参与选择器与排版。
    // 切文档前先清掉上一页属性,再完整应用当前页,避免主题串页。
    const oldAttrs = wrapper.getAttributes ? wrapper.getAttributes() : {};
    Object.keys(oldAttrs || {}).forEach((name) => {
      if (wrapper.removeAttributes) wrapper.removeAttributes(name);
    });
    wrapper.setStyle({});
    editor.Css.clear();

    editor.setComponents(parsed.bodyHtml);
    editor.setStyle(parsed.editorStyleText || parsed.styleText);

    // class/style 在 GrapesJS 中分别走 ClassManager / style model,不能只塞 attributes
    // (会被内部正规化吃掉);其余 data-*/lang/dir 等按普通属性保留。
    const bodyAttrs = Object.assign({}, parsed.bodyAttrs || {});
    delete bodyAttrs.class;
    delete bodyAttrs.style;
    if (wrapper.addAttributes) wrapper.addAttributes(bodyAttrs);
    if (parsed.bodyClass) parsed.bodyClass.split(/\s+/).filter(Boolean).forEach((c) => wrapper.addClass(c));
    if (parsed.bodyStyleMap) wrapper.addStyle(parsed.bodyStyleMap);
    wrapper.set('custom-name', t('element.page'));
    nameTree(wrapper);
    // 保存“刚导入、尚未编辑”时的规则快照。导出时用当前规则减去这份基线,
    // 才能识别带作者自定义 id 的元素修改;仅靠 #iXXX 会漏掉这类改动。
    parsed.baselineRules = cssBaseline(editor);
    return parsed;
  }

  // 只解析、不碰画布 —— 查重时需要先知道这份内容的特征,再决定要不要真导入
  function parseOnly(raw) {
    return parse(raw);
  }

  window.ClayImporter = { importIntoEditor, detectTailwind, parseOnly };
})();
