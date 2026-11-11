/** Screenshots and the text on them, in physical desktop pixels. */
import { readFile } from 'node:fs/promises'
import { helper, parseTextLines, TextLine } from './helper.js'

export interface Shot {
    path: string
    /** The shot's top-left corner on the desktop and its size, in physical pixels. */
    x: number, y: number, width: number, height: number
    /** The view copy (<path>.view.png) is this many times smaller than the shot. */
    viewScale: number
}

/** The whole desktop, or one window (a process name or text in its title), saved at path; a copy at most maxWidth wide beside it. */
export async function screenshot(path: string, window?: string, maxWidth = 0): Promise<Shot> {
    const [x, y, width, height, viewScale] = (await helper('screenshot', path, window ?? '', maxWidth)).split(' ').map(Number)
    return { path, x, y, width, height, viewScale }
}

export async function viewImage(shot: Shot): Promise<string> {
    return (await readFile(`${shot.path}.view.png`)).toString('base64')
}

/** Windows.Media.Ocr over a shot: its lines with their boxes in desktop pixels. */
export async function readText(shot: Shot): Promise<TextLine[]> {
    return parseTextLines(await helper('ocr', shot.path, shot.x, shot.y))
}
