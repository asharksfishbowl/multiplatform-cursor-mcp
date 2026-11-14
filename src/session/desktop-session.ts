// A desktop session: the one agent allowed to act on the desktop, for a bounded time, under Global\NamecBuild, recorded in a // DESKTOP: block of N.A.M.E.C's
// wildcard-queue.groovy. On a busy lock it queues for its turn (1114-18) and its minutes start when held. Acting goes through act(); a stop word ends it.
import { randomBytes } from 'node:crypto'
import type { TextLine } from '../services/windows/helper.js'
import { stopHit } from './stop-words.js'

/** A hold of Global\NamecBuild on its way: `held` resolves with the token once held; `callOff` ends it while it still waits. */
export interface Hold { held: Promise<string>, callOff(): Promise<string> }

/** What a session needs of the machine; the server gives the real one, the tests a fake. */
export interface SessionHost {
    now(): Date
    /** Global\NamecBuild's holder and waiters, null when free with none waiting. */
    lockBusy(): Promise<string | null>
    startHold(label: string, minutes: number): Hold
    /** A waiting hold the last run of the server left behind, by its label, called off. */
    callOffLeft(label: string): Promise<string>
    /** released: the lock script took the release (exit 0); text: its last line, which says why when it did not. */
    releaseLock(token: string): Promise<{ released: boolean, text: string }>
    appendQueue(text: string): Promise<void>
    /** Saves a screenshot named in the session's folder and reads its text. */
    shoot(folder: string, name: string): Promise<{ path: string, lines: TextLine[] }>
    /** The window that has the input, for a STOP line's screen. */
    foreground(): Promise<string>
    stopPattern(): RegExp
    folderFor(started: Date, agent: string): Promise<string>
    log(folder: string, line: string): Promise<void>
    saveState(state: OpenSession | null): Promise<void>
    /** Calls back once `ms` is over; the answer cancels it. */
    expireAfter(ms: number, then: () => void): () => void
}

export interface OpenSession {
    id: string, agent: string, what: string, started: string, deadline: string, token: string, folder: string, actions: number
    phase: 'queued' | 'held', minutes: number
}

export class StopError extends Error {}

const Utc = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z')
const labelOf = (agent: string) => `desktop ${agent}`
/** How long a session that queued holds the lock before its caller claims it (session_status or an action); then it gives the lock back. */
export const ClaimMs = 90_000
/** session_status waits at most this long: under the 60 s an MCP SDK client gives a tool call (measured, 1114-18). */
export const StatusWaitMs = 45_000

export class DesktopSessions {
    private open: OpenSession | null = null
    private hold: Hold | null = null
    private cancelExpiry: (() => void) | null = null
    private cancelClaim: (() => void) | null = null
    private pattern: RegExp | null = null

    constructor(private host: SessionHost) {}

    current(): OpenSession | null { return this.open }

    async begin(agent: string, what: string, minutes: number): Promise<OpenSession> {
        if (!/^[A-Za-z0-9~_-]{1,40}$/.test(agent)) throw new Error(`agent must be your agent name (letters, digits, ~ _ -), not '${agent}'`)
        if (!(minutes >= 1 && minutes <= 240)) throw new Error('minutes must be 1 to 240')
        if (!what.trim()) throw new Error('say what the session is for')
        if (this.open) throw new Error(`a session is open: ${this.open.agent}, '${this.open.what}', ${this.open.phase === 'held' ? `until ${this.open.deadline}` : 'queued for the lock'}`)
        const busy = await this.host.lockBusy()
        this.pattern = this.host.stopPattern()
        const started = this.host.now()
        const folder = await this.host.folderFor(started, agent)
        const s: OpenSession = { id: randomBytes(6).toString('hex'), agent, what: what.trim(), started: Utc(started), deadline: '', token: '', folder, actions: 0, phase: 'queued', minutes }
        this.open = s
        await this.host.appendQueue(busy
            ? `\n// DESKTOP: ${agent}, queued at ${Utc(started)}: ${s.what}. Global\\NamecBuild is ${busy}; the session takes its turn, then holds it at most ${minutes} min. Pictures: ${folder}`
            : `\n// DESKTOP: ${agent}, started ${Utc(started)}: ${s.what}. Global\\NamecBuild is held for it, at most ${minutes} min: no PIE, live pass or editor rebuild on refpc until this block says released. Pictures: ${folder}`)
        await this.host.saveState(s)
        await this.host.log(folder, `${Utc(started)} ${agent} begin_session '${s.what}' ${minutes} min${busy ? `, queued: ${busy}` : ''}`)
        const hold = this.hold = this.host.startHold(labelOf(agent), minutes)
        if (busy) {
            void hold.held.then(token => this.held(s, token, true), e => this.notStarted(s, e)).catch(() => undefined)
            return s
        }
        let token: string
        try { token = await hold.held } catch (e) { await this.notStarted(s, e); throw e }
        await this.held(s, token, false)
        return s
    }

    /** The lock is the session's: its minutes start now. A session that queued gives it back unless its caller claims it within ClaimMs. */
    private async held(s: OpenSession, token: string, queued: boolean): Promise<void> {
        if (this.open !== s) return
        const at = this.host.now()
        Object.assign(s, { phase: 'held', token, deadline: Utc(new Date(at.getTime() + s.minutes * 60_000)) })
        if (queued) await this.host.appendQueue(`// DESKTOP: ${s.agent} holds Global\\NamecBuild from ${Utc(at)}, at most ${s.minutes} min: no PIE, live pass or editor rebuild on refpc until this block says released.`)
        await this.host.saveState(s)
        await this.host.log(s.folder, `${Utc(at)} ${s.agent} holds the lock, token ${token}`)
        this.cancelExpiry = this.host.expireAfter(s.minutes * 60_000, () => { void this.end(s.id, `its ${s.minutes} min ran out`) })
        if (queued) this.cancelClaim = this.host.expireAfter(ClaimMs, () => { void this.end(s.id, `its caller did not claim it within ${ClaimMs / 1000} s of holding`) })
        await this.check('00-begin')
    }

    private async notStarted(s: OpenSession, e: any): Promise<void> {
        if (this.open !== s) return
        this.open = null; this.hold = null
        await this.host.appendQueue(`// DESKTOP: ${s.agent} not started: ${e?.message ?? e}`)
        await this.host.saveState(null)
    }

    /** The session's state for its caller, waiting up to `waitMs` while it is queued. Answering a held session claims it. */
    async status(id: string, waitMs = StatusWaitMs): Promise<string> {
        const s = this.open
        if (!s || id !== s.id) throw new Error(`session ${id} is not open or queued`)
        if (s.phase === 'queued' && this.hold) {
            let stop = () => {}
            const waited = new Promise<void>(done => { stop = this.host.expireAfter(waitMs, done) })
            await Promise.race([this.hold.held.then(() => undefined, () => undefined), waited])
            stop()
            await new Promise(done => setImmediate(done))
        }
        if (this.open !== s) return `session ${id} ended before it held Global\\NamecBuild: see its DESKTOP block`
        if (s.phase === 'queued') return `session ${id} queued: Global\\NamecBuild is ${await this.host.lockBusy() ?? 'free and about to be held'}; call session_status again`
        this.cancelClaim?.(); this.cancelClaim = null
        return `session ${id} open for ${s.agent}: holds Global\\NamecBuild until ${s.deadline}; pictures ${s.folder}`
    }

    /** Ends the session: a held one's lock released, a queued one's hold called off, the DESKTOP block closed with what ended it. */
    async end(id: string, why = 'end_session'): Promise<string> {
        const s = this.open
        if (!s) throw new Error('no session is open')
        if (id !== s.id) throw new Error(`session ${id} is not the open one (${s.agent}'s)`)
        this.open = null
        this.cancelExpiry?.(); this.cancelExpiry = null
        this.cancelClaim?.(); this.cancelClaim = null
        const hold = this.hold
        this.hold = null
        const at = Utc(this.host.now())
        if (s.phase === 'queued') {
            const off = hold ? await hold.callOff() : await this.host.callOffLeft(labelOf(s.agent))
            await this.host.log(s.folder, `${at} ${s.agent} end while queued: ${why}; ${off}`)
            await this.host.appendQueue(`// DESKTOP: ${s.agent} called off at ${at} before it held Global\\NamecBuild: ${off}; ended by ${why}.`)
            await this.host.saveState(null)
            return `session ${s.id} called off (${why}) before it held the lock`
        }
        const release = await this.host.releaseLock(s.token)
        await this.host.log(s.folder, `${at} ${s.agent} end: ${why}; ${release.text}`)
        // Only a release the lock script took is written as one: a refused or failed release leaves the hold until its minutes run out.
        await this.host.appendQueue(release.released
            ? `// DESKTOP: ${s.agent} released Global\\NamecBuild at ${at}: ${s.actions} action(s); ended by ${why}.`
            : `// DESKTOP: ${s.agent} ended at ${at} but did NOT release Global\\NamecBuild: ${release.text}. The hold ends by itself at ${s.deadline}, or by namec-build-lock.ps1 -Release -Token ${s.token}. ${s.actions} action(s); ended by ${why}.`)
        await this.host.saveState(null)
        return `session ${s.id} ended (${why}); ${s.actions} action(s); pictures ${s.folder}`
    }

    /** An acting tool: refused outside the held session; the screen is checked for stop words before it acts and after, and pictured after. */
    async act(id: string, tool: string, detail: string, action: () => Promise<string>): Promise<string> {
        const s = this.open
        if (!s) throw new Error(`${tool} refused: no desktop session is open; begin_session first`)
        if (id !== s.id) throw new Error(`${tool} refused: session ${id} is not the open one (${s.agent}'s)`)
        if (s.phase !== 'held') throw new Error(`${tool} refused: session ${id} is queued for Global\\NamecBuild; session_status waits for its turn`)
        this.cancelClaim?.(); this.cancelClaim = null
        const n = String(s.actions + 1).padStart(2, '0')
        await this.check(`${n}-${tool}-before`)
        const result = await action()
        s.actions++
        await this.host.log(s.folder, `${Utc(this.host.now())} ${s.agent} ${tool} ${detail} -> ${result}`)
        await this.check(`${n}-${tool}`)
        return result
    }

    /** A shot of the screen inside the held session, read for stop words; a hit ends the session and throws `STOP: <screen>: <why>`. */
    async check(name: string): Promise<{ path: string, lines: TextLine[] }> {
        const s = this.open
        if (!s || s.phase !== 'held' || !this.pattern) throw new Error('no session holds the lock')
        const shot = await this.host.shoot(s.folder, name)
        const hit = stopHit(shot.lines, this.pattern)
        if (hit) {
            const stop = `STOP: ${await this.host.foreground()}: it shows "${hit.text}" at (${hit.x}, ${hit.y}) (${shot.path})`
            await this.end(s.id, stop)
            throw new StopError(stop)
        }
        return shot
    }

    /** At start: a session the last run left is closed: a held one's lock released, a queued one's waiting hold called off. */
    async recover(left: OpenSession | null): Promise<string | null> {
        if (!left) return null
        this.open = { ...left, phase: left.phase ?? 'held', minutes: left.minutes ?? 0 }
        return this.end(left.id, 'the server restarting')
    }
}
