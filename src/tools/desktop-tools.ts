// The tools. Looking (screenshot, read_text, find_window, pointer) needs no session; acting (focus_window, click, move, scroll, type_text, press_keys)
// runs only inside the open session it names. Calls run one at a time: two agents' input interleaved on one desktop would land nowhere either meant.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { Config, paths } from '../config.js'
import { screenshot, readText, viewImage } from '../services/windows/screen.js'
import { findWindows, focusWindow, focusedIsPassword } from '../services/window-manager/windows-manager.js'
import * as input from '../services/input-automation/input-service.js'
import { DesktopSessions } from '../session/desktop-session.js'

type Content = { type: 'text', text: string } | { type: 'image', data: string, mimeType: string }
const text = (t: string): Content => ({ type: 'text', text: t })

let Queue: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(f: () => Promise<T>): Promise<T> {
    const run = Queue.then(f, f)
    Queue = run.catch(() => undefined)
    return run
}

export function registerTools(server: McpServer, c: Config, sessions: DesktopSessions): void {
    const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, f: (a: z.objectOutputType<S, z.ZodTypeAny>) => Promise<Content[]>) =>
        server.registerTool(name, { description, inputSchema: shape }, (async (a: any) => {
            try { return { content: await oneAtATime(() => f(a)) } }
            catch (e: any) { return { isError: true, content: [text(String(e?.message ?? e))] } }
        }) as any)

    let looks = 0
    // Where a look's picture goes: the open session's folder, else one folder a day for looks outside a session.
    async function lookPath(): Promise<string> {
        const s = sessions.current()
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
        if (s) {
            const name = `${String(s.actions).padStart(2, '0')}-look-${++looks}`
            await sessions.check(`${name}-check`)
            return path.join(s.folder, `${name}.png`)
        }
        const folder = path.join(paths(c).shots, `looks-${stamp.slice(0, 8)}`)
        await mkdir(folder, { recursive: true })
        return path.join(folder, `${stamp}.png`)
    }
    const session = z.string().describe('The id begin_session gave')
    const x = z.number().describe('Desktop x, physical pixels'), y = z.number().describe('Desktop y, physical pixels')

    tool('screenshot', 'A picture of the whole desktop, or of one window (a process name such as UnrealEditor, or text in its title). Saved whole; the picture returned is at most maxWidth wide (default 1600): multiply a point in it by the scale given for desktop pixels. Inside a session the screen is checked for stop words first.',
        { window: z.string().optional(), maxWidth: z.number().int().min(320).max(7680).optional() },
        async a => {
            const shot = await screenshot(await lookPath(), a.window, a.maxWidth ?? 1600)
            return [{ type: 'image', data: await viewImage(shot), mimeType: 'image/png' },
                text(`${shot.path}: ${shot.width}x${shot.height} at (${shot.x}, ${shot.y}) on the desktop; the picture is ${shot.viewScale.toFixed(4)} times smaller: desktop x = ${shot.x} + picture x * ${shot.viewScale.toFixed(4)}, desktop y = ${shot.y} + picture y * ${shot.viewScale.toFixed(4)}`)]
        })
    tool('read_text', "Windows' own OCR of the desktop or of one window: one line a text line, 'x,y,right,bottom text', in desktop pixels (click a line at its box's middle).",
        { window: z.string().optional() },
        async a => {
            const shot = await screenshot(await lookPath(), a.window)
            const lines = await readText(shot)
            return [text(lines.map(l => `${l.x},${l.y},${l.right},${l.bottom} ${l.text}`).join('\n') || '(no text)')]
        })
    tool('find_window', "Visible titled windows, all or those of a process (name without .exe) or with a title holding the text: 'process pid=… rect=l,t,r,b 'title''.",
        { which: z.string().optional() }, async a => [text(await findWindows(a.which) || '(no window)')])
    tool('pointer', 'Where the pointer is, in desktop pixels.', {}, async () => { const p = await input.pointer(); return [text(`pointer at ${p.x},${p.y}; nut.js scale ${p.scale.toFixed(3)}`)] })

    tool('begin_session', "Opens the desktop session every acting tool needs: one at a time, at most `minutes`. It writes a // DESKTOP: block in N.A.M.E.C's .dex/wildcard-queue.groovy and holds Global\\NamecBuild (it waits for the lock). Never for a password, token or login: the user signs in by hand. A screen showing a price, purchase, licence to accept, sign-in, password or code ends the session (STOP).",
        { agent: z.string().describe('Your agent name, e.g. builder4'), what: z.string().describe('What the session is for, one sentence'), minutes: z.number().int().min(1).max(240) },
        async a => { const s = await sessions.begin(a.agent, a.what, a.minutes); return [text(`session ${s.id} open for ${s.agent} until ${s.deadline}; pictures ${s.folder}`)] })
    tool('end_session', 'Ends the session: frees Global\\NamecBuild and closes its DESKTOP block.', { session }, async a => [text(await sessions.end(a.session))])

    const act = (a: { session: string }, name: string, detail: string, f: () => Promise<string>) => sessions.act(a.session, name, detail, f).then(r => [text(r)])
    tool('focus_window', 'Brings a window forward (a process name or text in its title); a maximized window stays maximized.', { session, which: z.string() },
        a => act(a, 'focus_window', a.which, () => focusWindow(a.which)))
    tool('click', 'Clicks at a desktop pixel.', { session, x, y, button: z.enum(['left', 'right']).optional(), double: z.boolean().optional() },
        a => act(a, 'click', `${a.x},${a.y} ${a.button ?? 'left'}${a.double ? ' double' : ''}`, async () => { await input.click(a.x, a.y, a.button, a.double); return `clicked ${a.x},${a.y}` }))
    tool('move', 'Moves the pointer to a desktop pixel (a hover).', { session, x, y },
        a => act(a, 'move', `${a.x},${a.y}`, async () => { await input.move(a.x, a.y); return `pointer at ${a.x},${a.y}` }))
    tool('scroll', 'Scrolls at a desktop pixel: amount > 0 down, < 0 up, in wheel notches.', { session, x, y, amount: z.number().int() },
        a => act(a, 'scroll', `${a.x},${a.y} ${a.amount}`, async () => { await input.scroll(a.x, a.y, a.amount); return `scrolled ${a.amount} at ${a.x},${a.y}` }))
    tool('type_text', 'Types text into the focused control. Refused into a password field.', { session, text: z.string() },
        a => act(a, 'type_text', `${a.text.length} characters`, async () => {
            const p = await focusedIsPassword()
            if (p.password) throw new Error(`type_text refused: the focused control is a password field (${p.detail})`)
            await input.typeText(a.text)
            return `typed ${a.text.length} characters`
        }))
    tool('press_keys', "Presses one chord: keys joined by '+', held in order and released in reverse ('enter', 'ctrl+s', 'alt+f4', 'shift+tab').", { session, keys: z.string() },
        a => act(a, 'press_keys', a.keys, async () => { await input.pressKeys(a.keys); return `pressed ${a.keys}` }))
}
