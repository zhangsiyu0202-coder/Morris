import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime"
import { BuiltInAgent } from "@copilotkit/runtime/v2"
import {
  COPILOT_AGENT_PROMPT,
  COPILOT_SERVER_TOOLS,
} from "../lib/copilot/agent"
import { MORIS_AGENT_ID } from "../lib/copilot/ids"

let runtime: CopilotRuntime | undefined

function getRuntime(): CopilotRuntime {
  if (runtime) return runtime

  const { model } = createCopilotModel()

  const generalAgent = new BuiltInAgent({
    model,
    maxSteps: 5,
    prompt: COPILOT_AGENT_PROMPT,
    tools: COPILOT_SERVER_TOOLS,
  })

  runtime = new CopilotRuntime({
    agents: {
      default: generalAgent,
      [MORIS_AGENT_ID]: generalAgent,
    },
  })

  return runtime
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    })
    res.end()
    return
  }

  try {
    const body = await readBody(req)
    const url = `http://localhost${req.url ?? "/"}`
    const webRequest = new Request(url, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([, v]) => v != null) as [string, string][],
      ),
      body: body || undefined,
    })

    const { handleRequest: handler } = copilotRuntimeNextJSAppRouterEndpoint({
      runtime: getRuntime(),
      endpoint: "/api/copilotkit",
    })

    const response = await handler(webRequest)

    res.writeHead(response.status, {
      "Access-Control-Allow-Origin": "*",
      ...Object.fromEntries(response.headers.entries()),
    })

    if (response.body) {
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }
    res.end()
  } catch (err) {
    console.error("[copilotkit-runtime]", err)
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Internal server error" }))
  }
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") {
      resolve(null)
      return
    }
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString()))
    req.on("error", () => resolve(null))
  })
}

const PORT = Number(process.env.COPILOTKIT_PORT) || 4200

createServer(handleRequest).listen(PORT, () => {
  console.log(`[copilotkit-runtime] listening on http://localhost:${PORT}`)
})
