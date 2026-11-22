// The session's machine: the N.A.M.E.C checkout's lock script and queue file, and the screenshots, on the Windows desktop this server runs in. A hold is called off by -Release with the token its -Hold prints first, else by stopping its waiting holder (`-HoldChild … -Token <t>` on its command line; -Release refuses a hold not yet held, and the lock's queue skips a waiter that died): namec-build-lock.ps1's own forms, which a change there must keep.
import { execFile, spawn } from 'node:child_process'
import { appendFile, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { Config, paths } from '../config.js'
import { screenshot, readText } from '../services/windows/screen.js'
import { foregroundWindow } from '../services/window-manager/windows-manager.js'
import { helper } from '../services/windows/helper.js'
import { loadCloseOnStop, loadStopPattern } from './stop-words.js'
import type { OpenSession, SessionHost } from './desktop-session.js'
import { runBounded, splitTrace } from './bounded.js'

/** A lock script call's bound (1122-2): -Status takes 1-4 s. Past it the call is captured, killed and answered as timed out. */
export const LockTimeoutS = 30
/** Each step of a hang's capture: if WMI or powershell's start-up is what hangs, the capture must not hang begin_session in the probe's place. */
const CaptureStepMs = 10_000
const Utc = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

/** The lock script under Set-PSDebug -Trace 1 (+40 ms on refpc's 300 ms -Status, 2026-11-22), so a hang's capture names the line it stopped at. */
async function lockScript(c: Config, args: string[]): Promise<{ code: number, out: string, timedOut?: string }> {
    if (!args.every(a => /^[\w-]+$/.test(a))) throw new Error(`not a lock script argument: ${args.join(' ')}`)
    const timeoutMs = (c.lockTimeoutSeconds ?? LockTimeoutS) * 1000
    const run = `Set-PSDebug -Trace 1; & '${paths(c).lock.replace(/'/g, "''")}' ${args.join(' ')}; exit $LASTEXITCODE`
    const r = await runBounded('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', run], timeoutMs, (pid, out) => captureHang(c, pid, args, out))
    const { out } = splitTrace(r.out)
    if (!r.timedOut) return { code: r.code, out }
    const said = `namec-build-lock ${args[0]} timed out after ${timeoutMs / 1000} s (capture ${r.timedOut.capture})`
    console.log(`desktop-mcp: ${Utc()} ${said}`)
    return { code: r.code, out, timedOut: said }
}

/** A hung lock script child, while it still runs: the trace so far (its last DEBUG line is where it stopped), its threads' wait reasons, its modules
 * (how far start-up got), its handles, and its children. Built-ins only: refpc has no debugger. Each step is bounded and they run side by side. */
async function captureHang(c: Config, pid: number, args: string[], out: string): Promise<string> {
    const folder = path.join(path.dirname(c.stateFile), 'hangs', `${Utc().replace(/[-:]/g, '')}-${pid}`)
    await mkdir(folder, { recursive: true })
    const step = async (name: string, file: string, stepArgs: string[]) => {
        const r = await runBounded(file, stepArgs, CaptureStepMs, async () => '')
        await writeFile(path.join(folder, name), r.timedOut ? `timed out after ${CaptureStepMs / 1000} s\n${r.out}` : r.out, 'utf8')
    }
    const ps = (script: string) => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]
    await Promise.all([
        writeFile(path.join(folder, 'trace.txt'), `namec-build-lock ${args.join(' ')}, pid ${pid}, captured ${Utc()}\n${out}`, 'utf8'),
        step('process.txt', 'powershell', ps(`$p = Get-Process -Id ${pid} -ErrorAction Stop; "pid ${pid}: started $($p.StartTime.ToUniversalTime().ToString('o')), cpu $($p.TotalProcessorTime), handles $($p.HandleCount), working set $([int]($p.WorkingSet64 / 1MB)) MB, threads $($p.Threads.Count)"; ''; 'threads (id state wait-reason cpu):'; $p.Threads | ForEach-Object { "$($_.Id) $($_.ThreadState) $(if ($_.ThreadState -eq 'Wait') { $_.WaitReason }) $($_.TotalProcessorTime)" }; ''; 'modules:'; $p.Modules | ForEach-Object { $_.FileName }`)),
        step('children.txt', 'powershell', ps(`Get-CimInstance Win32_Process -Filter "ParentProcessId = ${pid}" | ForEach-Object { "$($_.ProcessId) $($_.Name) $($_.CommandLine)" }`)),
        step('tasklist.txt', 'tasklist', ['/v', '/fo', 'csv']),
    ])
    return folder
}

async function stopWaitingHolder(token: string): Promise<{ done: boolean, text: string }> {
    const stop = `try { $p = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*-HoldChild *-Token ${token} -EngineRoot*' }); `
        + `if (-not $p) { 'no holder of that token was left' } else { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; "stopped its waiting holder, pid $($_.ProcessId)" } } } catch { "FAILED: $($_.Exception.Message)"; exit 1 }`
    return new Promise(resolve => execFile('powershell', ['-NoProfile', '-Command', stop], { encoding: 'utf8', windowsHide: true, timeout: LockTimeoutS * 1000 },
        (error, stdout, stderr) => resolve({ done: !error, text: `${stdout}${stderr}`.trim() || `powershell exited ${error?.code ?? 0} saying nothing` })))
}

export function windowsHost(c: Config): SessionHost {
    const p = paths(c)
    return {
        now: () => new Date(),
        async lockBusy() {
            const r = await lockScript(c, ['-Status'])
            // Unknown is busy: begin queues and its -Hold, the real arbiter, decides the turn; a throw would end begin with no session.
            if (r.timedOut) return `unknown: ${r.timedOut}`
            const status = /status (.+)$/m.exec(r.out)?.[1]
            if (r.code !== 0 || !status) throw new Error(`namec-build-lock -Status gave no status (exit ${r.code}): ${r.out}`)
            return status === 'free, 0 waiting' ? null : status
        },
        startHold(label, minutes) {
            const watcher = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', p.lock, '-Hold', label, '-EngineRoot', c.engineRoot, '-Minutes', String(minutes)], { windowsHide: true })
            let out = ''
            let named = (_token: string) => {}
            const token = new Promise<string>((resolve, reject) => { named = resolve; watcher.on('close', () => reject(new Error('the -Hold ended before it named its token'))) })
            const read = (d: Buffer) => { out += d; const t = / token (\w+)\s*$/m.exec(out)?.[1]; if (t) named(t) }
            watcher.stdout.on('data', read)
            watcher.stderr.on('data', read)
            const held = new Promise<string>((resolve, reject) => watcher.on('close', code => {
                const token = /-Release -Token (\w+)/.exec(out)?.[1]
                if (code === 0 && token) resolve(token)
                else reject(new Error(`Global\\NamecBuild not held (exit ${code}): ${out.trim().split(/\r?\n/).slice(-3).join(' | ')}`))
            }))
            return { token, held }
        },
        async callOff(token) {
            const released = await lockScript(c, ['-Release', '-Token', token])
            return released.code === 0 ? { done: true, text: `released at once, as it had just taken the lock (token ${token})` } : stopWaitingHolder(token)
        },
        async releaseLock(token) {
            const r = await lockScript(c, ['-Release', '-Token', token])
            return { released: r.code === 0, text: r.timedOut ?? r.out.split(/\r?\n/).pop() ?? '' }
        },
        appendQueue: text => appendFile(c.queue, `${text}\n`, 'utf8'),
        async shoot(folder, name) {
            const shot = await screenshot(path.join(folder, `${name}.png`))
            return { path: shot.path, lines: await readText(shot) }
        },
        foreground: foregroundWindow,
        stopPattern: () => loadStopPattern(p.stopPattern),
        closeOnStop: () => loadCloseOnStop(p.closeOnStop),
        async windowsOf(rule) {
            return (await helper('listed', rule.process, rule.title)).split(/\r?\n/).filter(Boolean).map(line => {
                const m = /^(\d+) (-?\d+),(-?\d+),(-?\d+),(-?\d+) (.*)$/.exec(line)
                if (!m) throw new Error(`not a listed window: ${line}`)
                return { handle: m[1], l: +m[2], t: +m[3], r: +m[4], b: +m[5], title: m[6] }
            })
        },
        async closeWindow(handle) {
            const text = await helper('close', handle)
            return { closed: text.startsWith('closed '), text }
        },
        async folderFor(started, agent) {
            const folder = path.join(c.shots, `${started.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}-${agent}`)
            await mkdir(folder, { recursive: true })
            return folder
        },
        log: (folder, line) => appendFile(path.join(folder, 'actions.log'), `${line}\n`, 'utf8'),
        saveState: state => state ? writeFile(c.stateFile, JSON.stringify(state)) : rm(c.stateFile, { force: true }),
        expireAfter(ms, then) {
            const t = setTimeout(then, ms) // agent-rules-ignore: the session's own length is the feature; the lock's hold ends at the same minutes
            return () => clearTimeout(t)
        },
    }
}

export async function leftOpen(c: Config): Promise<OpenSession | null> {
    return existsSync(c.stateFile) ? JSON.parse(await readFile(c.stateFile, 'utf8')) as OpenSession : null
}
