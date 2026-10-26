import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {spawn, execFileSync} from 'node:child_process';
import {waitForBrowserResult} from './browser-status.mjs';
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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connectToChrome(profile, chrome) {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (chrome.exitCode !== null) throw new Error('Chrome exited before DevTools started');
    try {
      port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      if (Number.isInteger(port) && port > 0) break;
    } catch { /* Chrome has not opened its debugging port yet. */ }
    await delay(100);
  }
  if (!port) throw new Error('Chrome DevTools port was not created');
  let page;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) break;
    } catch { /* Target list may not be ready immediately. */ }
    await delay(100);
  }
  if (!page) throw new Error('Chrome did not expose a page target');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => rejectOpen(new Error('DevTools WebSocket did not open')), 10000);
    socket.addEventListener('open', () => {clearTimeout(timer); resolveOpen();}, {once:true});
    socket.addEventListener('error', () => {clearTimeout(timer); rejectOpen(new Error('DevTools WebSocket failed'));}, {once:true});
  });
  return socket;
}

let nextCommandId = 0;
async function evaluate(socket, expression) {
  const id = ++nextCommandId;
  return new Promise((resolveValue, rejectValue) => {
    const timer = setTimeout(() => finish(new Error('DevTools evaluation timed out')), 5000);
    function finish(error, value) {
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      if (error) rejectValue(error); else resolveValue(value);
    }
    function onClose() {finish(new Error('DevTools connection closed'));}
    function onMessage(event) {
      const response = JSON.parse(event.data);
      if (response.id !== id) return;
      if (response.error || response.result?.exceptionDetails) {
        finish(new Error('DevTools evaluation failed: ' + JSON.stringify(response.error ?? response.result.exceptionDetails)));
      } else {
        finish(null, response.result?.result?.value);
      }
    }
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose, {once:true});
    socket.send(JSON.stringify({id, method:'Runtime.evaluate', params:{expression, returnByValue:true}}));
  });
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
  let chrome, socket;
  let stderr = '';
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = 'http://127.0.0.1:' + address.port + '/tests/browser-e2e.html';
    chrome = spawn(findChrome(), [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', '--user-data-dir=' + profile, url
    ], {stdio:['ignore','ignore','pipe']});
    chrome.stderr.setEncoding('utf8');
    chrome.stderr.on('data', chunk => {stderr = (stderr + chunk).slice(-2000);});
    socket = await connectToChrome(profile, chrome);
    // --dump-dom/--virtual-time-budget can snapshot the page while the test
    // still says RUNNING. Poll the live page instead, using real elapsed time.
    const result = await waitForBrowserResult(() => evaluate(socket,
      'document.querySelector("#result")?.textContent'));
    assert.match(result, /^PASS:/, 'Browser assertion failed: ' + result);
    assert.ok(requests.length >= 4, 'Expected local HTML/JS/CSS requests');
    assert.ok(requests.every(request => request.method === 'GET'),
      'Unexpected request to local server: ' + JSON.stringify(requests));
  } catch (error) {
    error.message += '\nChrome stderr (tail): ' + stderr;
    throw error;
  } finally {
    if (socket) socket.close();
    // Wait for Chrome to actually exit before deleting its profile. Otherwise
    // Chrome's child processes can recreate files during recursive removal.
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      await new Promise(resolveExit => {
        chrome.once('close', resolveExit);
        chrome.kill('SIGKILL');
      });
    }
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(profile, {recursive:true, force:true, maxRetries:5, retryDelay:100});
  }
});
