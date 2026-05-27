import type { Command } from '../../commands.js'

const cache = {
  type: 'local-jsx',
  name: 'cache',
  description:
    'Inspect DeepSeek cache hit rate; subcommands: inspect | warmup | clear',
  argumentHint: '[inspect|warmup|clear]',
  isEnabled: () => true,
  load: () => import('./cache.js'),
} satisfies Command

export default cache
