// Public MIT-licensed declarative assets from @deepseek-ai/dsh-web-app@0.2.1-rc.2.
// No Harness runtime is copied. Scheduling needs the browser Connection service;
// disable only that unavailable capability in this terminal composition.
export const PRESET_NAMES = ['standard', 'ptc', 'minimal', 'cordis']
export function terminalPresetSource(source) {
  return source.replace(/(          - id: tool-schedule\r?\n            name: '@deepseek-ai\/dsh-tool-schedule')/g, '$1\n            disabled: true')
}
