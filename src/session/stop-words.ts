import { readFileSync } from 'node:fs'
import type { TextLine } from '../services/windows/helper.js'

// The pattern is the N.A.M.E.C checkout's Tools/Desktop/stop-pattern.txt, the one fab-add-packs.ps1's StopCheck reads: one regular expression,
// matched without case, '#' lines skipped. Read again at each session's start, so an edit there needs no restart here.
export function loadStopPattern(file: string): RegExp {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    if (lines.length !== 1) throw new Error(`${file} must hold one pattern line, holds ${lines.length}`)
    return new RegExp(lines[0], 'i')
}

/** The first line of text that matches, or null. */
export function stopHit(lines: TextLine[], pattern: RegExp): TextLine | null {
    return lines.find(l => pattern.test(l.text)) ?? null
}
