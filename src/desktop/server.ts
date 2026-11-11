/**
 * A desktop control MCP server for agents whose editor MCP cannot reach a control (N.A.M.E.C 1111-6): real mouse and keyboard through nut.js,
 * a screenshot of the whole desktop, Windows' own OCR of it, and bringing a window forward. Run it in the desktop session the input is for.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { mouse, keyboard, screen, Point, Button, Key, FileType } from '@nut-tree-fork/nut-js'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const Here = path.dirname(fileURLToPath(import.meta.url))
const Helper = path.join(Here, '..', '..', 'src', 'desktop', 'helper.ps1')
mouse.config.autoDelayMs = 40
mouse.config.mouseSpeed = 4000
keyboard.config.autoDelayMs = 20

function ps(action: string, ...args: string[]): string {
    return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', Helper, action, ...args], { encoding: 'utf8', windowsHide: true }).trim()
}
const Keys: Record<string, Key> = { enter: Key.Enter, tab: Key.Tab, escape: Key.Escape, esc: Key.Escape, backspace: Key.Backspace, delete: Key.Delete,
    up: Key.Up, down: Key.Down, left: Key.Left, right: Key.Right, ctrl: Key.LeftControl, control: Key.LeftControl, shift: Key.LeftShift, alt: Key.LeftAlt,
    a: Key.A, c: Key.C, v: Key.V, f: Key.F, home: Key.Home, end: Key.End, pageup: Key.PageUp, pagedown: Key.PageDown }
function keyOf(name: string): Key {
    const k = Keys[name.toLowerCase()]
    if (k === undefined) throw new Error(`no key named ${name}`)
    return k
}
// Tools take physical desktop pixels, as the screenshot and the OCR give them. nut.js works in this process's own pixels, which Windows scales for a process
// that is not DPI aware (the desktop is at 140 %): every point is divided by the primary screen's physical width over nut's.
let Scale = 0
async function scale(): Promise<number> {
    if (!Scale) { const [W] = ps('size').split(' ').map(Number); Scale = W / await screen.width() }
    return Scale
}
async function at(x: number, y: number): Promise<Point> { const k = await scale(); return new Point(Math.round(x / k), Math.round(y / k)) }
const num = { type: 'number' } as const, str = { type: 'string' } as const
const Tools = [
    { name: 'screenshot', description: 'Capture the whole desktop (every display) to a PNG; returns its path and the desktop size in pixels.', inputSchema: { type: 'object', properties: { path: str }, required: ['path'] } },
    { name: 'ocr', description: "Windows' own OCR of a PNG: one line a text line, 'x,y,right,bottom text', in the image's pixels.", inputSchema: { type: 'object', properties: { path: str }, required: ['path'] } },
    { name: 'move', description: 'Move the pointer to a desktop pixel.', inputSchema: { type: 'object', properties: { x: num, y: num }, required: ['x', 'y'] } },
    { name: 'click', description: 'Move the pointer to a desktop pixel and click (left unless button says right).', inputSchema: { type: 'object', properties: { x: num, y: num, button: str }, required: ['x', 'y'] } },
    { name: 'scroll', description: 'Scroll at a desktop pixel: amount > 0 down, < 0 up, in wheel notches.', inputSchema: { type: 'object', properties: { x: num, y: num, amount: num }, required: ['x', 'y', 'amount'] } },
    { name: 'type', description: 'Type text as key presses.', inputSchema: { type: 'object', properties: { text: str }, required: ['text'] } },
    { name: 'key', description: "Press a key, with modifiers held ('ctrl', 'shift', 'alt').", inputSchema: { type: 'object', properties: { key: str, modifiers: { type: 'array', items: str } }, required: ['key'] } },
    { name: 'pointer', description: 'Where the pointer is, in physical pixels, and the scale between physical pixels and nut.js pixels.', inputSchema: { type: 'object', properties: {} } },
    { name: 'maximize_window', description: "Maximize a process's main window.", inputSchema: { type: 'object', properties: { process: str }, required: ['process'] } },
    { name: 'focus_window', description: "Bring a process's main window forward (an Alt tap first, as Windows asks of a process that did not get the last input). Returns its title and rectangle.", inputSchema: { type: 'object', properties: { process: str }, required: ['process'] } },
]
async function call(name: string, a: any): Promise<string> {
    switch (name) {
        case 'screenshot': return ps('screenshot', a.path)
        case 'ocr': return ps('ocr', a.path)
        case 'move': await mouse.setPosition(await at(a.x, a.y)); return `pointer at ${a.x},${a.y}`
        case 'pointer': { const k = await scale(); const p = await mouse.getPosition(); return `pointer at ${Math.round(p.x * k)},${Math.round(p.y * k)} (nut ${p.x},${p.y}); scale ${k.toFixed(3)}` }
        case 'click': await mouse.setPosition(await at(a.x, a.y)); await mouse.click(a.button === 'right' ? Button.RIGHT : Button.LEFT); return `clicked ${a.x},${a.y}`
        case 'scroll': await mouse.setPosition(await at(a.x, a.y)); if (a.amount > 0) await mouse.scrollDown(a.amount); else await mouse.scrollUp(-a.amount); return `scrolled ${a.amount} at ${a.x},${a.y}`
        case 'type': await keyboard.type(a.text); return `typed ${a.text.length} characters`
        case 'key': { const mods = (a.modifiers ?? []).map(keyOf); const k = keyOf(a.key); await keyboard.pressKey(...mods, k); await keyboard.releaseKey(...mods, k); return `pressed ${[...(a.modifiers ?? []), a.key].join('+')}` }
        case 'focus_window': return ps('focus', a.process)
        case 'maximize_window': return ps('maximize', a.process)
    }
    throw new Error(`no tool ${name}`)
}
const server = new Server({ name: 'namec-desktop', version: '1.0.0' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: Tools }))
server.setRequestHandler(CallToolRequestSchema, async (r) => {
    try { return { content: [{ type: 'text', text: await call(r.params.name, r.params.arguments ?? {}) }] } }
    catch (e: any) { return { isError: true, content: [{ type: 'text', text: String(e?.message ?? e) }] } }
})
await server.connect(new StdioServerTransport())
