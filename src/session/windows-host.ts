// The session's machine: the N.A.M.E.C checkout's lock script and queue file, and the screenshots, on the Windows desktop this server runs in. A waiting hold is called off by stopping its holder (-Release refuses a hold not yet held; the lock's queue skips a waiter that died), one that has just taken the lock by -Release with the token its -Hold printed first.
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

async function stopWaitingHolder(c: Config, label: string): Promise<string> {
    const stop = `Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like '*-HoldChild "${label}"*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "stopped its waiting holder, pid $($_.ProcessId)" }`
    const r = await new Promise<string>(resolve => execFile('powershell', ['-NoProfile', '-Command', stop], { encoding: 'utf8', windowsHide: true }, (_e, stdout, stderr) => resolve(`${stdout}${stderr}`.trim())))
    return r || 'no waiting holder was left'
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
            watcher.stdout.on('data', d => { out += d })
            watcher.stderr.on('data', d => { out += d })
            const held = new Promise<string>((resolve, reject) => watcher.on('close', code => {
                const token = /-Release -Token (\w+)/.exec(out)?.[1]
                if (code === 0 && token) resolve(token)
                else reject(new Error(`Global\\NamecBuild not held (exit ${code}): ${out.trim().split(/\r?\n/).slice(-3).join(' | ')}`))
            }))
            async function callOff() {
                const token = / token (\w+)\s*$/m.exec(out)?.[1]
                const released = token ? await lockScript(c, ['-Release', '-Token', token]) : null
                watcher.kill()
                return released?.code === 0 ? `released at once, as it had just taken the lock (token ${token})` : stopWaitingHolder(c, label)
            }
            return { held, callOff }
        },
        callOffLeft: label => stopWaitingHolder(c, label),
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
