import { readFileSync } from 'node:fs'
import path from 'node:path'

/** The server's settings: a JSON file named by --config or DESKTOP_MCP_CONFIG, written by N.A.M.E.C's Tools/Desktop/register-desktop-mcp.ps1. */
export interface Config {
    /** 127.0.0.1 on refpc: Docker Desktop brings host.docker.internal to the host's loopback, and the LAN cannot reach it. */
    host: string
    port: number
    tokenFile: string
    /** A N.A.M.E.C checkout: its Global\NamecBuild lock script and its stop pattern. */
    checkout: string
    /** The wildcard-queue.groovy for each session's // DESKTOP: block. */
    queue: string
    shots: string
    engineRoot: string
    /** An open session, recorded so a restart closes what the last run left open. */
    stateFile: string
}

export function loadConfig(argv: string[]): Config {
    const i = argv.indexOf('--config')
    const file = i >= 0 ? argv[i + 1] : process.env.DESKTOP_MCP_CONFIG
    if (!file) throw new Error('no config: pass --config <file> or set DESKTOP_MCP_CONFIG')
    const c = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Config
    for (const k of ['host', 'port', 'tokenFile', 'checkout', 'queue', 'shots', 'engineRoot', 'stateFile'] as const) if (!c[k]) throw new Error(`${file}: no ${k}`)
    return c
}

export const paths = (c: Config) => ({
    lock: path.join(c.checkout, 'Tools', 'Build', 'namec-build-lock.ps1'),
    stopPattern: path.join(c.checkout, 'Tools', 'Desktop', 'stop-pattern.txt'),
})
