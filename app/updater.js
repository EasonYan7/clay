const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const RELEASE_API = 'https://api.github.com/repos/EasonYan7/clay/releases/latest';
const RELEASE_PAGE = 'https://github.com/EasonYan7/clay/releases/latest';
const DOWNLOAD_ROOT = 'https://github.com/EasonYan7/clay/releases/download/';
const MAX_DOWNLOAD = 600 * 1024 * 1024;

// Stable releases only. Compare numerical components, never version strings.
function parseVersion(value) {
  const match = typeof value === 'string' && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  return match ? match.slice(1).map(BigInt) : null;
}

function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function updateError(code) { return Object.assign(new Error(code), { code }); }

function createUpdater({ currentVersion, arch, platform, fetch, cacheDir, onChange = () => {}, openPath }) {
  let state = { phase: 'idle', currentVersion, latestVersion: null, hasUpdate: false, progress: 0, error: null };
  let release = null;
  let pending = null;
  let downloaded = null;

  function publish(patch) {
    state = { ...state, error: null, ...patch };
    onChange({ ...state });
    return { ...state };
  }

  async function request(url, timeout, consume) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Clay-Update-Check' },
      });
      if (!response.ok) throw updateError(response.status === 403 || response.status === 429 ? 'rate-limit' : 'network');
      return await consume(response);
    } finally {
      clearTimeout(timer);
    }
  }

  async function readText(url, limit) {
    return request(url, 20000, async (response) => {
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > limit) throw updateError('invalid-release');
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString('utf8');
    });
  }

  function check() {
    if (pending) return pending;
    if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) {
      return Promise.resolve(publish({ phase: 'unsupported', hasUpdate: false }));
    }
    publish({ phase: 'checking', progress: 0 });
    pending = (async () => {
      try {
        const data = JSON.parse(await readText(RELEASE_API, 1024 * 1024));
        if (data.draft || data.prerelease || !parseVersion(data.tag_name) || !parseVersion(currentVersion)) {
          throw updateError('invalid-release');
        }
        const version = data.tag_name.replace(/^v/, '');
        if (!isNewerVersion(version, currentVersion)) {
          release = null;
          return publish({ phase: 'current', latestVersion: version, hasUpdate: false });
        }
        const name = `Clay-${version}-${arch}.dmg`;
        const asset = Array.isArray(data.assets) && data.assets.find((item) => item.name === name);
        const sums = Array.isArray(data.assets) && data.assets.find((item) => item.name === 'SHA256SUMS.txt');
        if (!asset || !sums || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_DOWNLOAD) {
          throw updateError('missing-asset');
        }
        // Never accept URLs or filesystem paths supplied by the renderer or release metadata.
        release = { version, name, size: asset.size, base: `${DOWNLOAD_ROOT}${data.tag_name}/` };
        return publish({ phase: downloaded && downloaded.version === version ? 'ready' : 'available', latestVersion: version, hasUpdate: true });
      } catch (err) {
        return publish({ phase: 'error', error: ['rate-limit', 'invalid-release', 'missing-asset'].includes(err.code) ? err.code : 'network' });
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  function download() {
    if (pending) return pending;
    if (!release) return Promise.resolve(publish({ phase: 'error', error: 'missing-asset' }));
    if (downloaded && downloaded.version === release.version) return Promise.resolve(publish({ phase: 'ready', progress: 100 }));
    const target = { ...release };
    publish({ phase: 'downloading', progress: 0 });
    pending = (async () => {
      let dir;
      try {
        const sums = await readText(target.base + 'SHA256SUMS.txt', 64 * 1024);
        const matches = sums.split(/\r?\n/).map((line) => /^([a-fA-F0-9]{64})\s+\*?([^\s]+)$/.exec(line.trim()))
          .filter((match) => match && match[2] === target.name);
        if (matches.length !== 1) throw updateError('checksum');
        const expected = matches[0][1].toLowerCase();
        await fs.promises.mkdir(cacheDir, { recursive: true });
        dir = await fs.promises.mkdtemp(path.join(cacheDir, 'clay-update-'));
        const partial = path.join(dir, target.name + '.partial');
        const file = path.join(dir, target.name);
        let bytes = 0;
        const hash = crypto.createHash('sha256');
        await request(target.base + target.name, 10 * 60 * 1000, async (response) => {
          const meter = new Transform({
            transform(chunk, _encoding, callback) {
              bytes += chunk.length;
              if (bytes > target.size) return callback(updateError('size'));
              hash.update(chunk);
              const progress = Math.min(99, Math.floor(bytes / target.size * 100));
              if (progress !== state.progress) publish({ progress });
              callback(null, chunk);
            },
          });
          await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
        });
        if (bytes !== target.size) throw updateError('size');
        if (hash.digest('hex') !== expected) throw updateError('checksum');
        await fs.promises.rename(partial, file);
        downloaded = { file, version: target.version, expected };
        return publish({ phase: 'ready', progress: 100 });
      } catch (err) {
        // Retain a failed partial in this attempt's private directory for diagnosis.
        return publish({ phase: 'error', error: ['checksum', 'size'].includes(err.code) ? err.code : 'download' });
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  async function openInstaller() {
    if (pending || !downloaded || state.phase !== 'ready') return false;
    try {
      // Recheck before handing the package to macOS, including subsequent opens.
      const hash = crypto.createHash('sha256');
      const info = await fs.promises.lstat(downloaded.file);
      if (!info.isFile() || info.isSymbolicLink()) throw updateError('checksum');
      for await (const chunk of fs.createReadStream(downloaded.file)) hash.update(chunk);
      if (hash.digest('hex') !== downloaded.expected) throw updateError('checksum');
      const error = await openPath(downloaded.file);
      if (error) throw updateError('open');
      return true;
    } catch (err) {
      downloaded = null;
      publish({ phase: 'error', error: err.code === 'checksum' ? 'checksum' : 'open' });
      return false;
    }
  }

  return { check, download, openInstaller, getState: () => ({ ...state }) };
}

module.exports = { createUpdater, isNewerVersion, RELEASE_API, RELEASE_PAGE };
