/* Clay 导出：普通 HTML 尽量保留作者原貌；canvas/PDF 使用同一份安全快照。
 *
 * GrapesJS 的 CSS 序列化会把 shorthand 拆成大量 initial/normal 噪声，因而
 * 作者原始 <style> 仍从 importer 的 raw headNodes 输出。Clay 规则只作为增量
 * 追加；被作者删除的基线规则则从原 CSS（包括 @media）中移除，删除语义不会
 * 被一个看似相反的 unset 规则伪造。
 */
(function () {
  const t = (key, vars) => window.ClayI18n.t(key, vars);
  const RULE_SEP = '\u241f';

  function normalizeSelector(value) {
    return String(value || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  }

  function normalizeMedia(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function ruleKey(media, selector) {
    return normalizeMedia(media) + RULE_SEP + normalizeSelector(selector);
  }

  function extractTailwindCss(editor) {
    try {
      const doc = editor.Canvas.getDocument();
      const candidates = [...doc.querySelectorAll('style')]
        .filter((s) => s.textContent.includes('--tw-') && s.textContent.length > 80)
        .sort((a, b) => b.textContent.length - a.textContent.length);
      return candidates.length ? candidates[0].textContent : '';
    } catch (e) {
      return '';
    }
  }

  function baselineMap(baselineRules) {
    const out = Object.create(null);
    if (!baselineRules || typeof baselineRules !== 'object') return out;
    Object.keys(baselineRules).forEach((rawKey) => {
      const index = rawKey.indexOf(RULE_SEP);
      const media = index < 0 ? '' : rawKey.slice(0, index);
      const selector = index < 0 ? rawKey : rawKey.slice(index + RULE_SEP.length);
      const normalized = String(baselineRules[rawKey] || '').replace(/\s+/g, ' ').trim();
      out[ruleKey(media, selector)] = { media, selector, style: normalized };
    });
    return out;
  }

  function currentRules(editor) {
    const out = [];
    try {
      editor.Css.getRules().forEach((rule) => {
        const selector = rule.selectorsToString ? rule.selectorsToString() : '';
        const style = rule.styleToString ? rule.styleToString() : '';
        if (!selector || !style.trim()) return;
        const media = rule.get('mediaText') || '';
        out.push({
          selector,
          style,
          media,
          rawKey: String(media) + RULE_SEP + selector,
          key: ruleKey(media, selector),
          normalized: style.replace(/\s+/g, ' ').trim(),
        });
      });
    } catch (e) { /* old GrapesJS builds may not expose Css */ }
    return out;
  }

  function extractClayDiff(editor, baselineRules) {
    const CLAY_ID = /#i[a-z0-9]{3,}/;
    const hasBaseline = baselineRules && typeof baselineRules === 'object';
    const baseline = baselineMap(baselineRules);
    const current = currentRules(editor);
    const currentKeys = new Set(current.map((r) => r.key));
    const changed = [];

    current.forEach((record) => {
      const base = baseline[record.key];
      // A parsed document has a baseline even when it started with no CSS. A
      // legacy document without one keeps the historical #iXXX fallback.
      if (hasBaseline ? (!base || base.style !== record.normalized) : CLAY_ID.test(record.selector)) {
        changed.push(record);
      }
    });

    const deleted = Object.keys(baseline).filter((key) => !currentKeys.has(key));
    const groups = Object.create(null);
    const plain = [];
    changed.forEach((record) => {
      const line = record.selector + '{' + record.style + '}';
      if (normalizeMedia(record.media)) (groups[normalizeMedia(record.media)] || (groups[normalizeMedia(record.media)] = [])).push(line);
      else plain.push(line);
    });
    let css = plain.join('\n');
    Object.keys(groups).forEach((media) => {
      css += (css ? '\n' : '') + '@media ' + media + ' {\n'
        + groups[media].map((line) => '  ' + line).join('\n') + '\n}';
    });
    const tombstones = deleted.map((key) => '/* Clay deleted: ' + key.replace(RULE_SEP, ' | ') + ' */');
    return { css: css.trim(), deleted, tombstones, current };
  }

  function extractClayRules(editor, baselineRules) {
    const diff = extractClayDiff(editor, baselineRules);
    return [diff.css, diff.tombstones.join('\n')].filter(Boolean).join('\n').trim();
  }

  function extractDeletedRuleKeys(editor, baselineRules) {
    return new Set(extractClayDiff(editor, baselineRules).deleted);
  }

  function findCssToken(css, start) {
    let quote = '';
    for (let i = start; i < css.length; i++) {
      const ch = css[i];
      const next = css[i + 1];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '/' && next === '*') {
        const end = css.indexOf('*/', i + 2);
        i = end < 0 ? css.length : end + 1;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '{' || ch === ';' || ch === '}') return { type: ch, index: i };
    }
    return null;
  }

  function matchingBrace(css, open) {
    let depth = 1;
    let quote = '';
    for (let i = open + 1; i < css.length; i++) {
      const ch = css[i];
      const next = css[i + 1];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '/' && next === '*') {
        const end = css.indexOf('*/', i + 2);
        i = end < 0 ? css.length : end + 1;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return i;
    }
    return css.length - 1;
  }

  function filterCssRules(css, deletedKeys, parentMedia) {
    if (!css || !deletedKeys || !deletedKeys.size) return css || '';
    let output = '';
    let cursor = 0;
    while (cursor < css.length) {
      const token = findCssToken(css, cursor);
      if (!token) { output += css.slice(cursor); break; }
      if (token.type === '}') { output += css.slice(cursor, token.index + 1); break; }
      if (token.type === ';') {
        output += css.slice(cursor, token.index + 1);
        cursor = token.index + 1;
        continue;
      }
      const end = matchingBrace(css, token.index);
      const prelude = css.slice(cursor, token.index);
      const body = css.slice(token.index + 1, end);
      const clean = normalizeSelector(prelude);
      let replacement = prelude + '{' + body + '}';
      const mediaMatch = clean.match(/^@media\s+([\s\S]*)$/i);
      if (mediaMatch) {
        const media = normalizeMedia(mediaMatch[1]);
        const nested = filterCssRules(body, deletedKeys, media);
        replacement = nested.trim() ? prelude + '{' + nested + '}' : '';
      } else if (/^@(supports|layer|container|document|scope)\b/i.test(clean)) {
        const nested = filterCssRules(body, deletedKeys, parentMedia || '');
        replacement = nested.trim() ? prelude + '{' + nested + '}' : '';
      } else if (clean && !/^@/.test(clean) && deletedKeys.has(ruleKey(parentMedia || '', clean))) {
        replacement = '';
      }
      output += replacement;
      cursor = end + 1;
    }
    return output;
  }

  function parsedElement(html) {
    if (typeof html !== 'string' || !html.trim()) return null;
    const holder = document.createElement('template');
    holder.innerHTML = html.trim();
    return holder.content.firstElementChild || null;
  }

  function actualHeadNodes(nodes) {
    if (!Array.isArray(nodes)) return [];
    return nodes.map((node) => {
      const el = parsedElement(node && node.html);
      if (!el) return null;
      return { tag: String(el.tagName || '').toLowerCase(), html: el.outerHTML };
    }).filter(Boolean);
  }

  function filteredStyleHtml(html, deletedKeys) {
    const el = parsedElement(html);
    if (!el || String(el.tagName).toLowerCase() !== 'style') return html;
    const media = el.getAttribute('media') || '';
    el.textContent = filterCssRules(el.textContent || '', deletedKeys, media);
    return el.outerHTML;
  }

  function applyDeletedRulesToHead(nodes, deletedKeys, allowScripts) {
    const normalized = !allowScripts && window.ClayImporter && window.ClayImporter.normalizeHeadNodes
      ? window.ClayImporter.normalizeHeadNodes(nodes, true, { dropped: [] })
      : actualHeadNodes(nodes);
    return normalized.filter((node) => {
      if (!allowScripts && node.tag === 'script') return false;
      return true;
    }).map((node) => {
      if (node.tag === 'style') node.html = filteredStyleHtml(node.html, deletedKeys);
      return node;
    });
  }

  function hasTailwindRuntime(nodes) {
    return actualHeadNodes(nodes).some((node) => node.tag === 'script' && /tailwindcss/i.test(node.html || ''));
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function attrsToString(attrs) {
    return Object.keys(attrs || {}).map((name) => {
      if (['__proto__', 'prototype', 'constructor'].includes(String(name).toLowerCase())) return '';
      if (!/^[A-Za-z_:][A-Za-z0-9:._-]*$/.test(String(name))) return '';
      const value = attrs[name];
      return value === '' ? ' ' + name : ' ' + name + '="' + escapeAttr(value) + '"';
    }).join('');
  }

  function restoreBodyScripts(html, scripts) {
    const used = {};
    const list = scripts || [];
    const marker = /<template\b[^>]*\bdata-clay-script=(?:"(\d+)"|'(\d+)'|(\d+))[^>]*>(?:\s*<\/template>)?/gi;
    let out = String(html || '').replace(marker, (_all, a, b, c) => {
      const i = Number(a || b || c);
      if (!Number.isInteger(i) || !list[i]) return '';
      used[i] = true;
      return list[i];
    });
    const orphan = list.filter((_s, i) => !used[i]);
    if (orphan.length) out = out.replace(/<\/body>\s*$/i, '') + '\n' + orphan.join('\n') + '\n</body>';
    return out;
  }

  function restoreAuthorAttrs(html, doc) {
    if (!window.ClayImporter || !window.ClayImporter.restoreAuthorActiveAttrs) return html;
    return window.ClayImporter.restoreAuthorActiveAttrs(html, doc.authorActiveAttrs || {});
  }

  function sanitizeCanvas(html) {
    const safe = window.ClayImporter && window.ClayImporter.sanitizeCanvasMarkup
      ? window.ClayImporter.sanitizeCanvasMarkup(html)
      : String(html || '');
    const holder = document.createElement('template');
    holder.innerHTML = safe;
    holder.content.querySelectorAll('template[data-clay-script]').forEach((node) => node.remove());
    holder.content.querySelectorAll('[data-clay-author-key]').forEach((node) => node.removeAttribute('data-clay-author-key'));
    return holder.innerHTML;
  }

  function addBodyAttrs(html, attrs) {
    const opening = '<body' + attrsToString(attrs) + '>';
    if (/^\s*<body\b/i.test(html)) return String(html).replace(/^\s*<body\b[^>]*>/i, opening);
    return opening + html + '</body>';
  }

  function build(editor, doc) {
    return buildDocument(editor, doc, false);
  }

  function buildForPdf(editor, doc) {
    const result = buildDocument(editor, doc, true);
    if (!result.ready) return result;
    return { ok: true, ready: true, code: result.code, usedCdnFallback: false };
  }

  function buildDocument(editor, doc, pdf) {
    doc = doc || {};
    const isTailwind = !!doc.isTailwind;
    const structured = doc.fidelityVersion >= 2 && (Array.isArray(doc.headNodes) || Array.isArray(doc.safeHeadNodes));
    const safe = !!pdf;
    let bodyHtml = editor.getHtml();
    bodyHtml = safe ? sanitizeCanvas(bodyHtml) : restoreAuthorAttrs(bodyHtml, doc);
    if (structured && !safe) bodyHtml = restoreBodyScripts(bodyHtml, doc.bodyScripts);

    const diff = extractClayDiff(editor, doc.baselineRules);
    // Tombstones are useful in normal HTML for the next Clay round-trip, but
    // they are editor bookkeeping and do not belong in a PDF snapshot.
    const clayCss = [diff.css, safe ? '' : diff.tombstones.join('\n')].filter(Boolean).join('\n').trim();
    const deletedKeys = new Set(diff.deleted);
    const originalCss = filterCssRules((doc.styleText || '').trim(), deletedKeys, '');
    const sourceNodes = safe ? (doc.safeHeadNodes || doc.headNodes || []) : (doc.headNodes || []);
    const headNodes = applyDeletedRulesToHead(sourceNodes, deletedKeys, !safe);

    let twBlock = '';
    let usedCdnFallback = false;
    if (isTailwind) {
      const runtime = hasTailwindRuntime(doc.headNodes || []);
      const twCss = extractTailwindCss(editor)
        || (/--tw-/.test(doc.styleText || '') && (doc.styleText || '').length > 80 ? doc.styleText : '');
      if (safe) {
        if (!twCss) return { ok: false, ready: false, error: 'tailwind-not-ready' };
        twBlock = '  <style>\n/* ' + t('export.commentTailwind') + ' */\n' + twCss + '\n  </style>';
      } else if (!runtime) {
        if (twCss) twBlock = '  <style>\n/* ' + t('export.commentTailwind') + ' */\n' + twCss + '\n  </style>';
        else {
          twBlock = '  <script src="https://cdn.tailwindcss.com"></script>';
          usedCdnFallback = true;
        }
      }
    }

    const headBlocks = [];
    if (structured) {
      headNodes.forEach((node) => { if (node && node.html) headBlocks.push('  ' + node.html); });
    } else if (originalCss) {
      headBlocks.push('  <style>\n/* ' + t('export.commentOriginal') + ' */\n' + originalCss + '\n  </style>');
      if (!safe) (doc.headMeta || []).concat(doc.headLinks || []).forEach((meta) => headBlocks.push('  ' + meta));
    }
    if (twBlock) headBlocks.push(twBlock);
    if (clayCss) headBlocks.push('  <style>\n/* ' + t('export.commentClay') + ' */\n' + clayCss + '\n  </style>');

    const title = doc.docTitle || doc.name || 'Untitled';
    const viewport = doc.viewport || (structured ? '' : 'width=device-width, initial-scale=1.0');
    const htmlAttrs = attrsToString(safe ? (doc.safeHtmlAttrs || doc.htmlAttrs || {}) : (doc.htmlAttrs || {}));
    const bodyAttrs = safe ? (doc.safeBodyAttrs || doc.bodyAttrs || {}) : (doc.bodyAttrs || {});
    let body = addBodyAttrs(bodyHtml, bodyAttrs);
    if (!safe && !structured) {
      const legacyScripts = (doc.scripts || []).map((s) => s.html || (s.src
        ? '<script src="' + escapeAttr(s.src) + '"></script>'
        : '<script>\n' + s.content + '\n</script>')).join('\n');
      if (legacyScripts) body = body.replace(/<\/body>\s*$/i, '') + '\n' + legacyScripts + '\n</body>';
    }
    const html = '<!DOCTYPE html>\n<html' + htmlAttrs + '>\n<head>\n'
      + '  <meta charset="UTF-8">\n'
      + (viewport ? '  <meta name="viewport" content="' + escapeAttr(viewport) + '">\n' : '')
      + '  <title>' + escapeHtml(title) + '</title>\n'
      + (headBlocks.length ? headBlocks.join('\n') + '\n' : '')
      + '</head>\n' + body + '\n</html>';

    // Defense in depth for PDF: only safe head nodes and sanitized body are
    // used, but do not let a malformed legacy node reintroduce a script.
    if (safe && /<script\b/i.test(html)) return { ok: false, ready: false, error: 'pdf-script-blocked' };
    return { code: html, usedCdnFallback, ready: true, ok: true };
  }

  function exportNote(doc, usedCdnFallback) {
    const parts = [];
    if (doc.isTailwind) parts.push(usedCdnFallback ? t('export.tailwindFallback') : t('export.tailwindInline'));
    else parts.push(t('export.standalone'));
    if ((doc.styleText || '').trim()) parts.push(t('export.cssPreserved'));
    if (doc.scripts && doc.scripts.length) parts.push(t('export.scriptsRestored', { count: doc.scripts.length }));
    return parts.join(' ');
  }

  window.ClayExporter = {
    build,
    buildForPdf,
    exportNote,
    extractClayRules,
    extractClayDiff,
    extractDeletedRuleKeys,
    filterCssRules,
    extractTailwindCss,
  };
})();
