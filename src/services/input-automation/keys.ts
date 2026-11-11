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
