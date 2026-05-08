import { EventEmitter as NodeEventEmitter } from 'events'
import { dlog } from '../_input-debug.js'
import { Event } from './event.js'

// Similar to node's builtin EventEmitter, but is also aware of our `Event`
// class, and so `emit` respects `stopImmediatePropagation()`.
export class EventEmitter extends NodeEventEmitter {
  constructor() {
    super()
    // Disable the default maxListeners warning. In React, many components
    // can legitimately listen to the same event (e.g., useInput hooks).
    // The default limit of 10 causes spurious warnings.
    this.setMaxListeners(0)
  }

  override emit(type: string | symbol, ...args: unknown[]): boolean {
    // Delegate to node for `error`, since it's not treated like a normal event
    if (type === 'error') {
      return super.emit(type, ...args)
    }

    const listeners = this.rawListeners(type)

    if (listeners.length === 0) {
      if (type === 'input') {
        dlog('emitter.emit input', { listenerCount: 0, dropped: true })
      }
      return false
    }

    const ccEvent = args[0] instanceof Event ? args[0] : null

    if (type === 'input') {
      dlog('emitter.emit input', {
        listenerCount: listeners.length,
        firstArgKind:
          args[0] instanceof Event ? args[0].constructor.name : typeof args[0],
      })
    }

    let invokedCount = 0
    for (const listener of listeners) {
      listener.apply(this, args)
      invokedCount += 1

      if (ccEvent?.didStopImmediatePropagation()) {
        if (type === 'input') {
          dlog('emitter.emit input STOPPED', {
            invokedBeforeStop: invokedCount,
            of: listeners.length,
          })
        }
        break
      }
    }

    return true
  }
}
