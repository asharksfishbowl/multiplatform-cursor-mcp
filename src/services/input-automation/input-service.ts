// Real mouse and keyboard through nut.js. Points are physical desktop pixels, as screenshots and OCR give them; nut.js works in this process's
// scaled pixels, so each point is divided by the primary display's physical width over nut.js's (measured on refpc at 140 %, 2026-11-11).
import { keyboard, mouse, screen, Point, Button, Key } from '@nut-tree-fork/nut-js'
import { helper } from '../windows/helper.js'
import { keyName } from './keys.js'

mouse.config.autoDelayMs = 40
mouse.config.mouseSpeed = 4000
keyboard.config.autoDelayMs = 20

let Scale = 0
async function scale(): Promise<number> {
    if (!Scale) { const [w] = (await helper('size')).split(' ').map(Number); Scale = w / await screen.width() }
    return Scale
}
async function at(x: number, y: number): Promise<Point> {
    const k = await scale()
    return new Point(Math.round(x / k), Math.round(y / k))
}

export async function move(x: number, y: number): Promise<void> {
    await mouse.setPosition(await at(x, y))
}

export async function click(x: number, y: number, button: 'left' | 'right' = 'left', double = false): Promise<void> {
    await move(x, y)
    const b = button === 'right' ? Button.RIGHT : Button.LEFT
    if (double) await mouse.doubleClick(b); else await mouse.click(b)
}

/** amount > 0 scrolls down, < 0 up, in wheel notches. */
export async function scroll(x: number, y: number, amount: number): Promise<void> {
    await move(x, y)
    if (amount > 0) await mouse.scrollDown(amount); else await mouse.scrollUp(-amount)
}

export async function typeText(text: string): Promise<void> {
    await keyboard.type(text)
}

/** One chord ('ctrl+shift+s', 'enter'): every key held in order, then released in reverse. */
export async function pressKeys(chord: string): Promise<void> {
    const keys: Key[] = chord.split('+').map(k => Key[keyName(k) as keyof typeof Key])
    await keyboard.pressKey(...keys)
    await keyboard.releaseKey(...keys.reverse())
}

export async function pointer(): Promise<{ x: number, y: number, scale: number }> {
    const k = await scale()
    const p = await mouse.getPosition()
    return { x: Math.round(p.x * k), y: Math.round(p.y * k), scale: k }
}
