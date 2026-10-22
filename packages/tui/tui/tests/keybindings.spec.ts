import { describe, it, expect } from 'vitest'
import { KeybindingResolver, parseKeybindings } from '../src/keybindings'
const config = (bindings: Record<string,string|null>) => parseKeybindings(JSON.stringify({bindings:[{context:'Chat',bindings}]}))
describe('custom keybindings', () => {
  it('overrides shortcuts, unbinds and leaves pasted/IME strings intact', () => {
    const resolver = new KeybindingResolver(), c = config({'ctrl+j':'chat:submit',enter:null})
    expect(resolver.resolve(c,'Chat','j',{ctrl:true})).toEqual({input:'',key:{return:true}})
    expect(resolver.resolve(c,'Chat','',{return:true})).toBeNull()
    expect(resolver.resolve(c,'Chat','j',{ctrl:true,eventType:'release'})).toBeNull()
    expect(resolver.resolve(c,'Chat','中文🌏',{})).toEqual({input:'中文🌏',key:{}})
    expect(resolver.resolve(c,'Protected','j',{ctrl:true})).toEqual({input:'j',key:{ctrl:true}})
  })
  it('handles chords, repeated prefixes, timeout and unmatched tails without eating text', () => {
    const resolver = new KeybindingResolver(), c = config({'ctrl+k ctrl+k':'chat:newline'})
    expect(resolver.resolve(c,'Chat','k',{ctrl:true},0)).toBeNull()
    expect(resolver.resolve(c,'Chat','k',{ctrl:true},100)).toEqual({input:'',key:{return:true,shift:true}})
    resolver.resolve(c,'Chat','k',{ctrl:true},200)
    expect(resolver.resolve(c,'Chat','文',{},300)).toEqual({input:'文',key:{}})
    resolver.resolve(c,'Chat','k',{ctrl:true},500)
    expect(resolver.resolve(c,'Chat','k',{ctrl:true},2000)).toBeNull()
    expect(resolver.resolve(c,'Chat','',{escape:true},2100)).toBeNull()
  })
  it('rejects unknown actions, contexts, reserved interrupts and invalid key names', () => {
    expect(()=>config({'ctrl+c':null})).toThrow('reserved')
    expect(()=>config({'ctrl+unknown':'chat:submit'})).toThrow('Invalid')
    expect(()=>config({'ctrl+j':'tool:approve'})).toThrow('Unknown')
    expect(()=>parseKeybindings('{"bindings":[{"context":"Approval","bindings":{}}]}')).toThrow('contexts')
  })
})

it('diagnoses duplicate bindings and conflicting chord prefixes', () => {
 const parsed=parseKeybindings(JSON.stringify({bindings:[{context:'Chat',bindings:{'ctrl+k':'chat:submit','ctrl+k ctrl+s':'chat:newline'}},{context:'Chat',bindings:{'ctrl+k':'chat:cancel'}}]}))
 expect(parsed.warnings?.some(message=>message.includes('duplicate'))).toBe(true)
 expect(parsed.warnings?.some(message=>message.includes('ambiguous'))).toBe(true)
 expect(()=>config({'ctrl+j':'constructor'})).toThrow('Unknown')
})

it('isolates panel navigation from Chat/Global actions and resets cross-context chords', () => {
 const parsed=parseKeybindings(JSON.stringify({bindings:[
  {context:'Global',bindings:{'ctrl+j':'app:exit'}},
  {context:'Chat',bindings:{'ctrl+k ctrl+j':'chat:submit'}},
  {context:'Settings',bindings:{'ctrl+j':'panel:down','ctrl+k':'panel:up'}},
  {context:'SessionPicker',bindings:{'ctrl+j':'panel:pageDown'}}
 ]}))
 const resolver=new KeybindingResolver()
 expect(resolver.resolve(parsed,'Chat','k',{ctrl:true})).toBeNull()
 expect(resolver.resolve(parsed,'Settings','j',{ctrl:true})).toEqual({input:'',key:{downArrow:true}})
 expect(resolver.resolve(parsed,'SessionPicker','j',{ctrl:true})).toEqual({input:'',key:{pageDown:true}})
 expect(resolver.resolve(parsed,'Protected','j',{ctrl:true})).toEqual({input:'j',key:{ctrl:true}})
 for(const action of ['app:exit','chat:submit','chat:permissions']) expect(()=>parseKeybindings(JSON.stringify({bindings:[{context:'Settings',bindings:{'ctrl+j':action}}]}))).toThrow(/navigation/)
 expect(()=>config({'ctrl+j':'panel:down'})).toThrow(/Panel actions/)
})
