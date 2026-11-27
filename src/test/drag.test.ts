import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drag, dragPath, DragMouse } from '../services/input-automation/drag.js'

function fakeMouse(failAtMove = -1): DragMouse & { log: string[] } {
    const log: string[] = []
    let moves = 0
    return {
        log,
        moveTo: async (x, y) => { if (moves++ === failAtMove) throw new Error('move failed'); log.push(`move ${x},${y}`) },
        press: async () => { log.push('press') },
        release: async () => { log.push('release') },
        pause: async () => {},
    }
}

test('dragPath leaves from by 8 px, crosses in even steps and ends hovering on to', () => {
    const path = dragPath(100, 100, 200, 100, 4)
    assert.deepEqual(path, [[108, 100], [125, 100], [150, 100], [175, 100], [200, 100], [202, 100], [200, 102], [200, 100]])
})

test('a drag shorter than 8 px still ends on to', () => {
    const path = dragPath(10, 10, 13, 10, 2)
    assert.deepEqual(path.at(-1), [13, 10])
    assert.ok(path.every(([x]) => x >= 10 && x <= 15))
})

test('drag moves to from, presses, follows the path and releases at to', async () => {
    const mouse = fakeMouse()
    await drag(mouse, 100, 100, 200, 100, 4)
    assert.equal(mouse.log[0], 'move 100,100')
    assert.equal(mouse.log[1], 'press')
    assert.equal(mouse.log.at(-2), 'move 200,100')
    assert.equal(mouse.log.at(-1), 'release')
    assert.equal(mouse.log.filter(l => l === 'press').length, 1)
})

test('drag releases the button when a move fails', async () => {
    const mouse = fakeMouse(3)
    await assert.rejects(drag(mouse, 100, 100, 200, 100, 4), /move failed/)
    assert.equal(mouse.log.at(-1), 'release')
    assert.ok(mouse.log.includes('press'))
})
