// Process-local signal from auth routes to the realtime layer: a user's
// sessions changed (signed out, signed out everywhere, password reset, account
// reclaimed). The Socket.io layer re-checks that user's open connections and
// drops any whose session no longer exists, since sockets only authenticate
// when they connect.
const { EventEmitter } = require('events')

const securityEvents = new EventEmitter()
securityEvents.setMaxListeners(5)

function notifySessionsChanged(userId) {
  const id = Number(userId)
  if (Number.isSafeInteger(id) && id > 0) securityEvents.emit('sessions-changed', id)
}

module.exports = { securityEvents, notifySessionsChanged }
