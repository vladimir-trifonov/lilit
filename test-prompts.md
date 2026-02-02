# Test Prompts for Crew

## Prompt 1: Simple Counter App (Quick — tests full pipeline)

```
Build a simple counter app with Next.js. Features:
- A page that shows a counter starting at 0
- An "Increment" button that adds 1
- A "Decrement" button that subtracts 1 (minimum 0)
- A "Reset" button that sets it back to 0
- Show the count in large text, centered on the page
- Use Tailwind CSS for styling
```

## Prompt 2: To-Do App (Medium — tests more agents)

```
Build a to-do list app with Next.js and local storage. Features:
- Add new tasks with a text input and "Add" button
- Each task shows a checkbox, text, and delete button
- Clicking the checkbox toggles done/not done (strikethrough when done)
- Tasks persist in localStorage
- Show count of remaining tasks at the bottom
- Clean minimal UI with Tailwind CSS
```

## Prompt 3: Note-taking API (Backend focus — tests Architect + DevOps)

```
Build a REST API for notes with Next.js API routes and SQLite. Features:
- POST /api/notes — create a note (title, content)
- GET /api/notes — list all notes (sorted by date)
- GET /api/notes/:id — get single note
- PUT /api/notes/:id — update a note
- DELETE /api/notes/:id — delete a note
- Use better-sqlite3 for storage
- Add proper error handling and validation
- Include a simple HTML page that uses the API
```

---

## Future: Bug Injector Role

A special "gremlin" agent that intentionally introduces subtle bugs
to test if QA catches them and Dev:fix resolves them.

Bug types to inject:
- Off-by-one errors
- Missing edge case handling
- Wrong comparison operators (< vs <=)
- Hardcoded values that should be configurable
- Missing null checks
- Race conditions in async code
