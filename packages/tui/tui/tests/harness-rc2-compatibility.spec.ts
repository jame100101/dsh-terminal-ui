import { describe, expect, it } from 'vitest'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'

describe('official rc.2 plugin compatibility contract', () => {
  it('honors an explicit host engine requirement before legacy runtime peers', () => {
    expect(evaluatePluginCompatibility({ name: 'compatibility-fixture', version: '1.0.0', engines: { dsh: '0.2.1-rc.2' }, peerDependencies: { '@deepseek-ai/dsh-agent': '0.2.1-alpha.3' } }, {}, '0.2.1-rc.2')).toBeUndefined()
  })
  it('rejects an incompatible host engine without silently granting an exemption', () => {
    const result = evaluatePluginCompatibility({ name: 'compatibility-fixture', version: '1.0.0', engines: { dsh: '0.2.1-alpha.3' } }, {}, '0.2.1-rc.2')
    expect(result?.requirements).toEqual({ 'engines.dsh': '0.2.1-alpha.3' })
    expect(result?.exempted).toBe(false)
  })
  it('still rejects incompatible legacy peers when no engine requirement overrides them', () => {
    const result = evaluatePluginCompatibility({ name: 'compatibility-fixture', version: '1.0.0', peerDependencies: { '@deepseek-ai/dsh-agent': '0.2.1-alpha.3' } }, {}, '0.2.1-rc.2')
    expect(result?.requirements).toEqual({ '@deepseek-ai/dsh-agent': '0.2.1-alpha.3' })
    expect(result?.exempted).toBe(false)
  })
})
