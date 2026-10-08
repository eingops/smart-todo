'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_DATA_FILE = path.join(__dirname, 'data', 'tasks.json');
const PRIORITIES = ['low', 'medium', 'high'];
const MAX_BODY = 1e6;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Validates the fields present in `input`. With `partial` false, title is required.
function validateTask(input, partial) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  const out = {};
  if ('title' in input || !partial) {
    if (typeof input.title !== 'string' || input.title.trim() === '') {
      throw new HttpError(400, 'Title is required');
    }
    out.title = input.title.trim();
  }
  if ('due' in input) {
    if (input.due === null || input.due === '') out.due = null;
    else if (isValidDate(input.due)) out.due = input.due;
    else throw new HttpError(400, 'Due date must be YYYY-MM-DD');
  }
  if ('priority' in input) {
    if (!PRIORITIES.includes(input.priority)) {
      throw new HttpError(400, 'Priority must be low, medium or high');
    }
    out.priority = input.priority;
  }
  if ('done' in input) {
    if (typeof input.done !== 'boolean') throw new HttpError(400, 'Done must be true or false');
    out.done = input.done;
  }
  return out;
}

function createStore(file) {
  let queue = Promise.resolve();

  async function read() {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async function write(tasks) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(tasks, null, 2) + '\n');
    await fs.rename(tmp, file);
  }

  // Runs read-modify-write steps one at a time so concurrent requests don't lose updates.
  function update(fn) {
    const result = queue.then(async () => {
      const tasks = await read();
      const value = fn(tasks);
      await write(tasks);
      return value;
    });
    queue = result.catch(() => {});
    return result;
  }

  return { read, update };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new HttpError(413, 'Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data === undefined ? undefined : JSON.stringify(data));
}

async function handleApi(req, res, store, pathname) {
  if (pathname === '/api/tasks') {
    if (req.method === 'GET') return sendJson(res, 200, await store.read());
    if (req.method === 'POST') {
      const fields = validateTask(await readJson(req), false);
      const task = {
        id: crypto.randomUUID(),
        title: fields.title,
        due: fields.due ?? null,
        priority: fields.priority ?? 'medium',
        done: false,
        createdAt: new Date().toISOString(),
      };
      await store.update((tasks) => tasks.push(task));
      return sendJson(res, 201, task);
    }
    res.setHeader('Allow', 'GET, POST');
    throw new HttpError(405, 'Method not allowed');
  }

  const match = pathname.match(/^\/api\/tasks\/([\w-]+)$/);
  if (!match) throw new HttpError(404, 'Not found');
  const id = match[1];

  if (req.method === 'PATCH') {
    const fields = validateTask(await readJson(req), true);
    const task = await store.update((tasks) => {
      const found = tasks.find((t) => t.id === id);
      if (!found) throw new HttpError(404, 'Task not found');
      return Object.assign(found, fields);
    });
    return sendJson(res, 200, task);
  }
  if (req.method === 'DELETE') {
    await store.update((tasks) => {
      const index = tasks.findIndex((t) => t.id === id);
      if (index === -1) throw new HttpError(404, 'Task not found');
      tasks.splice(index, 1);
    });
    return sendJson(res, 204);
  }
  res.setHeader('Allow', 'PATCH, DELETE');
  throw new HttpError(405, 'Method not allowed');
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    throw new HttpError(405, 'Method not allowed');
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Bad path');
  }
  if (decoded.includes('\0')) throw new HttpError(400, 'Bad path');
  const filePath = path.join(PUBLIC_DIR, decoded === '/' ? 'index.html' : decoded);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Forbidden');

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch {
    throw new HttpError(404, 'Not found');
  }
  const type = CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(req.method === 'HEAD' ? undefined : content);
}

function createServer(dataFile = DEFAULT_DATA_FILE) {
  const store = createStore(dataFile);
  return http.createServer(async (req, res) => {
    // Use only the path from the raw URL so "/../x" is not normalised away before our check.
    const pathname = req.url.split('?')[0];
    try {
      if (pathname.startsWith('/api/')) await handleApi(req, res, store, pathname);
      else await serveStatic(req, res, pathname);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Server error' : err.message });
    }
  });
}

module.exports = { createServer };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`Listening on http://localhost:${port}`));
}
