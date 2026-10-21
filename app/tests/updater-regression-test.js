const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createUpdater, isNewerVersion, RELEASE_API } = require('../updater');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-updater-test-'));
const packageBody = Buffer.from('fixture installer, never executed');
const checksum = crypto.createHash('sha256').update(packageBody).digest('hex');
const assetName = 'Clay-0.2.0-arm64.dmg';
const metadata = () => ({ tag_name: 'v0.2.0', draft: false, prerelease: false, assets: [
  { name: assetName, size: packageBody.length, browser_download_url: 'https://untrusted.invalid/evil' },
  { name: 'SHA256SUMS.txt' },
] });
let count = 0;

function fixture(options = {}) {
  const requests = [];
  const opened = [];
  const states = [];
  let mode = options.mode || 'ok';
  const updater = createUpdater({
    currentVersion: options.currentVersion || '0.1.1', arch: options.arch || 'arm64', platform: options.platform || 'darwin',
    cacheDir: testDir,
    onChange: (state) => states.push(state),
    openPath: async (file) => { opened.push(file); return mode === 'open' ? 'failed' : ''; },
    fetch: async (url) => {
      requests.push(url);
      if (mode === 'network') throw new Error('offline');
      if (mode === 'rate-limit') return new Response('', { status: 403 });
      if (url === RELEASE_API) return new Response(JSON.stringify(options.metadata || metadata()));
      if (url.endsWith('SHA256SUMS.txt')) {
        return new Response(`${mode === 'checksum' ? '0'.repeat(64) : checksum}  ${assetName}\n`);
      }
      return new Response(mode === 'size' ? 'short' : packageBody);
    },
  });
  return { updater, requests, opened, states, mode: (value) => { mode = value; } };
}

async function run() {
  assert(isNewerVersion('v0.10.0', '0.9.9'));
  assert(isNewerVersion('2.0.0', '1.99.99'));
  for (const candidate of ['0.1.1', '0.1.0', 'v0.2.0-beta', 'v01.2.0', '../../evil', null]) {
    assert.strictEqual(isNewerVersion(candidate, '0.1.1'), false);
  }
  count += 8;

  const f = fixture();
  assert.strictEqual(await f.updater.openInstaller(), false);
  const first = f.updater.check();
  assert.strictEqual(f.updater.check(), first, 'parallel checks must share a request');
  assert.strictEqual((await first).phase, 'available');
  assert.strictEqual(f.requests.length, 1);
  assert.deepStrictEqual(f.opened, []);
  const download = f.updater.download();
  assert.strictEqual(f.updater.download(), download, 'parallel downloads must share a request');
  assert.strictEqual((await download).phase, 'ready');
  assert.strictEqual(f.states.at(-1).progress, 100);
  assert.deepStrictEqual(f.opened, [], 'download alone must not open the package');
  assert(await f.updater.openInstaller());
  assert.deepStrictEqual(fs.readFileSync(f.opened[0]), packageBody);
  assert(f.requests.every((url) => url.startsWith('https://api.github.com/repos/EasonYan7/clay/') || url.startsWith('https://github.com/EasonYan7/clay/releases/download/v0.2.0/')));
  assert.strictEqual((await f.updater.check()).phase, 'ready');
  fs.writeFileSync(f.opened[0], 'tampered package');
  assert.strictEqual(await f.updater.openInstaller(), false);
  assert.strictEqual(f.updater.getState().error, 'checksum');
  assert.strictEqual(f.opened.length, 1, 'modified package must never be opened');
  count += 16;

  for (const currentVersion of ['0.2.0', '0.3.0']) {
    const current = fixture({ currentVersion });
    assert.strictEqual((await current.updater.check()).phase, 'current');
    assert.strictEqual(current.requests.length, 1);
    assert.strictEqual((await current.updater.download()).error, 'missing-asset');
    count += 3;
  }
  for (const [patch, error] of [
    [{ draft: true }, 'invalid-release'], [{ prerelease: true }, 'invalid-release'],
    [{ tag_name: 'v0.2.0-beta.1' }, 'invalid-release'], [{ tag_name: '../evil' }, 'invalid-release'],
    [{ assets: [] }, 'missing-asset'], [{ assets: [{ name: assetName, size: -1 }, { name: 'SHA256SUMS.txt' }] }, 'missing-asset'],
  ]) {
    const invalid = fixture({ metadata: { ...metadata(), ...patch } });
    assert.strictEqual((await invalid.updater.check()).error, error);
    assert.deepStrictEqual(invalid.opened, []);
    count += 2;
  }
  for (const arch of ['x64', 'unsupported']) {
    const other = fixture({ arch });
    assert.strictEqual((await other.updater.check()).phase, arch === 'x64' ? 'error' : 'unsupported');
    count++;
  }
  const unsupported = fixture({ platform: 'linux' });
  assert.strictEqual((await unsupported.updater.check()).phase, 'unsupported');
  assert.strictEqual(unsupported.requests.length, 0);
  count += 2;
  for (const mode of ['checksum', 'size', 'network', 'rate-limit']) {
    const failed = fixture();
    await failed.updater.check();
    failed.mode(mode);
    const result = await failed.updater.download();
    assert.strictEqual(result.phase, 'error');
    assert.strictEqual(await failed.updater.openInstaller(), false);
    assert.deepStrictEqual(failed.opened, []);
    failed.mode('ok');
    assert.strictEqual((await failed.updater.check()).phase, 'available');
    assert.strictEqual((await failed.updater.download()).phase, 'ready');
    count += 5;
  }
  for (const mode of ['network', 'rate-limit']) {
    const failed = fixture({ mode });
    assert.strictEqual((await failed.updater.check()).error, mode);
    failed.mode('ok');
    assert.strictEqual((await failed.updater.check()).phase, 'available');
    count += 2;
  }
  const failedOpen = fixture({ mode: 'open' });
  await failedOpen.updater.check();
  await failedOpen.updater.download();
  assert.strictEqual(await failedOpen.updater.openInstaller(), false);
  assert.strictEqual(failedOpen.updater.getState().error, 'open');
  count += 2;
  console.log(`Updater regression: ${count} assertions passed. Fixtures: ${testDir}`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
