/** Windows' top-level windows, through scripts/windows-helper.ps1: list them, bring one forward, and ask whether the focused control takes a password. */
import { helper } from '../windows/helper.js'

/** Each visible titled window, or those of a process (exact name, no .exe) or with a title holding the text: 'process pid=… rect=l,t,r,b 'title''. */
export async function findWindows(which?: string): Promise<string> {
    return helper('windows', which ?? '')
}

export async function foregroundWindow(): Promise<string> {
    return helper('foreground')
}

/** Brings a window forward, restoring it only if minimized (a restore would un-maximize a maximized window). */
export async function focusWindow(which: string): Promise<string> {
    return helper('focus', which)
}

/** True when UI Automation's focused element is a password field. A control it cannot see (a web page in a Slate window) reads false. */
export async function focusedIsPassword(): Promise<{ password: boolean, detail: string }> {
    const out = await helper('password')
    return { password: out.startsWith('yes'), detail: out }
}
