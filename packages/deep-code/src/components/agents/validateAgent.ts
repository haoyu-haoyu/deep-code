import type { Tools } from '../../Tool.js'
import { getMessage } from '../../i18n/index.js'
import { resolveAgentTools } from '../../tools/AgentTool/agentToolUtils.js'
import type {
  AgentDefinition,
  CustomAgentDefinition,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { getAgentSourceDisplayName } from './utils.js'

export type AgentValidationResult = {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export function validateAgentType(agentType: string): string | null {
  if (!agentType) {
    return getMessage('agent.validation.typeRequired')
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(agentType)) {
    return getMessage('agent.validation.typeFormat')
  }

  if (agentType.length < 3) {
    return getMessage('agent.validation.typeTooShort')
  }

  if (agentType.length > 50) {
    return getMessage('agent.validation.typeTooLong')
  }

  return null
}

export function validateAgent(
  agent: Omit<CustomAgentDefinition, 'location'>,
  availableTools: Tools,
  existingAgents: AgentDefinition[],
): AgentValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Validate agent type
  if (!agent.agentType) {
    errors.push(getMessage('agent.validation.typeRequired'))
  } else {
    const typeError = validateAgentType(agent.agentType)
    if (typeError) {
      errors.push(typeError)
    }

    // Check for duplicates (excluding self for editing)
    const duplicate = existingAgents.find(
      a => a.agentType === agent.agentType && a.source !== agent.source,
    )
    if (duplicate) {
      errors.push(
        getMessage('agent.validation.typeDuplicate', {
          type: agent.agentType,
          source: getAgentSourceDisplayName(duplicate.source),
        }),
      )
    }
  }

  // Validate description
  if (!agent.whenToUse) {
    errors.push(getMessage('agent.validation.descriptionRequired'))
  } else if (agent.whenToUse.length < 10) {
    warnings.push(getMessage('agent.validation.descriptionTooShort'))
  } else if (agent.whenToUse.length > 5000) {
    warnings.push(getMessage('agent.validation.descriptionTooLong'))
  }

  // Validate tools
  if (agent.tools !== undefined && !Array.isArray(agent.tools)) {
    errors.push(getMessage('agent.validation.toolsNotArray'))
  } else {
    if (agent.tools === undefined) {
      warnings.push(getMessage('agent.validation.toolsAll'))
    } else if (agent.tools.length === 0) {
      warnings.push(getMessage('agent.validation.toolsNone'))
    }

    // Check for invalid tools
    const resolvedTools = resolveAgentTools(agent, availableTools, false)

    if (resolvedTools.invalidTools.length > 0) {
      errors.push(
        getMessage('agent.validation.toolsInvalid', {
          list: resolvedTools.invalidTools.join(', '),
        }),
      )
    }
  }

  // Validate system prompt
  const systemPrompt = agent.getSystemPrompt()
  if (!systemPrompt) {
    errors.push(getMessage('agent.validation.systemPromptRequired'))
  } else if (systemPrompt.length < 20) {
    errors.push(getMessage('agent.validation.systemPromptTooShort'))
  } else if (systemPrompt.length > 10000) {
    warnings.push(getMessage('agent.validation.systemPromptTooLong'))
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}
