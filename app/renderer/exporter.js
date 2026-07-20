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
  function indent(html) {
    return html
      .replace(/>(\s*)</g, '>\n<')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }

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
  function extractClayRules(editor) {
    const CLAY_ID = /#i[a-z0-9]{3,}/;
    let cm;
    try { cm = editor.Css; } catch (e) { return ''; }
    const out = [];
    const media = {};

    cm.getRules().forEach((rule) => {
      const sel = rule.selectorsToString ? rule.selectorsToString() : '';
      if (!sel || !CLAY_ID.test(sel)) return;
      const styleText = rule.styleToString ? rule.styleToString() : '';
      if (!styleText.trim()) return;
      const at = rule.get('mediaText');
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

  function build(editor, doc) {
    const isTailwind = doc.isTailwind;
    const bodyHtml = editor.getHtml();
    const clayCss = extractClayRules(editor);
    const originalCss = (doc.styleText || '').trim();

    let twBlock = '';
    let usedCdnFallback = false;
    if (isTailwind) {
      const twCss = extractTailwindCss(editor);
      if (twCss) {
        twBlock = '\n  <style>\n/* Tailwind(静态提取,离线可用) */\n' + twCss + '\n  </style>';
      } else {
        twBlock = '\n  <script src="https://cdn.tailwindcss.com"></script>';
        usedCdnFallback = true;
      }
    }

    const styleBlocks = [];
    if (originalCss) {
      styleBlocks.push('  <style>\n/* 原始样式 */\n' + originalCss + '\n  </style>');
    }
    if (clayCss) {
      styleBlocks.push('  <style>\n/* Clay 中调整的部分 */\n' + clayCss + '\n  </style>');
    }

    const title = doc.docTitle || doc.name || 'Untitled';
    const metaLines = (doc.headMeta || []).concat(doc.headLinks || [])
      .map((m) => '  ' + m).join('\n');

    const scriptBlock = (doc.scripts || [])
      .map((s) => s.src
        ? '<script src="' + s.src + '"></script>'
        : '<script>\n' + s.content + '\n</script>')
      .join('\n');

    const html = '<!DOCTYPE html>\n<html lang="zh">\n<head>\n' +
      '  <meta charset="UTF-8">\n' +
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '  <title>' + escapeHtml(title) + '</title>\n' +
      (metaLines ? metaLines + '\n' : '') +
      (twBlock ? twBlock.replace(/^\n/, '') + '\n' : '') +
      (styleBlocks.length ? styleBlocks.join('\n') + '\n' : '') +
      '</head>\n' +
      indent(bodyHtml).replace(/<\/body>$/, '') +
      (scriptBlock ? '\n' + scriptBlock + '\n' : '\n') +
      '</body>\n</html>';

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

  window.ClayExporter = { build, exportNote };
})();
