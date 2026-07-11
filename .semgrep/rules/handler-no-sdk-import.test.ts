// Semgrep test fixture for `handler-no-sdk-import`.
// Lines marked `ruleid:` MUST trigger the rule; `ok:` MUST NOT trigger.
// Comments explaining WHY each line is what it is sit ABOVE the marker, not after.
//
// Run:  semgrep --test --config ../handler-no-sdk-import.yaml

// ruleid: handler-no-sdk-import
import { Client } from "node-appwrite";
// ruleid: handler-no-sdk-import
import { Databases, Query } from "node-appwrite";
// ruleid: handler-no-sdk-import
import AppwriteSDK from "appwrite";
// ruleid: handler-no-sdk-import
import { AccessToken } from "livekit-server-sdk";
// ruleid: handler-no-sdk-import
import { RoomServiceClient } from "@livekit/server-sdk";

// Type-only imports of our own types are fine — not an SDK.
// ok: handler-no-sdk-import
import type { Deps } from "./deps";

// Schemas from the shared contracts package are fine.
// ok: handler-no-sdk-import
import { IssueLivekitTokenRequestSchema } from "@merism/contracts";

// Observability primitives are allowed everywhere.
// ok: handler-no-sdk-import
import { createLogger } from "@merism/observability";
