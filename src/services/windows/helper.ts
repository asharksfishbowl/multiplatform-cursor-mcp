/** Runs scripts/windows-helper.ps1 once a call: screenshot, OCR, windows and the password check, where Windows' own APIs are one line each. */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const Helper = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'windows-helper.ps1')

export function helper(action: string, ...args: (string | number)[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', Helper, action, ...args.map(String)],
            { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
            (error, stdout, stderr) => error ? reject(new Error(`windows-helper ${action}: ${(stderr || error.message).trim()}`)) : resolve(stdout.trim()))
    })
}

export interface TextLine { x: number, y: number, right: number, bottom: number, text: string }

// The helper's OCR lines, 'x,y,right,bottom text'.
export function parseTextLines(out: string): TextLine[] {
    return out.split(/\r?\n/).filter(Boolean).map(l => {
        const m = /^(-?\d+),(-?\d+),(-?\d+),(-?\d+) (.*)$/.exec(l)
        if (!m) throw new Error(`not an OCR line: ${l}`)
        return { x: +m[1], y: +m[2], right: +m[3], bottom: +m[4], text: m[5] }
    })
}
