import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keyName, pressChord, watchedKeys, ChordKeyboard } from '../services/input-automation/keys.js'
import { loadStopPattern, stopHit } from '../session/stop-words.js'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('key names map to nut.js Key members', () => {
    assert.deepEqual(['ctrl', 'Enter', 'f5', 'a', '7', 'pagedown'].map(keyName), ['LeftControl', 'Enter', 'F5', 'A', 'Num7', 'PageDown'])
    assert.throws(() => keyName('hyper'), /no key named 'hyper'/)
})

test('the stop pattern file holds one line, matched without case', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'stop-'))
    const file = path.join(dir, 'stop-pattern.txt')
    writeFileSync(file, '# a comment\n\\bBuy\\b|Password\n')
    const p = loadStopPattern(file)
    const line = (text: string) => ({ x: 0, y: 0, right: 1, bottom: 1, text })
    assert.equal(stopHit([line('Add to Project'), line('BUY NOW')], p)?.text, 'BUY NOW')
    assert.equal(stopHit([line('Buyer reviews')], p), null)
    writeFileSync(file, 'a\nb\n')
    assert.throws(() => loadStopPattern(file), /must hold one pattern line, holds 2/)
})

// nut.js's libnut provider as installed (@nut-tree-fork/libnut libnut-keyboard.class.js): the list reversed, its first the key, the rest modifiers;
// keyToggle then sends the modifiers and the key down, or the key and the modifiers up.
function libnutKeyboard(events: string[]): ChordKeyboard {
    const toggle = (keys: number[], event: 'down' | 'up') => {
        const [key, ...modifiers] = [...keys].reverse().map(k => Names[k])
        const order = event === 'down' ? [...modifiers, key] : [key, ...modifiers]
        events.push(...order.map(k => `${k} ${event}`))
        return Promise.resolve()
    }
    return { pressKey: (...k) => toggle(k, 'down'), releaseKey: (...k) => toggle(k, 'up') }
}
const Names: Record<number, string> = { 104: 'control', 87: 'shift', 60: 'p', 73: 's' }
const held = (events: string[]) => Object.entries(events.reduce((h: Record<string, boolean>, e) => { const [k, ev] = e.split(' '); h[k] = ev === 'down'; return h }, {}))
    .filter(([, down]) => down).map(([k]) => k)

test('a chord releases every key it pressed (1115-2: ctrl+p left P held)', async () => {
    const events: string[] = []
    await pressChord([104, 60], libnutKeyboard(events))
    assert.deepEqual(events, ['control down', 'p down', 'p up', 'control up'])
    events.length = 0
    await pressChord([104, 87, 73], libnutKeyboard(events))
    assert.deepEqual(held(events), [])
})

test('the keys watched around a key action: both Win keys, the left modifiers, then the chord\'s own by their Windows names', () => {
    assert.deepEqual(watchedKeys('ctrl+p'), ['LWin', 'RWin', 'LControlKey', 'LShiftKey', 'LMenu', 'P'])
    assert.deepEqual(watchedKeys('win+7'), ['LWin', 'RWin', 'LControlKey', 'LShiftKey', 'LMenu', 'D7'])
    assert.deepEqual(watchedKeys(), ['LWin', 'RWin', 'LControlKey', 'LShiftKey', 'LMenu'])
})
