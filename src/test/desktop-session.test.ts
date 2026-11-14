import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ClaimMs, DesktopSessions, SessionHost, OpenSession, StopError, StatusWaitMs } from '../session/desktop-session.js'
import type { TextLine } from '../services/windows/helper.js'

// A fake machine: the queue lines, the lock's holds (each held at once, or when the test says), its timers by length, and the text each next screenshot shows.
function fake(screens: string[][] = [], releaseFails = '') {
    const queue: string[] = [], held: string[] = [], released: string[] = [], shots: string[] = [], calledOff: string[] = []
    let state: OpenSession | null = null
    const timers = new Map<number, () => void>()
    let take: ((token: string) => void) | null = null, refuse: ((e: Error) => void) | null = null
    let holdsAtOnce = true
    const host: SessionHost = {
        now: () => new Date('2026-11-11T12:00:00Z'),
        lockBusy: async () => null,
        startHold: label => {
            held.push(label)
            const turn = new Promise<string>((resolve, reject) => { take = resolve; refuse = reject })
            if (holdsAtOnce) take!('tok123')
            return { held: turn, callOff: async () => { calledOff.push(label); return 'stopped its waiting holder, pid 4242' } }
        },
        callOffLeft: async label => { calledOff.push(`left ${label}`); return 'stopped its waiting holder, pid 77' },
        releaseLock: async t => { released.push(t); return releaseFails ? { released: false, text: releaseFails } : { released: true, text: `released ${t}` } },
        appendQueue: async t => { queue.push(t) },
        shoot: async (folder, name) => { shots.push(name); const lines: TextLine[] = (screens.shift() ?? ['File Edit Window']).map((t, i) => ({ x: 10, y: 20 * i, right: 90, bottom: 20 * i + 15, text: t })); return { path: `${folder}/${name}.png`, lines } },
        foreground: async () => "UnrealEditor 'NAMEC'",
        stopPattern: () => /\$\s?\d|\bBuy\b|Password|Sign in/i,
        folderFor: async (_d, agent) => `/shots/${agent}`,
        log: async () => {},
        saveState: async s => { state = s },
        expireAfter: (ms, then) => { timers.set(ms, then); return () => { timers.delete(ms) } },
    }
    const settle = () => new Promise(done => setImmediate(done))
    return {
        host, queue, held, released, shots, calledOff, state: () => state,
        expire: (ms = 60_000) => [...timers].find(([length]) => length >= ms && length !== ClaimMs && length !== StatusWaitMs)?.[1](),
        fire: (ms: number) => timers.get(ms)?.(), timer: (ms: number) => timers.has(ms),
        queueBehind: (busy: string) => { holdsAtOnce = false; host.lockBusy = async () => busy },
        holdNow: async () => { take?.('tok456'); await settle(); await settle() },
        refuseHold: async (why: string) => { refuse?.(new Error(why)); await settle(); await settle() },
        settle,
    }
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
    const left = { id: 'abc', agent: 'artist', what: 'x', started: '', deadline: '', token: 'old', folder: '/f', actions: 3 } as OpenSession
    assert.match((await s.recover(left))!, /ended \(the server restarting\)/)
    assert.deepEqual(f.released, ['old'])
    assert.match(f.queue[0], /^\/\/ DESKTOP: artist released .*: 3 action\(s\); ended by the server restarting\.$/)
})

test('a session the stopped server left queued has its waiting hold called off at start', async () => {
    const f = fake(); const s = new DesktopSessions(f.host)
    const left: OpenSession = { id: 'q1', agent: 'artist', what: 'x', started: '', deadline: '', token: '', folder: '/f', actions: 0, phase: 'queued', minutes: 5 }
    assert.match((await s.recover(left))!, /called off \(the server restarting\)/)
    assert.deepEqual([f.calledOff, f.released], [['left desktop artist'], []])
    assert.match(f.queue[0], /^\/\/ DESKTOP: artist called off at .* before it held Global\\NamecBuild: stopped its waiting holder, pid 77; ended by the server restarting\.$/)
})

test('a lock that is not held starts no session and says so in the block', async () => {
    const f = fake(); f.host.startHold = () => ({ held: Promise.reject(new Error('Global\\NamecBuild not held (exit 1)')), callOff: async () => 'x' })
    const s = new DesktopSessions(f.host)
    await assert.rejects(s.begin('builder4', 'x', 5), /not held/)
    assert.match(f.queue[1], /^\/\/ DESKTOP: builder4 not started: /)
    assert.equal(s.current(), null)
})

test('on a busy lock begin answers queued at once; session_status waits for its turn; its minutes start when it holds', async () => {
    const f = fake(); f.queueBehind('held by: ui-captures refpc-68a5615c, pid 30420, 2 waiting')
    const s = new DesktopSessions(f.host)
    const o = await s.begin('builder4', 'add a Fab pack', 10)
    assert.deepEqual([o.phase, o.deadline, f.held], ['queued', '', ['desktop builder4']])
    assert.match(f.queue[0], /^\n\/\/ DESKTOP: builder4, queued at 2026-11-11T12:00:00Z: add a Fab pack\. Global\\NamecBuild is held by: ui-captures .*, 2 waiting; the session takes its turn, then holds it at most 10 min\./)
    await assert.rejects(s.act(o.id, 'click', '1,1', async () => 'x'), /click refused: session .* is queued for Global\\NamecBuild/)
    await assert.rejects(s.begin('artist', 'two', 5), /a session is open: builder4, 'add a Fab pack', queued for the lock/)
    const waiting = s.status(o.id)
    await f.settle()
    assert.equal(f.timer(StatusWaitMs), true)
    await f.holdNow()
    assert.match(await waiting, /^session .* open for builder4: holds Global\\NamecBuild until 2026-11-11T12:10:00Z/)
    assert.match(f.queue[1], /^\/\/ DESKTOP: builder4 holds Global\\NamecBuild from 2026-11-11T12:00:00Z, at most 10 min: no PIE/)
    assert.deepEqual([o.phase, o.token, f.timer(ClaimMs), f.timer(StatusWaitMs)], ['held', 'tok456', false, false])
    assert.equal(await s.act(o.id, 'click', '5,5', async () => 'clicked 5,5'), 'clicked 5,5')
    await s.end(o.id)
    assert.deepEqual(f.released, ['tok456'])
})

test('session_status answers queued when its wait runs out before the turn comes', async () => {
    const f = fake(); f.queueBehind('held by: a run, 3 waiting')
    const s = new DesktopSessions(f.host)
    const o = await s.begin('builder4', 'x', 5)
    const waiting = s.status(o.id)
    await f.settle()
    f.fire(StatusWaitMs)
    assert.match(await waiting, /^session .* queued: Global\\NamecBuild is held by: a run, 3 waiting; call session_status again$/)
})

test('a session that held but was never claimed gives the lock back after the claim window', async () => {
    const f = fake(); f.queueBehind('held by: a run, 0 waiting')
    const s = new DesktopSessions(f.host)
    await s.begin('builder4', 'x', 30)
    await f.holdNow()
    assert.equal(f.timer(ClaimMs), true)
    f.fire(ClaimMs)
    await f.settle()
    assert.equal(s.current(), null)
    assert.deepEqual(f.released, ['tok456'])
    assert.match(f.queue.at(-1)!, /^\/\/ DESKTOP: builder4 released Global\\NamecBuild at .*: 0 action\(s\); ended by its caller did not claim it within 90 s of holding\.$/)
})

test('end_session on a queued session calls its hold off, and a turn that comes after takes nothing', async () => {
    const f = fake(); f.queueBehind('held by: a run, 1 waiting')
    const s = new DesktopSessions(f.host)
    const o = await s.begin('builder4', 'x', 5)
    assert.match(await s.end(o.id), /called off \(end_session\) before it held the lock/)
    assert.deepEqual([f.calledOff, f.released], [['desktop builder4'], []])
    assert.match(f.queue.at(-1)!, /^\/\/ DESKTOP: builder4 called off at .* before it held Global\\NamecBuild: stopped its waiting holder, pid 4242; ended by end_session\.$/)
    await f.holdNow()
    assert.deepEqual([s.current(), f.queue.length], [null, 2])
})

test('a queued hold that fails ends the session and says so in the block', async () => {
    const f = fake(); f.queueBehind('held by: a run, 1 waiting')
    const s = new DesktopSessions(f.host)
    const o = await s.begin('builder4', 'x', 5)
    await f.refuseHold('Global\\NamecBuild not held (exit 1): engine install is mid-update')
    assert.equal(s.current(), null)
    assert.match(f.queue.at(-1)!, /^\/\/ DESKTOP: builder4 not started: .*mid-update$/)
    assert.match(await s.status(o.id).catch(e => e.message), /is not open or queued/)
})

test('a release the lock script refuses is written as NOT released, with the token and when the hold ends', async () => {
    const f = fake([], "The argument 'namec-build-lock.ps1' to the -File parameter does not exist"); const s = new DesktopSessions(f.host)
    const o = await s.begin('builder4', 'a release that fails', 45)
    await s.end(o.id)
    assert.deepEqual(f.released, ['tok123'])
    assert.doesNotMatch(f.queue[1], /released Global/)
    assert.match(f.queue[1], /^\/\/ DESKTOP: builder4 ended at 2026-11-11T12:00:00Z but did NOT release Global\\NamecBuild: The argument .* does not exist\. The hold ends by itself at 2026-11-11T12:45:00Z, or by namec-build-lock\.ps1 -Release -Token tok123\. 0 action\(s\); ended by end_session\.$/)
})
