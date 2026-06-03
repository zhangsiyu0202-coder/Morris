"use client"

import { CopilotKit } from "@copilotkit/react-core/v2"
import { CopilotChat } from "@copilotkit/react-core/v2"
import { MORIS_AGENT_ID } from "@lib/copilot/ids"

export function MorisPage() {
  return (
    <div className="flex h-full flex-col" data-copilotkit>
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent={MORIS_AGENT_ID}
      >
        <CopilotChat
          className="h-full flex-1"
          labels={{
            modalHeaderTitle: "Moris",
            welcomeMessageText: "What can I help with?",
            chatInputPlaceholder: "Ask Moris anything...",
          }}
        />
      </CopilotKit>
    </div>
  )
}
