import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {spawn, execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve, extname, sep, join} from 'node:path';

const root = resolve('.');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const name of ['chrome','google-chrome','google-chrome-stable','chromium','chromium-browser']) {
    try { return execFileSync('which', [name], {encoding:'utf8'}).trim(); }
    catch { /* try another installed browser */ }
  }
  throw new Error('Chromium/Chrome is required for browser E2E tests (set CHROME_PATH)');
}

test('real Chromium UI: CSV validation, journal download and no uploads', {timeout:60000}, async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push({method:req.method, url:req.url});
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(path);
      res.writeHead(200, {'Content-Type':contentTypes[extname(path)] ?? 'application/octet-stream',
        'Cache-Control':'no-store'});
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  const profile = await mkdtemp(join(tmpdir(), 'reservation-e2e-'));
  let chrome;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = 'http://127.0.0.1:' + address.port + '/tests/browser-e2e.html';
    chrome = spawn(findChrome(), [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + profile, '--virtual-time-budget=12000', '--dump-dom', url
    ], {stdio:['ignore','pipe','pipe']});
    let stdout = '', stderr = '';
    chrome.stdout.setEncoding('utf8');
    chrome.stderr.setEncoding('utf8');
    chrome.stdout.on('data', chunk => {stdout += chunk;});
    chrome.stderr.on('data', chunk => {stderr += chunk;});
    const code = await new Promise((resolveExit, reject) => {
      const timeout = setTimeout(() => {
        chrome.kill('SIGKILL');
        reject(new Error('Chrome E2E timed out; stdout: ' + stdout.slice(-2000)));
      }, 45000);
      chrome.on('error', error => {clearTimeout(timeout); reject(error);});
      chrome.on('close', code => {clearTimeout(timeout); resolveExit(code);});
    });
    assert.equal(code, 0, 'Chrome exited abnormally: ' + stderr.slice(-2000));
    const marker = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    assert.ok(marker, 'Browser test marker missing: ' + stdout.slice(-2000));
    assert.match(marker[1], /^PASS:/, 'Browser assertion failed: ' + marker[1]);
    assert.ok(requests.length >= 4, 'Expected local HTML/JS/CSS requests');
    assert.ok(requests.every(request => request.method === 'GET'),
      'Unexpected request to local server: ' + JSON.stringify(requests));
  } finally {
    if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL');
    await new Promise(resolve => server.close(resolve));
    await rm(profile, {recursive:true, force:true});
  }
});
