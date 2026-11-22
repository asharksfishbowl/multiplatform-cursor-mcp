// A child process with a bound (1122-2): the lock script's -Status once ran 19 min on 0.36 s CPU and every begin_session waited on it. Past the bound,
// the hung child is captured while it still runs, then killed with its tree, and the caller gets a timed-out answer instead of waiting.
import { spawn, execFile } from 'node:child_process'

export interface Bounded { code: number, out: string, timedOut?: { afterMs: number, capture: string } }

/** Kills a process and its children: taskkill /T on Windows, the process alone elsewhere (the tests' children have none). */
export function killTree(pid: number): Promise<void> {
    if (process.platform !== 'win32') { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } return Promise.resolve() }
    return new Promise(done => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, () => done()))
}

/** Runs file with args. Past timeoutMs, capture(pid, out so far) runs before the kill, and its answer (where it wrote) comes back as timedOut.capture. */
export function runBounded(file: string, args: string[], timeoutMs: number, capture: (pid: number, out: string) => Promise<string>,
    kill: (pid: number) => Promise<void> = killTree): Promise<Bounded> {
    return new Promise(resolve => {
        const child = spawn(file, args, { windowsHide: true })
        let out = '', settled = false
        const read = (d: Buffer) => { out += d }
        child.stdout.on('data', read)
        child.stderr.on('data', read)
        const finish = (r: Bounded) => { if (!settled) { settled = true; resolve(r) } }
        const timer = setTimeout(async () => { // agent-rules-ignore: the bound is the feature; a hung child is captured, then killed
            if (settled || child.pid === undefined) return
            settled = true
            const pid = child.pid
            const where = await capture(pid, out).catch(e => `the capture failed: ${e?.message ?? e}`)
            await kill(pid)
            resolve({ code: -1, out: out.trim(), timedOut: { afterMs: timeoutMs, capture: where } })
        }, timeoutMs)
        child.on('error', e => { clearTimeout(timer); finish({ code: 1, out: `${out}${e.message}`.trim() }) })
        child.on('close', code => { clearTimeout(timer); finish({ code: code ?? 1, out: out.trim() }) })
    })
}

/** Set-PSDebug -Trace 1 writes each line as it runs to stdout as "DEBUG: ..."; the script's own output is the rest. */
export function splitTrace(out: string): { out: string, trace: string[] } {
    const lines = out.split(/\r?\n/)
    return { out: lines.filter(l => !l.startsWith('DEBUG: ')).join('\n').trim(), trace: lines.filter(l => l.startsWith('DEBUG: ')) }
}
