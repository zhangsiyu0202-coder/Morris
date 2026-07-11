const path = require('path')
const { spawn } = require('child_process')

const root = path.resolve(__dirname, '../..')
const child = spawn(process.execPath, ['apps/web/.next/standalone/apps/web/server.js'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal)
  })
}
