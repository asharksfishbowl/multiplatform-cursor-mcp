import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DesktopSessions, SessionHost, OpenSession, StopError } from '../session/desktop-session.js'
import type { TextLine } from '../services/windows/helper.js'

// A fake machine: the queue lines, the lock's holds, and the text each next screenshot shows.
function fake(screens: string[][] = []) {
    const queue: string[] = [], held: string[] = [], released: string[] = [], shots: string[] = []
    let state: OpenSession | null = null, expire: (() => void) | null = null
    const host: SessionHost = {
        now: () => new Date('2026-11-11T12:00:00Z'),
        lockBusy: async () => null,
        holdLock: async label => { held.push(label); return 'tok123' },
        releaseLock: async t => { released.push(t); return `released ${t}` },
        appendQueue: async t => { queue.push(t) },
        shoot: async (folder, name) => { shots.push(name); const lines: TextLine[] = (screens.shift() ?? ['File Edit Window']).map((t, i) => ({ x: 10, y: 20 * i, right: 90, bottom: 20 * i + 15, text: t })); return { path: `${folder}/${name}.png`, lines } },
        foreground: async () => "UnrealEditor 'NAMEC'",
        stopPattern: () => /\$\s?\d|\bBuy\b|Password|Sign in/i,
        folderFor: async (_d, agent) => `/shots/${agent}`,
        log: async () => {},
        saveState: async s => { state = s },
        expireAfter: (_ms, then) => { expire = then; return () => { expire = null } },
    }
    return { host, queue, held, released, shots, state: () => state, expire: () => expire?.() }
}

test('an acting tool outside a session is refused', async () => {
    const f = fake(); const s = new DesktopSessions(f.host)
    await assert.rejects(s.act('x', 'click', '1,1', async () => 'clicked'), /click refused: no desktop session is open/)
})

test('a session writes its DESKTOP block, holds and frees the lock', async () => {
    const f = fake(); const s = new DesktopSessions(f.host)
    const o = await s.begin('builder4', 'add a Fab pack', 10)
    assert.equal(f.held[0], 'desktop builder4')
    assert.match(f.queue[0], /^\n\/\/ DESKTOP: builder4, started 2026-11-11T12:00:00Z: add a Fab pack\. Global\\NamecBuild is held/)
    assert.deepEqual(f.state(), o)
    assert.equal(await s.act(o.id, 'click', '5,5', async () => 'clicked 5,5'), 'clicked 5,5')
    assert.deepEqual(f.shots, ['00-begin', '01-click-before', '01-click'])
    await s.end(o.id)
    assert.deepEqual(f.released, ['tok123'])
    assert.match(f.queue[1], /^\/\/ DESKTOP: builder4 released Global\\NamecBuild at .*: 1 action\(s\); ended by end_session\.$/)
    assert.equal(f.state(), null)
    await assert.rejects(s.act(o.id, 'click', '5,5', async () => 'x'), /no desktop session is open/)
})

test('a second session is refused while one is open, and another id cannot act in it', async () => {
    const f = fake(); const s = new DesktopSessions(f.host)
    const o = await s.begin('builder4', 'one', 5)
    await assert.rejects(s.begin('artist', 'two', 5), /a session is open: builder4/)
    await assert.rejects(s.act('other', 'click', '1,1', async () => 'x'), /session other is not the open one/)
    await s.end(o.id)
})

test('a price on screen before an action ends the session with STOP and nothing is pressed', async () => {
    const f = fake([['Fab'], ['Gamma Studio', 'Buy now  $ 19.99']]); const s = new DesktopSessions(f.host)
    const o = await s.begin('builder4', 'dry run', 5)
    let pressed = false
    await assert.rejects(s.act(o.id, 'click', '1,1', async () => { pressed = true; return 'x' }),
        (e: any) => e instanceof StopError && /^STOP: UnrealEditor 'NAMEC': it shows "Buy now {2}\$ 19\.99"/.test(e.message))
    assert.equal(pressed, false)
    assert.deepEqual(f.released, ['tok123'])
    assert.match(f.queue.at(-1)!, /ended by STOP: /)
    assert.equal(s.current(), null)
})

test('a sign-in screen after an action ends the session', async () => {
    const f = fake([['Fab'], ['Fab'], ['Sign in to continue']]); const s = new DesktopSessions(f.host)
    const o = await s.begin('builder4', 'x', 5)
    await assert.rejects(s.act(o.id, 'click', '1,1', async () => 'clicked'), /STOP: .*Sign in to continue/)
    assert.equal(s.current(), null)
})

test('the session ends itself when its minutes run out', async () => {
    const f = fake(); const s = new DesktopSessions(f.host)
    await s.begin('builder4', 'x', 1)
    f.expire()
    await new Promise(r => setImmediate(r))
    assert.equal(s.current(), null)
    assert.match(f.queue.at(-1)!, /ended by its 1 min ran out\./)
})

test('a session left open by a stopped server is closed at start', async () => {
    const f = fake(); const s = new DesktopSessions(f.host)
    const left: OpenSession = { id: 'abc', agent: 'artist', what: 'x', started: '', deadline: '', token: 'old', folder: '/f', actions: 3 }
    assert.match((await s.recover(left))!, /ended \(the server restarting\)/)
    assert.deepEqual(f.released, ['old'])
    assert.match(f.queue[0], /^\/\/ DESKTOP: artist released .*: 3 action\(s\); ended by the server restarting\.$/)
})

test('a lock that is not held starts no session and says so in the block', async () => {
    const f = fake(); f.host.holdLock = async () => { throw new Error('Global\\NamecBuild not held (exit 1)') }
    const s = new DesktopSessions(f.host)
    await assert.rejects(s.begin('builder4', 'x', 5), /not held/)
    assert.match(f.queue[1], /^\/\/ DESKTOP: builder4 not started: /)
    assert.equal(s.current(), null)
})

test('a busy lock refuses the session at once: no block, no hold', async () => {
    const f = fake(); f.host.lockBusy = async () => 'held by: ui-captures refpc-68a5615c, pid 30420, 2 waiting'
    const s = new DesktopSessions(f.host)
    await assert.rejects(s.begin('builder4', 'x', 5), /begin_session refused: Global\\NamecBuild is held by: ui-captures/)
    assert.deepEqual([f.queue, f.held], [[], []])
})
