import { Client, Functions } from "appwrite"
import {
  type IssueLivekitTokenResponse,
  IssueLivekitTokenResponseSchema,
} from "@merism/contracts"

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID
const FUNCTION_ID = process.env.NEXT_PUBLIC_ISSUE_TOKEN_FUNCTION_ID ?? "issueLivekitToken"
const TOKEN_TIMEOUT_MS = 15_000

/** Reject if the promise does not settle within `ms`, so the UI never hangs forever. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("token_request_timeout")), ms),
    ),
  ])
}

/**
 * Exchange an interview link token for a LiveKit room token.
 *
 * Calls the `issueLivekitToken` Appwrite Function from the browser. The
 * function holds all server secrets (LiveKit API secret, Appwrite API key);
 * the client only ever sees the short-lived room token it returns.
 */
export async function issueLivekitToken(
  linkToken: string,
  alias?: string,
): Promise<IssueLivekitTokenResponse> {
  if (!ENDPOINT || !PROJECT_ID) {
    throw new Error("appwrite_not_configured")
  }

  const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID)
  const functions = new Functions(client)

  const execution = await withTimeout(
    functions.createExecution(
      FUNCTION_ID,
      JSON.stringify({ linkToken, alias }),
      false,
      undefined,
      "POST" as never,
      { "content-type": "application/json" },
    ),
    TOKEN_TIMEOUT_MS,
  )

  if (execution.responseStatusCode >= 400) {
    throw new Error(parseError(execution.responseBody))
  }

  let json: unknown
  try {
    json = JSON.parse(execution.responseBody)
  } catch {
    throw new Error("invalid_token_response")
  }

  const parsed = IssueLivekitTokenResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error("invalid_token_response")
  }
  return parsed.data
}

function parseError(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: string }
    return json.error ?? "token_request_failed"
  } catch {
    return "token_request_failed"
  }
}
