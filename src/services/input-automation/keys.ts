// Key names a caller writes ('ctrl', 'enter', 'f5', 'a', '7') to nut.js's Key enum member names. Kept free of nut.js, which loads a native module.

const Named: Record<string, string> = {
    ctrl: 'LeftControl', control: 'LeftControl', shift: 'LeftShift', alt: 'LeftAlt', win: 'LeftSuper', super: 'LeftSuper',
    enter: 'Enter', return: 'Return', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', insert: 'Insert',
    space: 'Space', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
    minus: 'Minus', equal: 'Equal', comma: 'Comma', period: 'Period', slash: 'Slash', backslash: 'Backslash', semicolon: 'Semicolon', quote: 'Quote',
    leftbracket: 'LeftBracket', rightbracket: 'RightBracket', grave: 'Grave',
}

export function keyName(name: string): string {
    const n = name.trim().toLowerCase()
    if (Named[n]) return Named[n]
    if (/^[a-z]$/.test(n)) return n.toUpperCase()
    if (/^[0-9]$/.test(n)) return `Num${n}`
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(n)) return n.toUpperCase()
    throw new Error(`no key named '${name}'`)
}

/** nut.js's keyboard as pressChord uses it. Both calls take keys in natural order, modifiers first and the key last: its provider (libnut) reverses the
 *  list itself, then takes the first as the key and the rest as its modifiers. */
export interface ChordKeyboard {
    pressKey(...keys: number[]): Promise<unknown>
    releaseKey(...keys: number[]): Promise<unknown>
}

/** One chord held, then released, both in natural order. A list reversed here before the release reached libnut as the first modifier alone, released
 *  without the key: every chord left its last key held (1115-2: ctrl+p left P down). */
export async function pressChord(keys: number[], kb: ChordKeyboard): Promise<void> {
    await kb.pressKey(...keys)
    await kb.releaseKey(...keys)
}

// nut.js Key member names to Windows' (System.Windows.Forms.Keys), for the held-key read. Letters, F-keys and the rest share their name.
const WindowsNamed: Record<string, string> = {
    LeftControl: 'LControlKey', LeftShift: 'LShiftKey', LeftAlt: 'LMenu', LeftSuper: 'LWin', Return: 'Enter', Backspace: 'Back',
    Minus: 'OemMinus', Equal: 'Oemplus', Comma: 'Oemcomma', Period: 'OemPeriod', Slash: 'OemQuestion', Backslash: 'OemPipe', Semicolon: 'OemSemicolon',
    Quote: 'OemQuotes', LeftBracket: 'OemOpenBrackets', RightBracket: 'OemCloseBrackets', Grave: 'Oemtilde',
}

export function windowsKeyName(nutName: string): string {
    const digit = /^Num([0-9])$/.exec(nutName)
    return WindowsNamed[nutName] ?? (digit ? `D${digit[1]}` : nutName)
}

/** The keys whose held state press_keys and type_text log before and after (1115-2): both Win keys and the left modifiers, then the chord's own. */
export function watchedKeys(chord?: string): string[] {
    const own = chord ? chord.split('+').map(k => windowsKeyName(keyName(k))) : []
    return [...new Set(['LWin', 'RWin', 'LControlKey', 'LShiftKey', 'LMenu', ...own])]
}
