/**
 * Runs a list of the desktop server's tool calls in order, from a JSON file ([{ "tool": "click", "args": { "x": 1, "y": 2 }, "waitMs": 500 }]), and writes each
 * result to <file>.out.json. Meant for a scheduled task in the user's desktop session (the input and the screenshots need it).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const Steps = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { tool: string, args: any, waitMs?: number }[]
const client = new Client({ name: 'namec-desktop-run', version: '1.0.0' }, { capabilities: {} })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.js')] }))
const Out: any[] = []
for (const Step of Steps) {
    const R: any = await client.callTool({ name: Step.tool, arguments: Step.args })
    Out.push({ tool: Step.tool, args: Step.args, error: !!R.isError, text: R.content?.map((c: any) => c.text).join('\n') })
    writeFileSync(process.argv[2] + '.out.json', JSON.stringify(Out, null, 1))
    if (Step.waitMs) await new Promise(r => setTimeout(r, Step.waitMs)) // agent-rules-ignore: the step file's own pause, for a screen that redraws without telling
}
await client.close()
