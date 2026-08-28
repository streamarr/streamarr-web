import { describe, expect, it } from 'vitest'
import { decideRegistration } from './registration'

describe('decideRegistration', () => {
  it('shouldServeViteModuleEntryInDev', () => {
    expect(decideRegistration(true).scriptUrl).toBe('/src/sw/sw.ts')
  })

  it('shouldServeBuiltRootScriptInProduction', () => {
    expect(decideRegistration(false).scriptUrl).toBe('/sw.js')
  })

  it('shouldRegisterAsModuleInBothModes', () => {
    expect(decideRegistration(true).options.type).toBe('module')
    expect(decideRegistration(false).options.type).toBe('module')
  })

  it('shouldClaimWholeAppScopeInBothModes', () => {
    // The default scope is the script's directory (/src/sw/ in dev), which controls no app page.
    expect(decideRegistration(true).options.scope).toBe('/')
    expect(decideRegistration(false).options.scope).toBe('/')
  })
})
