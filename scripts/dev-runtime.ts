export type LocalProcessDefinition = {
  component: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

export function localProcessDefinitions(root: string): LocalProcessDefinition[] {
  return [
    {
      component: "Web",
      command: "pnpm",
      args: ["-F", "@merism/web", "dev", "--", "--port", "3000"],
      cwd: root,
      env: { NEXT_TELEMETRY_DISABLED: "1" },
    },
    {
      component: "Mastra",
      command: "pnpm",
      args: ["-F", "@merism/agent-voice-worker", "dev"],
      cwd: root,
      env: { MASTRA_PORT: "4111" },
    },
    {
      component: "Voice worker",
      command: "pnpm",
      args: ["-F", "@merism/agent-voice-worker", "dev:worker"],
      cwd: root,
      env: { HEALTH_PORT: "8082" },
    },
  ];
}
