/*
 * Production-chain smoke test.
 *
 * Unlike the renderer-only suites, this runner starts `electron .`, so the
 * real main process and preload bridge are in the path.  It talks to the
 * renderer through the Chromium DevTools protocol instead of replacing
 * window.clay with a test double.
 */
const assert = require('assert');
const { execFile, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const appRoot = path.join(__dirname, '..');
const execFileAsync = promisify(execFile);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} from ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
        }
      });
    });
    request.once('error', reject);
    request.setTimeout(1500, () => request.destroy(new Error(`Timed out reading ${url}`)));
  });
}

async function waitFor(label, fn, timeout = 15000, interval = 100) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
      if (err && err.fatal) throw err;
    }
    await sleep(interval);
  }
  const suffix = lastError ? `: ${lastError.message}` : '';
  throw new Error(`${label} timed out${suffix}`);
}

function observeProcess(child) {
  if (child.__clayClosePromise) return child;
  child.__clayClosePromise = new Promise((resolve, reject) => {
    let processError = null;
    child.once('error', (err) => { processError = err; });
    child.once('close', (code, signal) => {
      if (processError) {
        processError.processResult = { code, signal };
        reject(processError);
      } else {
        resolve({ code, signal });
      }
    });
  });
  // A process can fail before the first cleanup call; keep that rejection
  // attached until waitForProcess consumes it rather than creating an
  // unhandled rejection during startup diagnostics.
  child.__clayClosePromise.catch(() => {});
  return child;
}

function waitForProcess(child, timeout = 15000) {
  if (!child) return Promise.resolve(null);
  if (!child.__clayClosePromise) {
    if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
    observeProcess(child);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron process did not exit in time')), timeout);
    child.__clayClosePromise.then((result) => {
      clearTimeout(timer);
      resolve(result);
    }, (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function terminateProcess(child, signal = 'SIGKILL', timeout = 15000) {
  if (!child) return null;
  if (child.exitCode === null) child.kill(signal);
  return waitForProcess(child, timeout);
}

class CdpPage {
  constructor(target) {
    this.target = target;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
  }

  async connect() {
    const socket = new WebSocket(this.target.webSocketDebuggerUrl);
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch (err) { return; }
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP socket closed'));
      this.pending.clear();
    });
    socket.addEventListener('error', (event) => {
      const message = event && event.message ? event.message : 'CDP socket error';
      for (const pending of this.pending.values()) pending.reject(new Error(message));
      this.pending.clear();
    });
    await new Promise((resolve, reject) => {
      const onOpen = () => { socket.removeEventListener('error', onError); resolve(); };
      const onError = (event) => reject(new Error(event && event.message || 'CDP socket failed to open'));
      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
    });
  }

  command(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP socket is not open'));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description
        || response.exceptionDetails.text || 'Renderer evaluation failed');
    }
    return response.result && response.result.value;
  }

  close() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
    this.socket = null;
  }
}

async function launchOnce(userData, pdfOut, port) {
  const electronBinary = require('electron');
  let child = null;
  let output = '';
  let spawnError = null;
  let page = null;
  let connected = false;
  try {
    // Keep the process lifecycle inside this try/catch from the synchronous
    // spawn onward.  A failed spawn still follows the same diagnostic path.
    child = spawn(electronBinary, ['.', '--headless', `--remote-debugging-port=${port}`], {
      cwd: appRoot,
      env: {
        ...process.env,
        CLAY_USERDATA: userData,
        CLAY_PDF_OUT: pdfOut,
        CLAY_TEST_CLOSE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    observeProcess(child);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', (err) => {
      spawnError = err;
      output += `\nElectron spawn error: ${err.message}`;
    });
    const target = await waitFor('production page', async () => {
      if (spawnError) {
        const failure = new Error(`Electron failed to spawn: ${spawnError.message}`);
        failure.fatal = true;
        throw failure;
      }
      if (child.exitCode !== null) {
        const failure = new Error(`Electron exited before exposing the renderer (code=${child.exitCode}, signal=${child.signalCode || 'none'})`);
        failure.fatal = true;
        throw failure;
      }
      const pages = await getJson(`http://127.0.0.1:${port}/json/list`);
      return pages.find((candidate) => candidate.type === 'page' && candidate.url.includes('/renderer/index.html'));
    }, 30000);
    page = new CdpPage(target);
    await page.connect();
    connected = true;
    await waitFor('Clay renderer initialization', async () => page.evaluate('Boolean(window.__clay && window.__clayReady)'), 30000);
    await page.evaluate(`(async () => {
      if (!window.__clayReady) throw new Error('window.__clayReady is missing');
      await window.__clayReady;
      return true;
    })()`);
    return { child, page, getOutput: () => output };
  } catch (err) {
    if (page) page.close();
    if (child) {
      try {
        await terminateProcess(child);
      } catch (cleanupErr) {
        err = new Error(`${err.message}; failed to stop Electron: ${cleanupErr.message}`);
        err.cause = cleanupErr;
      }
    }
    err.electronOutput = output;
    // A failure before CDP connected can be a port collision. The caller may
    // retry with a fresh OS-assigned port; renderer failures must fail fast.
    err.retryable = !connected && !spawnError;
    throw err;
  }
}

async function launch(userData, pdfOut) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const port = await freePort();
    try {
      return await launchOnce(userData, pdfOut, port);
    } catch (err) {
      lastError = err;
      if (!err.retryable || attempt === 3) throw err;
      await sleep(250 * attempt);
    }
  }
  throw lastError || new Error('Electron launch failed');
}

async function stopAbnormally(session) {
  session.page.close();
  return terminateProcess(session.child, 'SIGKILL', 15000);
}

async function stopCleanly(session) {
  await session.page.evaluate(`(() => {
    if (!window.clay || !window.clay.testRequestClose) throw new Error('production close bridge missing');
    window.clay.testRequestClose();
    return true;
  })()`);
  session.page.close();
  return waitForProcess(session.child, 30000);
}

function readWorkspace(userData) {
  const workspacePath = path.join(userData, 'workspace.json');
  return JSON.parse(fs.readFileSync(workspacePath, 'utf8'));
}

function commandAvailable(command) {
  const result = spawnSync(command, ['-v'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function parsePdfInfo(output) {
  const pages = output.match(/^Pages:\s*(\d+)/m);
  const size = output.match(/^Page size:\s*([\d.]+)\s+x\s+([\d.]+)/m);
  return {
    pages: pages ? Number(pages[1]) : null,
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
  };
}

function parsePpm(buffer) {
  let offset = 0;
  const token = () => {
    while (offset < buffer.length) {
      const byte = buffer[offset];
      if (byte === 35) {
        while (offset < buffer.length && buffer[offset] !== 10) offset++;
      } else if (byte <= 32) {
        offset++;
      } else {
        break;
      }
    }
    const start = offset;
    while (offset < buffer.length && buffer[offset] > 32) offset++;
    return buffer.toString('ascii', start, offset);
  };
  const magic = token();
  const width = Number(token());
  const height = Number(token());
  const max = Number(token());
  if (magic !== 'P6' || !Number.isInteger(width) || !Number.isInteger(height) || max !== 255) {
    throw new Error('Unexpected PPM output from pdftoppm');
  }
  // The header terminator is one whitespace byte.  Do not skip every byte
  // <= 0x20 here: the first raster pixel is binary data and can legitimately
  // begin with a low-valued channel (notably a black footer).
  if (buffer[offset] === 13) {
    offset++;
    if (buffer[offset] === 10) offset++;
  } else if (buffer[offset] <= 32) {
    offset++;
  }
  const pixels = buffer.subarray(offset);
  if (pixels.length < width * height * 3) throw new Error('Truncated PPM output from pdftoppm');
  return { width, height, pixels };
}

function bottomInkRatio(ppm) {
  const firstRow = Math.floor(ppm.height * 0.8);
  let ink = 0;
  let samples = 0;
  for (let y = firstRow; y < ppm.height; y += 2) {
    for (let x = 0; x < ppm.width; x += 2) {
      const i = (y * ppm.width + x) * 3;
      if (Math.min(ppm.pixels[i], ppm.pixels[i + 1], ppm.pixels[i + 2]) < 245) ink++;
      samples++;
    }
  }
  return samples ? ink / samples : 0;
}

async function inspectPdf(pdfPath, diagnosticDir) {
  const report = [];
  let info = { pages: null, width: null, height: null };
  const hasPdfInfo = commandAvailable('pdfinfo');
  const hasPdfToPpm = commandAvailable('pdftoppm');
  if (hasPdfInfo) {
    const result = await execFileAsync('pdfinfo', [pdfPath], {
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      maxBuffer: 1024 * 1024,
    });
    report.push('$ pdfinfo ' + pdfPath + '\n' + result.stdout + result.stderr);
    info = parsePdfInfo(result.stdout);
  } else {
    const source = fs.readFileSync(pdfPath).toString('latin1');
    const pages = source.match(/\/Count\s+(\d+)\b/);
    const pageObjects = source.match(/\/Type\s*\/Page\b/g) || [];
    const size = source.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    info = {
      pages: pages ? Number(pages[1]) : (pageObjects.length || null),
      width: size ? Number(size[1]) : null,
      height: size ? Number(size[2]) : null,
    };
    report.push('pdfinfo unavailable; used PDF structure fallback');
  }

  let rendered = null;
  if (hasPdfToPpm) {
    const prefix = path.join(diagnosticDir, 'production-render');
    const result = await execFileAsync('pdftoppm', [
      '-f', '1', '-l', '1', '-singlefile', '-r', '72', pdfPath, prefix,
    ], { maxBuffer: 1024 * 1024 });
    report.push('$ pdftoppm -f 1 -l 1 -singlefile -r 72 ' + pdfPath + '\n'
      + (result.stdout || '') + (result.stderr || ''));
    rendered = parsePpm(fs.readFileSync(prefix + '.ppm'));
    rendered.bottomInk = bottomInkRatio(rendered);
  } else {
    report.push('pdftoppm unavailable; skipped pixel-level bottom-content assertion');
  }
  fs.writeFileSync(path.join(diagnosticDir, 'pdf-inspection.txt'), report.join('\n\n'), 'utf8');
  return { ...info, rendered };
}

async function run() {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-production-chain-'));
  const userData = path.join(testDir, 'user-data');
  const sourceFile = path.join(testDir, 'production-source.html');
  const deniedPath = path.join(testDir, 'ungranted.html');
  const pdfPath = path.join(testDir, 'production-output.pdf');
  const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Production chain</title><script src="https://cdn.tailwindcss.com"></script><style>html,body{margin:0;padding:0}#pdf-spacer{height:900px}#pdf-bottom{height:100px;background:#6d4aff;color:#fff;display:flex;align-items:center;justify-content:center;font:700 24px sans-serif}</style></head><body><main id="target" class="flex flex-col bg-purple-600 p-4 text-white">Original production content</main><div id="pdf-spacer"></div><footer id="pdf-bottom">PDF_BOTTOM_MARKER</footer></body></html>`;
  fs.writeFileSync(sourceFile, fixture, 'utf8');
  // Electron resolves the capability key through realpath (macOS /var often
  // aliases /private/var).  Seed and assert that canonical path so the test
  // exercises the same path identity as the production preload bridge.
  const sourcePath = fs.realpathSync.native(sourceFile);
  fs.writeFileSync(deniedPath, fixture, 'utf8');
  // The real app grants file capabilities from an existing workspace/recents
  // entry.  Seed only that non-sensitive capability; runImport still goes
  // through the production renderer and the actual preload bridge.
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({
    docs: [],
    activeDocId: null,
    docSeq: 0,
    recents: [{ path: sourcePath, name: 'production-source' }],
    sessionOpen: false,
  }), 'utf8');
  let session;
  let succeeded = false;
  let primaryError = null;
  let diagnosticOutput = '';

  try {
    session = await launch(userData, pdfPath);
    const denied = await session.page.evaluate(`(async () => ({
      read: await window.clay.readPath(${JSON.stringify(deniedPath)}),
      write: await window.clay.writeFile(${JSON.stringify(deniedPath)}, 'must-not-write'),
      pdf: await window.clay.exportPdf('production-output.pdf', '<!doctype html><p>denied</p>', 320, 240, ${JSON.stringify(deniedPath)}),
    }))()`);
    assert.strictEqual(denied.read, null);
    assert.strictEqual(denied.write.ok, false);
    assert.strictEqual(denied.pdf.ok, false);

    const imported = await session.page.evaluate(`(async () => {
      const source = await window.clay.readPath(${JSON.stringify(sourcePath)});
      if (!source) throw new Error('authorized source could not be read through preload');
      await window.__clay.runImport(source.content, source.name.replace(/\\.html?$/i, ''), source.path);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (window.__clay.getDocs().length === 1 && window.__clayEditor && window.__clayEditor.getWrapper().components().length) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('production document did not import');
    })()`);
    assert.strictEqual(imported, true);

    const updated = await session.page.evaluate(`(async () => {
      let component = null;
      const walk = (node) => {
        if (!node || component) return;
        const attrs = node.getAttributes && node.getAttributes();
        if (attrs && attrs.id === 'target') { component = node; return; }
        if (node.components) node.components().forEach(walk);
      };
      walk(window.__clayEditor.getWrapper());
      if (!component) throw new Error('production target component missing');
      component.components('Saved through the production preload bridge');
      await new Promise((resolve) => setTimeout(resolve, 350));
      return {
        dirty: !!window.__clay.getDocs()[0].dirty,
        html: window.__clayEditor.getHtml(),
      };
    })()`);
    assert.match(updated.html, /Saved through the production preload bridge/);
    assert.strictEqual(updated.dirty, true);

    const tailwindCanvas = await waitFor('Tailwind canvas CSS', async () => session.page.evaluate(`(() => {
      const styles = [...window.__clayEditor.Canvas.getDocument().querySelectorAll('style')]
        .map((node) => node.textContent || '')
        .filter((css) => /--tw-/.test(css));
      return styles.length ? { count: styles.length, length: styles.sort((a, b) => b.length - a.length)[0].length } : false;
    })()`), 20000);
    assert.ok(tailwindCanvas.length > 2000, 'Tailwind canvas CSS should be generated from the runtime');

    const saved = await session.page.evaluate('window.__clay.saveToSource()');
    assert.strictEqual(saved, true);
    await waitFor('source save', () => fs.readFileSync(sourcePath, 'utf8').includes('Saved through the production preload bridge'));

    const workspace = await waitFor('workspace persistence', () => {
      try {
        const value = readWorkspace(userData);
        const data = value.docs && value.docs[0] && JSON.stringify(value.docs[0].data || {});
        return value.sessionOpen === true && value.docs && value.docs.length === 1
          && value.docs[0].sourcePath === sourcePath
          && value.docs[0].dirty === false
          && value.recents && value.recents.some((recent) => recent.path === sourcePath)
          && data && data.includes('Saved through the production preload bridge')
          && data.includes('PDF_BOTTOM_MARKER') ? value : false;
      } catch (err) {
        return false;
      }
    }, 15000);
    assert.strictEqual(workspace.docs[0].sourcePath, sourcePath);
    assert.match(JSON.stringify(workspace.docs[0].data || {}), /Saved through the production preload bridge/);
    assert.match(JSON.stringify(workspace.docs[0].data || {}), /PDF_BOTTOM_MARKER/);

    const pdf = await session.page.evaluate(`(async () => {
      const d = window.__clay.getDocs()[0];
      if (!window.ClayExporter || typeof window.ClayExporter.buildForPdf !== 'function') {
        throw new Error('ClayExporter.buildForPdf is required for production PDF export');
      }
      const built = await window.ClayExporter.buildForPdf(window.__clayEditor, d);
      const snapshot = typeof built === 'string' ? built : built && built.code;
      if (typeof snapshot !== 'string') throw new Error('buildForPdf returned no HTML snapshot');
      if (/<script\\b/i.test(snapshot)) throw new Error('PDF snapshot must be script-free');
      if (!/--tw-/.test(snapshot)) throw new Error('PDF snapshot lost static Tailwind CSS');
      if (!snapshot.includes('PDF_BOTTOM_MARKER')) throw new Error('PDF snapshot lost bottom content');
      return window.clay.exportPdf('production-output.pdf', snapshot, 800, 600, d.sourcePath);
    })()`);
    assert.deepStrictEqual(pdf, { ok: true, path: pdfPath });
    assert.ok(fs.statSync(pdfPath).size > 1000, 'production PDF should not be empty');
    assert.strictEqual(fs.readFileSync(pdfPath).subarray(0, 5).toString(), '%PDF-');
    const normalPdfSize = fs.statSync(pdfPath).size;
    const pdfInspection = await inspectPdf(pdfPath, testDir);
    assert.strictEqual(pdfInspection.pages, 1, 'production PDF should contain exactly one page');
    if (pdfInspection.width && pdfInspection.height) {
      assert.ok(pdfInspection.width >= 590 && pdfInspection.width <= 610, 'PDF width does not match the 800px export request');
      assert.ok(pdfInspection.height >= 750 && pdfInspection.height <= 850, 'PDF height does not match the fixture content');
      assert.ok(Math.abs((pdfInspection.width / pdfInspection.height) - 0.758) < 0.06,
        `PDF aspect ratio mismatch: ${pdfInspection.width} x ${pdfInspection.height}`);
    }
    if (pdfInspection.rendered) {
      assert.ok(pdfInspection.rendered.bottomInk > 0.01,
        `rendered PDF bottom is blank (ink ratio ${pdfInspection.rendered.bottomInk})`);
    }

    const tooTall = await session.page.evaluate(`window.clay.exportPdf(
      'production-too-tall.pdf',
      '<!doctype html><html><body><div style="height:30001px">too tall</div></body></html>',
      800, 600, ${JSON.stringify(sourcePath)})`);
    assert.strictEqual(tooTall.ok, false, JSON.stringify(tooTall));
    assert.match(tooTall.error, /30000/);
    assert.strictEqual(fs.statSync(pdfPath).size, normalPdfSize, 'failed tall export replaced the valid PDF');

    await stopAbnormally(session);
    session = null;

    session = await launch(userData, pdfPath);
    const recovered = await session.page.evaluate(`({
      docs: window.__clay.getDocs().length,
      home: !document.querySelector('#empty-state').hidden,
      activeDocId: window.__clay.getActiveDocId(),
    })`);
    assert.deepStrictEqual(recovered, { docs: 1, home: true, activeDocId: null });

    const closed = await stopCleanly(session);
    assert.strictEqual(closed.code, 0, `clean production exit failed: ${JSON.stringify(closed)}`);
    session = null;
    const closedWorkspace = readWorkspace(userData);
    assert.deepStrictEqual({ docs: closedWorkspace.docs.length, sessionOpen: closedWorkspace.sessionOpen }, {
      docs: 0,
      sessionOpen: false,
    });

    succeeded = true;
    process.stdout.write('production-chain.e2e: ok (electron . + main/preload + save/workspace/pdf/exit)\n');
  } catch (err) {
    primaryError = err;
    diagnosticOutput = err.electronOutput || (session && session.getOutput && session.getOutput()) || '';
    throw err;
  } finally {
    let cleanupError = null;
    if (session) {
      try { session.page.close(); } catch (err) { /* best effort */ }
      try {
        await terminateProcess(session.child, 'SIGKILL', 15000);
      } catch (cleanupErr) {
        cleanupError = cleanupErr;
        if (primaryError) process.stderr.write(`Electron cleanup failed: ${cleanupErr.stack || cleanupErr}\n`);
      }
    }
    const keepTestOutput = process.env.CLAY_KEEP_TEST_OUTPUT === '1';
    if (succeeded && !keepTestOutput && !cleanupError) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (removeErr) {
        cleanupError = removeErr;
      }
    } else {
      if (diagnosticOutput) fs.writeFileSync(path.join(testDir, 'electron.log'), diagnosticOutput, 'utf8');
      process.stdout.write(`production test data preserved at ${testDir}${keepTestOutput && succeeded ? ' (CLAY_KEEP_TEST_OUTPUT=1)' : ''}\n`);
    }
    if (cleanupError) throw cleanupError;
  }
}

run().catch((err) => {
  process.stderr.write((err && err.stack) || String(err));
  process.stderr.write('\n');
  process.exitCode = 1;
});
