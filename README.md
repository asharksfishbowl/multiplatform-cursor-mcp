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
| `begin_session` / `end_session` | | Open and close the one session acting needs |
| `focus_window`, `click`, `move`, `scroll`, `type_text`, `press_keys` | yes | Act, in desktop pixels |

## Rails, in the server

- An acting tool outside the open session, or naming another session's id, is refused. One session at a time, at most 240 minutes; it ends itself when its minutes run out.
- `begin_session <agent> <what> <minutes>` appends a `// DESKTOP:` block to the N.A.M.E.C checkout's `.dex/wildcard-queue.groovy` and holds `Global\NamecBuild`
  (`Tools/Build/namec-build-lock.ps1 -Hold`); `end_session` releases it and closes the block.
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

The config: `{ "host": "127.0.0.1", "port": 8010, "tokenFile": "…", "checkout": "C:\\…\\N.A.M.E.C", "engineRoot": "C:\\Program Files\\Epic Games\\UE_5.8", "stateFile": "…" }`.
Run it in the desktop session it drives (a scheduled task at sign-in, `/IT`): input and screenshots from another session, as ssh's, reach nothing.
N.A.M.E.C's `Tools/Desktop/register-desktop-mcp.ps1` installs, configures and starts it that way.

## Licence

MIT.
