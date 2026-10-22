import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { applyTuiPreset, resolveTuiPreset, SessionPresetQueue } from '../src/preset-lifecycle'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('TUI preset resolution', () => {
  it('asks the roster to resolve its configured default', async () => {
    const resolve = vi.fn(async () => ({ id: 'fixture-default' }))
    const ctx = { get: vi.fn(() => ({ resolve })) } as unknown as Context

    const result = await resolveTuiPreset(ctx)

    expect(resolve).toHaveBeenCalledWith(undefined)
    expect(result.kind).toBe('preset')
    if (result.kind === 'preset') expect(result.id).toBe('fixture-default')
  })

  it('permits a rosterless new session but rejects a recorded preset it cannot rebuild', async () => {
    const ctx = { get: vi.fn(() => undefined) } as unknown as Context

    await expect(resolveTuiPreset(ctx)).resolves.toEqual({ kind: 'none' })
    await expect(resolveTuiPreset(ctx, 'recorded')).rejects.toThrow(/recorded/u)
  })
})

describe('SessionPresetQueue', () => {
  it('serializes rapid switches and continues after a rejected operation', async () => {
    const queue = new SessionPresetQueue()
    const sessionId = SessionId('preset-queue')
    const first = deferred()
    const order: string[] = []

    const one = queue.run(sessionId, async () => {
      order.push('one:start')
      await first.promise
      order.push('one:end')
      throw new Error('broken preset')
    })
    const two = queue.run(sessionId, () => { order.push('two'); return 'minimal' })
    const three = queue.run(sessionId, () => { order.push('three'); return 'standard' })

    await Promise.resolve()
    expect(order).toEqual(['one:start'])
    first.resolve()
    await expect(one).rejects.toThrow('broken preset')
    await expect(two).resolves.toBe('minimal')
    await expect(three).resolves.toBe('standard')
    expect(order).toEqual(['one:start', 'one:end', 'two', 'three'])
  })

  it('orders prompt admission against preset selection without a turn-event race', async () => {
    const queue = new SessionPresetQueue()
    const promptFirst = SessionId('prompt-first')
    const switchFirst = SessionId('switch-first')
    const emptyEvents = []

    const admitted = queue.run(promptFirst, () => { queue.claimPrompt(promptFirst) })
    const locked = queue.run(promptFirst, () => queue.presetLocked(promptFirst, emptyEvents))
    expect(await locked).toBe(true)
    await admitted

    const unlocked = queue.run(switchFirst, () => queue.presetLocked(switchFirst, emptyEvents))
    const laterPrompt = queue.run(switchFirst, () => { queue.claimPrompt(switchFirst) })
    expect(await unlocked).toBe(false)
    await laterPrompt
    expect(queue.presetLocked(switchFirst, emptyEvents)).toBe(true)

    queue.forget(switchFirst)
    expect(queue.presetLocked(switchFirst, emptyEvents)).toBe(false)
  })

  it('locks from durable turn/start even without a local prompt claim', () => {
    const queue = new SessionPresetQueue()
    const sessionId = SessionId('resumed-started')

    expect(queue.presetLocked(sessionId, [{
      type: 'turn/start',
      seq: 0,
      time: 1,
      data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } },
    }])).toBe(true)
  })
})


describe('preset selection boundaries', () => {
  function setup() {
    const select = vi.fn(async () => {})
    const saveDefault = vi.fn(async () => {})
    const options = {
      registry: { resolve: vi.fn(async () => ({ id: 'minimal' })), select },
      agent: { session: { header: { agentPreset: 'standard' }, snapshotEvents: () => [] } },
      id: 'minimal', isCurrent: () => true, isBusy: () => false, isLocked: () => false, saveDefault,
    } as unknown as Parameters<typeof applyTuiPreset>[0]
    return { options, select, saveDefault }
  }
  it('switches a blank session through select and saves the future default', async () => {
    const { options, select, saveDefault } = setup()
    await expect(applyTuiPreset(options)).resolves.toBe('switched')
    expect(select).toHaveBeenCalledExactlyOnceWith(options.agent, 'minimal')
    expect(saveDefault).toHaveBeenCalledExactlyOnceWith('minimal')
  })
  it('only saves the default for an already started session', async () => {
    const { options, select, saveDefault } = setup()
    options.isLocked = () => true
    await expect(applyTuiPreset(options)).resolves.toBe('saved-default')
    expect(select).not.toHaveBeenCalled()
    expect(saveDefault).toHaveBeenCalledWith('minimal')
  })
  it.each(['busy', 'stale'])('rejects %s before mutation', async kind => {
    const { options, select, saveDefault } = setup()
    options.isBusy = () => kind === 'busy'
    options.isCurrent = () => kind !== 'stale'
    await expect(applyTuiPreset(options)).rejects.toThrow()
    expect(select).not.toHaveBeenCalled()
    expect(saveDefault).not.toHaveBeenCalled()
  })
  it('checks ownership again after asynchronous resolution', async () => {
    const { options, select, saveDefault } = setup()
    let current = true
    options.isCurrent = () => current
    options.registry.resolve = vi.fn(async () => { current = false; return { id: 'minimal' } }) as typeof options.registry.resolve
    await expect(applyTuiPreset(options)).rejects.toThrow('Session changed')
    expect(select).not.toHaveBeenCalled()
    expect(saveDefault).not.toHaveBeenCalled()
  })
  it('does not save a default when official selection fails', async () => {
    const { options, select, saveDefault } = setup()
    select.mockRejectedValueOnce(new Error('host rejected'))
    await expect(applyTuiPreset(options)).rejects.toThrow('host rejected')
    expect(saveDefault).not.toHaveBeenCalled()
  })
  it('reports partial success truthfully if persistence fails', async () => {
    const { options, saveDefault } = setup()
    saveDefault.mockRejectedValueOnce(new Error('read only'))
    await expect(applyTuiPreset(options)).rejects.toThrow('Preset applied, but default was not saved')
  })
})
