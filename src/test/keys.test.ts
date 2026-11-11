import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keyName } from '../services/input-automation/keys.js'
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
