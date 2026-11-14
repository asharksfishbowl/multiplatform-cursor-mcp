# Desktop control MCP

An MCP server, over Streamable HTTP, that sees and drives one Windows desktop session: screenshots, Windows' own OCR, windows, mouse and keys.
It is for agents whose other tools cannot reach a control: a web panel inside an app, a launcher, a browser.

It began as a Cursor IDE bridge; those tools did not build (robotjs was never a dependency) and are gone. The input still goes through nut.js.

## Tools

| Tool | Needs a session | What it does |
|---|---|---|
| `screenshot` | no | The desktop or one window as a picture (at most `maxWidth` wide, default 1600) and saved whole; says how to turn a point in it into desktop pixels |
| `read_text` | no | OCR of the desktop or one window: `x,y,right,bottom text` a line, in desktop pixels |
| `find_window` | no | Visible titled windows, all or by process name or title text |
| `pointer` | no | Where the pointer is |
| `begin_session` / `session_status` / `end_session` | | Open (or queue), wait for, and close the one session acting needs |
| `focus_window`, `click`, `move`, `scroll`, `type_text`, `press_keys` | yes | Act, in desktop pixels |

## Rails, in the server

- An acting tool outside the open session, or naming another session's id, is refused. One session at a time, at most 240 minutes from when it holds the lock; it ends itself when its minutes run out.
- `begin_session <agent> <what> <minutes>` appends a `// DESKTOP:` block to the config's `queue` file (N.A.M.E.C's `.dex/wildcard-queue.groovy`) and holds `Global\NamecBuild`
  (`Tools/Build/namec-build-lock.ps1 -Hold`); `end_session` releases it and closes the block.
- On a busy lock (1114-18) `begin_session` answers `queued` at once and its hold takes its turn in the lock's arrival order, outside the one-call-at-a-time queue the other tools share.
  `session_status <id>` waits up to 45 s (under the 60 s an MCP SDK client gives a tool call) for the hold, and answering an open session claims it; a session that held but is not claimed
  within 90 s gives the lock back. `end_session` on a queued session calls its hold off: its waiting holder is stopped, which the lock's queue skips; no other hold changes.
- Before and after each action the whole screen is pictured and read; a line matching the checkout's `Tools/Desktop/stop-pattern.txt` (a price, buy, purchase, checkout, payment,
  licence to accept, sign-in, password, code) ends the session: `STOP: <window>: it shows "<text>" at (x, y)`. Nothing is pressed on such a screen.
- `type_text` is refused into a field UI Automation reports as a password.
- Each action is a line in the session folder's `actions.log`, naming the agent; the pictures are beside it.
- Every request needs `Authorization: Bearer <token>`, the token in the config's `tokenFile`. Bind it to `127.0.0.1`: nothing off the machine reaches it.

## Run

```
npm ci
npm run build
npm test
node build/index.js --config <file.json>
```

The config: `{ "host": "127.0.0.1", "port": 8010, "tokenFile": "…", "checkout": "C:\\…\\N.A.M.E.C", "queue": "…\\wildcard-queue.groovy", "shots": "…", "engineRoot": "C:\\Program Files\\Epic Games\\UE_5.8", "stateFile": "…" }`.
Run it in the desktop session it drives (a scheduled task at sign-in, `/IT`): input and screenshots from another session, as ssh's, reach nothing.
N.A.M.E.C's `Tools/Desktop/register-desktop-mcp.ps1` installs, configures and starts it that way.

## Licence

MIT.
