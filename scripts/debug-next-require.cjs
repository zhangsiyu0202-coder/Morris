const Module = require('module')
const fs = require('fs')

const LOG = '/tmp/opencode/debug-next-require.log'

function log(...parts) {
  fs.appendFileSync(LOG, `${parts.join(' ')}\n`)
}

const originalLoad = Module._load

Module._load = function patchedLoad(request, parent, isMain) {
  if (
    typeof request === 'string' &&
    (request.includes('vendor-chunks') ||
      request.includes('node-fetch-native-with-agent') ||
      request.includes('6055') ||
      request.includes('967'))
  ) {
    log('[debug-next-require] load', request, 'from', parent && parent.filename)
  }
  return originalLoad.apply(this, arguments)
}
