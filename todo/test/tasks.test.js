'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server.js');

let dir, dataFile, server, base;

async function start() {
  server = createServer(dataFile);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
}

function stop() {
  return new Promise((resolve) => server.close(resolve));
}

function request(method, url, body) {
  return fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// fetch normalises "..", so send the raw path with node:http.
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    http.get(base + '/', { path: rawPath }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
}

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-test-'));
  dataFile = path.join(dir, 'tasks.json');
  await start();
});

after(async () => {
  await stop();
  await fs.rm(dir, { recursive: true, force: true });
});

test('GET /api/tasks returns an empty list when no file exists', async () => {
  const res = await request('GET', '/api/tasks');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('POST creates a task with trimmed title and defaults', async () => {
  const res = await request('POST', '/api/tasks', { title: '  Buy milk  ' });
  assert.equal(res.status, 201);
  const task = await res.json();
  assert.equal(task.title, 'Buy milk');
  assert.equal(task.priority, 'medium');
  assert.equal(task.due, null);
  assert.equal(task.done, false);
  assert.ok(task.id);
});

test('POST rejects invalid input with 400', async () => {
  const bad = [
    { title: '' },
    { title: '   ' },
    {},
    { title: 'x', due: '2026-02-30' },
    { title: 'x', due: 'tomorrow' },
    { title: 'x', priority: 'urgent' },
  ];
  for (const body of bad) {
    const res = await request('POST', '/api/tasks', body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await request('POST', '/api/tasks', '{not json')).status, 400);
});

test('PATCH edits title, toggles done; DELETE removes; changes persist across restart', async () => {
  const created = await (await request('POST', '/api/tasks', {
    title: 'Write report', due: '2026-12-01', priority: 'high',
  })).json();

  let res = await request('PATCH', `/api/tasks/${created.id}`, { title: ' Write final report ' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).title, 'Write final report');

  res = await request('PATCH', `/api/tasks/${created.id}`, { done: true });
  assert.equal((await res.json()).done, true);

  assert.equal((await request('PATCH', `/api/tasks/${created.id}`, { title: '' })).status, 400);
  assert.equal((await request('PATCH', `/api/tasks/${created.id}`, { done: 'yes' })).status, 400);
  assert.equal((await request('PATCH', '/api/tasks/missing', { done: true })).status, 404);

  await stop();
  await start();

  const tasks = await (await request('GET', '/api/tasks')).json();
  const saved = tasks.find((t) => t.id === created.id);
  assert.equal(saved.title, 'Write final report');
  assert.equal(saved.done, true);

  assert.equal((await request('DELETE', `/api/tasks/${created.id}`)).status, 204);
  assert.equal((await request('DELETE', `/api/tasks/${created.id}`)).status, 404);
  const onDisk = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  assert.ok(!onDisk.some((t) => t.id === created.id));
});

test('serves static files and blocks path traversal', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(await rawGet('/../server.js'), 403);
  assert.equal(await rawGet('/%2e%2e/server.js'), 403);
  assert.equal(await rawGet('/..%2fdata/tasks.json'), 403);
  assert.equal(await rawGet('/nope.html'), 404);
});
