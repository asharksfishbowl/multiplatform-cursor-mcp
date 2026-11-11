// The desktop control MCP server over Streamable HTTP. Run it in the Windows desktop session it is to see and drive (a scheduled task at sign-in,
// /IT): input and screenshots from another session, as ssh's, reach nothing. Every request carries the bearer token from the config's tokenFile.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { loadConfig } from './config.js'
import { registerTools } from './tools/desktop-tools.js'
import { DesktopSessions } from './session/desktop-session.js'
import { windowsHost, leftOpen } from './session/windows-host.js'

const config = loadConfig(process.argv)
const token = Buffer.from(readFileSync(config.tokenFile, 'utf8').trim())
if (token.length < 32) throw new Error(`${config.tokenFile}: the token is under 32 characters`)
const sessions = new DesktopSessions(windowsHost(config))
const recovered = await sessions.recover(await leftOpen(config))
if (recovered) console.log(`desktop-mcp: ${recovered}`)

function authorized(header: string | undefined): boolean {
    const given = Buffer.from(/^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '')
    return given.length === token.length && timingSafeEqual(given, token)
}

const http = createServer(async (req, res) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/mcp') { res.writeHead(404).end(); return }
    if (!authorized(req.headers.authorization)) { res.writeHead(401).end('no or wrong bearer token'); return }
    // Stateless: a server and a transport each request. The desktop session lives in `sessions`, not in the MCP connection.
    const server = new McpServer({ name: 'desktop-control', version: '2.0.0' })
    registerTools(server, config, sessions)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { void transport.close(); void server.close() })
    await server.connect(transport)
    await transport.handleRequest(req, res)
})
http.listen(config.port, config.host, () => console.log(`desktop-mcp: listening on http://${config.host}:${config.port}/mcp`))
