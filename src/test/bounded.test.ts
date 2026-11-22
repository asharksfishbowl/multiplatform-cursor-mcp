import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBounded, splitTrace } from '../session/bounded.js'

test('a child past its bound is captured while it still runs, then killed, and answered as timed out', async () => {
    const steps: string[] = []
    const started = Date.now()
    const r = await runBounded(process.execPath, ['-e', 'console.log("DEBUG: line 1"); setTimeout(() => {}, 60000)'], 300,
        async (pid, out) => {
            assert.doesNotThrow(() => process.kill(pid, 0), 'the child runs during the capture')
            steps.push(`capture ${out.trim()}`)
            return '/hangs/x'
        },
        async pid => { steps.push('kill'); process.kill(pid, 'SIGKILL') })
    assert.deepEqual(steps, ['capture DEBUG: line 1', 'kill'])
    assert.deepEqual([r.code, r.timedOut], [-1, { afterMs: 300, capture: '/hangs/x' }])
    assert.ok(Date.now() - started < 10_000)
})

test('a capture that fails still kills and answers', async () => {
    let killed = false
    const r = await runBounded(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], 200,
        async () => { throw new Error('no WMI') }, async pid => { killed = true; process.kill(pid, 'SIGKILL') })
    assert.deepEqual([killed, r.timedOut?.capture], [true, 'the capture failed: no WMI'])
})

test('a child inside its bound answers its exit code and output, uncaptured', async () => {
    let captured = false
    const r = await runBounded(process.execPath, ['-e', 'console.log("namec-build-lock: status free, 0 waiting"); process.exit(3)'], 10_000,
        async () => { captured = true; return '' })
    assert.deepEqual([r.code, r.out, r.timedOut, captured], [3, 'namec-build-lock: status free, 0 waiting', undefined, false])
})

test('splitTrace parts the Set-PSDebug lines from the script\'s output', () => {
    const r = splitTrace('DEBUG:    1+ Set-PSDebug -Trace 1\r\nnamec-build-lock: status held by: a run, 0 waiting\r\nDEBUG:   40+ exit 0')
    assert.deepEqual(r, { out: 'namec-build-lock: status held by: a run, 0 waiting', trace: ['DEBUG:    1+ Set-PSDebug -Trace 1', 'DEBUG:   40+ exit 0'] })
})
