'use strict';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

const form = document.getElementById('add-form');
const message = document.getElementById('message');
let tasks = [];

function todayString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Rule-based ordering: priority first, then earliest due date, tasks without a date last.
function compareTasks(a, b) {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : 1;
}

function groupOf(task, today) {
  if (task.done) return 'done';
  if (!task.due) return 'nodate';
  if (task.due < today) return 'overdue';
  if (task.due === today) return 'today';
  return 'upcoming';
}

function renderTask(task, group) {
  const li = document.createElement('li');
  li.dataset.id = task.id;
  li.className = `priority-${task.priority}` + (group === 'overdue' ? ' overdue' : '');

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'toggle';
  toggle.checked = task.done;
  toggle.setAttribute('aria-label', `Done: ${task.title}`);

  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'title';
  title.value = task.title;
  title.required = true;
  title.setAttribute('aria-label', 'Task title');

  const priority = document.createElement('span');
  priority.className = 'priority';
  priority.textContent = task.priority;

  li.append(toggle, title, priority);

  if (task.due) {
    const time = document.createElement('time');
    time.dateTime = task.due;
    time.textContent = group === 'overdue' ? `Overdue: ${task.due}` : task.due;
    li.append(time);
  }

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'delete';
  del.textContent = 'Delete';
  del.setAttribute('aria-label', `Delete: ${task.title}`);
  li.append(del);

  return li;
}

function render() {
  const today = todayString();
  const lists = {};
  for (const section of document.querySelectorAll('section[data-group]')) {
    lists[section.dataset.group] = section.querySelector('ul');
    lists[section.dataset.group].replaceChildren();
  }
  for (const task of [...tasks].sort(compareTasks)) {
    const group = groupOf(task, today);
    lists[group].append(renderTask(task, group));
  }
  for (const ul of Object.values(lists)) {
    ul.closest('section').hidden = ul.children.length === 0;
  }
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

async function run(action) {
  message.textContent = '';
  try {
    await action();
  } catch (err) {
    message.textContent = err.message;
  }
}

function focusTask(id, selector) {
  const el = document.querySelector(`li[data-id="${id}"] ${selector}`);
  if (el) el.focus();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  run(async () => {
    const data = new FormData(form);
    const task = await api('POST', '/api/tasks', {
      title: data.get('title'),
      due: data.get('due') || null,
      priority: data.get('priority'),
    });
    tasks.push(task);
    form.reset();
    render();
    form.elements.title.focus();
  });
});

document.querySelector('main').addEventListener('change', (event) => {
  const li = event.target.closest('li[data-id]');
  if (!li) return;
  const task = tasks.find((t) => t.id === li.dataset.id);

  if (event.target.classList.contains('toggle')) {
    run(async () => {
      Object.assign(task, await api('PATCH', `/api/tasks/${task.id}`, { done: event.target.checked }));
      render();
      focusTask(task.id, '.toggle');
    });
  } else if (event.target.classList.contains('title')) {
    const input = event.target;
    run(async () => {
      if (input.value.trim() === '') {
        input.value = task.title;
        throw new Error('Title cannot be empty');
      }
      Object.assign(task, await api('PATCH', `/api/tasks/${task.id}`, { title: input.value }));
      input.value = task.title;
      li.querySelector('.toggle').setAttribute('aria-label', `Done: ${task.title}`);
      li.querySelector('.delete').setAttribute('aria-label', `Delete: ${task.title}`);
    });
  }
});

document.querySelector('main').addEventListener('click', (event) => {
  if (!event.target.classList.contains('delete')) return;
  const id = event.target.closest('li[data-id]').dataset.id;
  run(async () => {
    await api('DELETE', `/api/tasks/${id}`);
    tasks = tasks.filter((t) => t.id !== id);
    render();
    form.elements.title.focus();
  });
});

run(async () => {
  tasks = await api('GET', '/api/tasks');
  render();
});
