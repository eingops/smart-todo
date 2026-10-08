# Smart To-Do

A small to-do list web app built only on Node.js built-ins. It has no npm dependencies and no build step.

The "smart" parts are fixed rules, not AI:

- **Sorting:** high, medium, then low priority; then earliest due date. Tasks with no date come last.
- **Groups:** Overdue, Today, Upcoming, No date and Done.
- **Highlighting:** overdue tasks are shown in red.

## Requirements

Node.js 20 or later.

## Run

```sh
cd todo
node server.js
```

Then open http://localhost:3000. Set `PORT` to use a different port, for example `PORT=8080 node server.js`.

Tasks are saved in `todo/data/tasks.json`.

## Test

```sh
cd todo
node --test
```

## Using the app

- **Add a task:** enter a title (required), plus an optional due date and a priority (low, medium or high; medium by default).
- **Rename a task:** click its title and type. The change saves when you press Enter or leave the field. An empty title is put back the way it was.
- **Mark a task done:** tick its checkbox. It moves to the Done group.
- **Delete a task:** press its Delete button.

Everything works from the keyboard.

## API

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/api/tasks` | – | `200` with a list of tasks |
| POST | `/api/tasks` | `{ "title", "due"?, "priority"? }` | `201` with the new task |
| PATCH | `/api/tasks/:id` | any of `{ "title", "due", "priority", "done" }` | `200` with the updated task |
| DELETE | `/api/tasks/:id` | – | `204` |

- **Title:** must not be empty after trimming spaces.
- **Due:** a `YYYY-MM-DD` date, or `null` for no date.
- **Priority:** `low`, `medium` or `high`.
- **Done:** `true` or `false`.

Errors come back as `{ "error": "..." }`:

- `400` for invalid input
- `404` for an unknown task
- `405` for an unsupported method

A task looks like this:

```json
{
  "id": "02db31a2-581f-4162-b5ab-a6d5ce41d8fb",
  "title": "Pay rent",
  "due": "2026-10-01",
  "priority": "high",
  "done": false,
  "createdAt": "2026-10-08T17:36:52.012Z"
}
```

## Project layout

```
todo/
  server.js          HTTP server, API, validation, static files
  data/tasks.json    task storage
  public/            index.html, app.js, style.css
  test/tasks.test.js node:test tests
```
