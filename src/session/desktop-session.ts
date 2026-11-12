// A desktop session: the one agent allowed to act on the desktop, for a bounded time, under Global\NamecBuild, recorded in a // DESKTOP: block of
// N.A.M.E.C's wildcard-queue.groovy. Every acting tool goes through act(): refused outside the session, and a screen showing a stop word ends it.
import { randomBytes } from 'node:crypto'
import type { TextLine } from '../services/windows/helper.js'
import { stopHit } from './stop-words.js'

/** What a session needs of the machine; the server gives the real one, the tests a fake. */
export interface SessionHost {
    now(): Date
    /** Global\NamecBuild's holder and waiters, null when free with none waiting; holdLock resolves with the token once held. */
    lockBusy(): Promise<string | null>
    holdLock(label: string, minutes: number): Promise<string>
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
    /** Calls back once the session's minutes are over. */
    expireAfter(ms: number, then: () => void): () => void
}

export interface OpenSession { id: string, agent: string, what: string, started: string, deadline: string, token: string, folder: string, actions: number }

export class StopError extends Error {}

const Utc = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z')

export class DesktopSessions {
    private open: OpenSession | null = null
    private cancelExpiry: (() => void) | null = null
    private pattern: RegExp | null = null

    constructor(private host: SessionHost) {}

    current(): OpenSession | null { return this.open }

    async begin(agent: string, what: string, minutes: number): Promise<OpenSession> {
        if (!/^[A-Za-z0-9~_-]{1,40}$/.test(agent)) throw new Error(`agent must be your agent name (letters, digits, ~ _ -), not '${agent}'`)
        if (!(minutes >= 1 && minutes <= 240)) throw new Error('minutes must be 1 to 240')
        if (!what.trim()) throw new Error('say what the session is for')
        if (this.open) throw new Error(`a session is open: ${this.open.agent}, '${this.open.what}', until ${this.open.deadline}`)
        const busy = await this.host.lockBusy()
        if (busy) throw new Error(`begin_session refused: Global\\NamecBuild is ${busy}; a waiting hold cannot be called off, so begin again once it is free`)
        this.pattern = this.host.stopPattern()
        const started = this.host.now()
        const folder = await this.host.folderFor(started, agent)
        await this.host.appendQueue(`\n// DESKTOP: ${agent}, started ${Utc(started)}: ${what.trim()}. Global\\NamecBuild is held for it, at most ${minutes} min: no PIE, live pass or editor rebuild on refpc until this block says released. Pictures: ${folder}`)
        let token: string
        try { token = await this.host.holdLock(`desktop ${agent}`, minutes) }
        catch (e: any) {
            await this.host.appendQueue(`// DESKTOP: ${agent} not started: ${e?.message ?? e}`)
            throw e
        }
        const deadline = new Date(started.getTime() + minutes * 60_000)
        this.open = { id: randomBytes(6).toString('hex'), agent, what: what.trim(), started: Utc(started), deadline: Utc(deadline), token, folder, actions: 0 }
        await this.host.saveState(this.open)
        await this.host.log(folder, `${Utc(started)} ${agent} begin_session '${what.trim()}' ${minutes} min, lock token ${token}`)
        this.cancelExpiry = this.host.expireAfter(minutes * 60_000, () => { void this.end(this.open?.id ?? '', `its ${minutes} min ran out`) })
        await this.check('00-begin')
        return this.open
    }

    /** Ends the session: the lock released, the DESKTOP block closed with what ended it. */
    async end(id: string, why = 'end_session'): Promise<string> {
        const s = this.open
        if (!s) throw new Error('no session is open')
        if (id !== s.id) throw new Error(`session ${id} is not the open one (${s.agent}'s)`)
        this.open = null
        this.cancelExpiry?.(); this.cancelExpiry = null
        const release = await this.host.releaseLock(s.token)
        const at = Utc(this.host.now())
        await this.host.log(s.folder, `${at} ${s.agent} end: ${why}; ${release.text}`)
        // Only a release the lock script took is written as one: a refused or failed release leaves the hold until its minutes run out.
        await this.host.appendQueue(release.released
            ? `// DESKTOP: ${s.agent} released Global\\NamecBuild at ${at}: ${s.actions} action(s); ended by ${why}.`
            : `// DESKTOP: ${s.agent} ended at ${at} but did NOT release Global\\NamecBuild: ${release.text}. The hold ends by itself at ${s.deadline}, or by namec-build-lock.ps1 -Release -Token ${s.token}. ${s.actions} action(s); ended by ${why}.`)
        await this.host.saveState(null)
        return `session ${s.id} ended (${why}); ${s.actions} action(s); pictures ${s.folder}`
    }

    /** An acting tool: refused outside the open session; the screen is checked for stop words before it acts and after, and pictured after. */
    async act(id: string, tool: string, detail: string, action: () => Promise<string>): Promise<string> {
        const s = this.open
        if (!s) throw new Error(`${tool} refused: no desktop session is open; begin_session first`)
        if (id !== s.id) throw new Error(`${tool} refused: session ${id} is not the open one (${s.agent}'s)`)
        const n = String(s.actions + 1).padStart(2, '0')
        await this.check(`${n}-${tool}-before`)
        const result = await action()
        s.actions++
        await this.host.log(s.folder, `${Utc(this.host.now())} ${s.agent} ${tool} ${detail} -> ${result}`)
        await this.check(`${n}-${tool}`)
        return result
    }

    /** A shot of the screen inside the session, read for stop words; a hit ends the session and throws `STOP: <screen>: <why>`. */
    async check(name: string): Promise<{ path: string, lines: TextLine[] }> {
        const s = this.open
        if (!s || !this.pattern) throw new Error('no session is open')
        const shot = await this.host.shoot(s.folder, name)
        const hit = stopHit(shot.lines, this.pattern)
        if (hit) {
            const stop = `STOP: ${await this.host.foreground()}: it shows "${hit.text}" at (${hit.x}, ${hit.y}) (${shot.path})`
            await this.end(s.id, stop)
            throw new StopError(stop)
        }
        return shot
    }

    /** At start: a session the last run left open is closed, its lock released. */
    async recover(left: OpenSession | null): Promise<string | null> {
        if (!left) return null
        this.open = left
        return this.end(left.id, 'the server restarting')
    }
}
