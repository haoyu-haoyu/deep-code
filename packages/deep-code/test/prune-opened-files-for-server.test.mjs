import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pruneOpenedFilesForServer } from '../src/services/lsp/pruneOpenedFilesForServer.mjs'

test('removes only the named server entries, keeps others', () => {
  const openedFiles = new Map([
    ['file:///a.ts', { serverName: 'tsserver', startedAt: 1 }],
    ['file:///b.rs', { serverName: 'rust-analyzer', startedAt: 2 }],
    ['file:///c.ts', { serverName: 'tsserver', startedAt: 1 }],
  ])
  pruneOpenedFilesForServer(openedFiles, 'tsserver')
  assert.deepEqual([...openedFiles.keys()], ['file:///b.rs'])
})

test('removing all entries for a server empties them (no leftover under deletion-while-iterating)', () => {
  const openedFiles = new Map([
    ['file:///a.ts', { serverName: 'tsserver', startedAt: 1 }],
    ['file:///b.ts', { serverName: 'tsserver', startedAt: 1 }],
    ['file:///c.ts', { serverName: 'tsserver', startedAt: 1 }],
  ])
  pruneOpenedFilesForServer(openedFiles, 'tsserver')
  assert.equal(openedFiles.size, 0)
})

test('an empty map is a no-op', () => {
  const openedFiles = new Map()
  pruneOpenedFilesForServer(openedFiles, 'tsserver')
  assert.equal(openedFiles.size, 0)
})

test('a server with no entries leaves the map untouched', () => {
  const openedFiles = new Map([
    ['file:///a.ts', { serverName: 'tsserver', startedAt: 1 }],
  ])
  pruneOpenedFilesForServer(openedFiles, 'gopls')
  assert.deepEqual([...openedFiles.keys()], ['file:///a.ts'])
})

test('matches by serverName regardless of startedAt generation', () => {
  // Entries from two different generations of the same server are both dropped.
  const openedFiles = new Map([
    ['file:///a.ts', { serverName: 'tsserver', startedAt: 100 }],
    ['file:///b.ts', { serverName: 'tsserver', startedAt: 200 }],
    ['file:///c.go', { serverName: 'gopls', startedAt: 300 }],
  ])
  pruneOpenedFilesForServer(openedFiles, 'tsserver')
  assert.deepEqual([...openedFiles.keys()], ['file:///c.go'])
})
