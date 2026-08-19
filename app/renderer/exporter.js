/* Clay 导出:输出一份打开即用、且尽量保持作者原貌的完整 HTML
 *
 * 关键决策 —— 不让 GrapesJS 重新序列化作者的 CSS。
 * GrapesJS 解析样式时会把简写拆成长写(浏览器 CSSStyleDeclaration 的行为),
 * 再 getCss() 吐出来就变成:
 *     nav { padding:16px; background:#111 }
 *  → nav{padding-top:16px;...;background-image:initial;background-position-x:initial;…}
 * 体积膨胀 6-8 倍且全是 initial/normal 噪音,直接违背"导出干净代码"。
 *
 * 所以:原样保留作者的 <style> 原文,只追加 Clay 自己产生的规则
 * (componentFirst 模式下用户的每次修改都落在 #元素id 上,可精确摘出)。
 * 副产品:导出结果对开发者更好读——上半是你原来的样式,下半是被改了什么。
 */
(function () {
  // 画布里 Tailwind Play CDN 现场编译出的 CSS(特征:含 --tw- 变量且体量大)
  function extractTailwindCss(editor) {
    try {
      const doc = editor.Canvas.getDocument();
      const candidates = [...doc.querySelectorAll('style')]
        .filter((s) => s.textContent.includes('--tw-') && s.textContent.length > 2000)
        .sort((a, b) => b.textContent.length - a.textContent.length);
      return candidates.length ? candidates[0].textContent : '';
    } catch (e) {
      return '';
    }
  }

  /* 从 getCss() 里只摘出 Clay 生成的规则。
   * 判据:选择器命中 #i+短 id(GrapesJS 给被改过的元素分配的 id)。
   * 顶层规则与 @media 块分别处理,媒体查询里的改动同样要带走。 */
  function extractClayRules(editor, baselineRules) {
    const CLAY_ID = /#i[a-z0-9]{3,}/;
    const hasBaseline = baselineRules && typeof baselineRules === 'object';
    let cm;
    try { cm = editor.Css; } catch (e) { return ''; }
    const out = [];
    const media = {};

    cm.getRules().forEach((rule) => {
      const sel = rule.selectorsToString ? rule.selectorsToString() : '';
      if (!sel) return;
      const styleText = rule.styleToString ? rule.styleToString() : '';
      if (!styleText.trim()) return;
      const at = rule.get('mediaText');
      const key = (at || '') + '\u241f' + sel;
      const normalized = styleText.replace(/\s+/g, ' ').trim();
      // 新文档按“当前规则 vs 导入基线”识别 Clay 改动,所以作者原本带 id 的
      // 元素也不会漏。老工作区没有基线,继续使用历史 #iXXX 判据。
      if (hasBaseline ? baselineRules[key] === normalized : !CLAY_ID.test(sel)) return;
      const line = sel + '{' + styleText + '}';
      if (at) {
        (media[at] = media[at] || []).push(line);
      } else {
        out.push(line);
      }
    });

    let css = out.join('\n');
    Object.keys(media).forEach((q) => {
      css += '\n@media ' + q + ' {\n' + media[q].map((l) => '  ' + l).join('\n') + '\n}';
    });
    return css.trim();
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function attrsToString(attrs) {
    return Object.keys(attrs || {}).map((name) => {
      const value = attrs[name];
      return value === '' ? ' ' + name : ' ' + name + '="' + escapeAttr(value) + '"';
    }).join('');
  }

  function restoreBodyScripts(html, scripts) {
    const used = {};
    const list = scripts || [];
    const marker = /<template\b[^>]*\bdata-clay-script=(?:"(\d+)"|'(\d+)'|(\d+))[^>]*>(?:\s*<\/template>)?/gi;
    let out = html.replace(marker, (_all, a, b, c) => {
      const i = Number(a || b || c);
      if (!Number.isInteger(i) || !list[i]) return '';
      used[i] = true;
      return list[i];
    });
    // 极老的 GrapesJS 工程或手工编辑可能吞掉 template 标记。脚本宁可退回 body
    // 末尾也不能彻底消失,否则导出的按钮/图表会变成死页面。
    const orphan = list.filter((_s, i) => !used[i]);
    if (orphan.length) out = out.replace(/<\/body>\s*$/i, '') + '\n' + orphan.join('\n') + '\n</body>';
    return out;
  }

  function hasTailwindRuntime(nodes) {
    return (nodes || []).some((n) => n && n.tag === 'script' && /tailwindcss/i.test(n.html || ''));
  }

  function build(editor, doc) {
    const isTailwind = doc.isTailwind;
    let bodyHtml = editor.getHtml();
    const clayCss = extractClayRules(editor, doc.baselineRules);
    const originalCss = (doc.styleText || '').trim();
    const structured = doc.fidelityVersion >= 2 && Array.isArray(doc.headNodes);
    if (structured) bodyHtml = restoreBodyScripts(bodyHtml, doc.bodyScripts);

    let twBlock = '';
    let usedCdnFallback = false;
    /* 新导入的页面若本来就带 Tailwind runtime,保留原节点与版本/配置顺序才是最忠实的。
     * 只有作者没带 runtime 时才沿用旧策略:从画布静态提取,提取不到再回退 CDN。 */
    if (isTailwind && !(structured && hasTailwindRuntime(doc.headNodes))) {
      const twCss = extractTailwindCss(editor);
      if (twCss) {
        twBlock = '  <style>\n/* Tailwind(静态提取,离线可用) */\n' + twCss + '\n  </style>';
      } else {
        twBlock = '  <script src="https://cdn.tailwindcss.com"></script>';
        usedCdnFallback = true;
      }
    }

    const headBlocks = [];
    if (structured) {
      // style/link/script/base/meta 的相对顺序本身就是页面语义,逐节点原样还原。
      (doc.headNodes || []).forEach((n) => { if (n && n.html) headBlocks.push('  ' + n.html); });
    } else if (originalCss) {
      // 老工作区没有结构化 head,保持向后兼容。
      headBlocks.push('  <style>\n/* 原始样式 */\n' + originalCss + '\n  </style>');
      const metaLines = (doc.headMeta || []).concat(doc.headLinks || []);
      metaLines.forEach((m) => headBlocks.push('  ' + m));
    }
    if (twBlock) headBlocks.push(twBlock);
    if (clayCss) {
      headBlocks.push('  <style>\n/* Clay 中调整的部分 */\n' + clayCss + '\n  </style>');
    }

    const title = doc.docTitle || doc.name || 'Untitled';
    const viewport = structured ? doc.viewport : 'width=device-width, initial-scale=1.0';
    const htmlAttrs = structured ? attrsToString(doc.htmlAttrs) : ' lang="zh"';
    const legacyScripts = structured ? '' : (doc.scripts || [])
      .map((s) => s.html || (s.src
        ? '<script src="' + escapeAttr(s.src) + '"></script>'
        : '<script>\n' + s.content + '\n</script>'))
      .join('\n');

    // getHtml() 带 <body> 包装。不要再 trim/逐行缩进:那会改坏 pre/textarea
    // 等空白敏感内容,造成导出后排版与画布不同。
    let body = bodyHtml;
    if (!/^\s*<body\b/i.test(body)) body = '<body>' + body + '</body>';
    if (legacyScripts) body = body.replace(/<\/body>\s*$/i, '') + '\n' + legacyScripts + '\n</body>';

    const html = '<!DOCTYPE html>\n<html' + htmlAttrs + '>\n<head>\n' +
      '  <meta charset="UTF-8">\n' +
      (viewport ? '  <meta name="viewport" content="' + escapeAttr(viewport) + '">\n' : '') +
      '  <title>' + escapeHtml(title) + '</title>\n' +
      (headBlocks.length ? headBlocks.join('\n') + '\n' : '') +
      '</head>\n' +
      body + '\n</html>';

    return { code: html, usedCdnFallback };
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function exportNote(doc, usedCdnFallback) {
    const parts = [];
    if (doc.isTailwind) {
      parts.push(usedCdnFallback
        ? 'Tailwind 样式提取失败,已回退为联网运行时(打开需联网)。'
        : 'Tailwind 样式已静态内联,离线可直接打开。');
    } else {
      parts.push('完整独立的 HTML 文件,双击即可打开。');
    }
    // 只在真有原始样式时才这么说,否则是空话
    if ((doc.styleText || '').trim()) {
      parts.push('原始 CSS 原样保留,你在 Clay 里的调整单独列成一段。');
    }
    if (doc.scripts && doc.scripts.length) {
      parts.push('导入时暂存的 ' + doc.scripts.length + ' 段交互脚本已还原。');
    }
    return parts.join(' ');
  }

  window.ClayExporter = { build, exportNote, extractClayRules };
})();
