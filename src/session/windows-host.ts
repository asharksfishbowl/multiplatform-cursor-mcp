// The session's machine: the N.A.M.E.C checkout's lock script and queue file, and the screenshots, on the Windows desktop this server runs in. A hold is called off by -Release with the token its -Hold prints first, else by stopping its waiting holder (`-HoldChild … -Token <t>` on its command line; -Release refuses a hold not yet held, and the lock's queue skips a waiter that died): namec-build-lock.ps1's own forms, which a change there must keep.
import { execFile, spawn } from 'node:child_process'
import { appendFile, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { Config, paths } from '../config.js'
import { screenshot, readText } from '../services/windows/screen.js'
import { foregroundWindow } from '../services/window-manager/windows-manager.js'
import { loadStopPattern } from './stop-words.js'
import type { OpenSession, SessionHost } from './desktop-session.js'

function lockScript(c: Config, args: string[]): Promise<{ code: number, out: string }> {
    return new Promise(resolve => {
        execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', paths(c).lock, ...args], { encoding: 'utf8', windowsHide: true },
            (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: `${stdout}${stderr}`.trim() }))
    })
}

async function stopWaitingHolder(token: string): Promise<{ done: boolean, text: string }> {
    const stop = `try { $p = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop | Where-Object { $_.CommandLine -like '*-HoldChild *-Token ${token} -EngineRoot*' }); `
        + `if (-not $p) { 'no holder of that token was left' } else { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; "stopped its waiting holder, pid $($_.ProcessId)" } } } catch { "FAILED: $($_.Exception.Message)"; exit 1 }`
    return new Promise(resolve => execFile('powershell', ['-NoProfile', '-Command', stop], { encoding: 'utf8', windowsHide: true },
        (error, stdout, stderr) => resolve({ done: !error, text: `${stdout}${stderr}`.trim() || `powershell exited ${error?.code ?? 0} saying nothing` })))
}

export function windowsHost(c: Config): SessionHost {
    const p = paths(c)
    return {
        now: () => new Date(),
        async lockBusy() {
            const r = await lockScript(c, ['-Status'])
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
            return { released: r.code === 0, text: r.out.split(/\r?\n/).pop() ?? '' }
        },
        appendQueue: text => appendFile(c.queue, `${text}\n`, 'utf8'),
        async shoot(folder, name) {
            const shot = await screenshot(path.join(folder, `${name}.png`))
            return { path: shot.path, lines: await readText(shot) }
        },
        foreground: foregroundWindow,
        stopPattern: () => loadStopPattern(p.stopPattern),
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
