/**
 * The Ink 7 terminal renderer, restructured after the DamnatioX TypeScript
 * TUI: a fixed-height root Box (full-screen frames, so Ink always takes its
 * whole-screen clear path), a transcript viewport driven by a bottom-anchored
 * scroll offset with mouse-wheel/paging input parsed straight from Ink's
 * input stream, a wrapping `›` composer whose caret is anchored through
 * Ink's own `useCursor`/`measureElement` (no manual CUP writes), and the dsh
 * extras layered in: render-intent tool cards, retry rows, markdown runs,
 * the Web-stats strip, slash picker, panels, and approval takeovers.
 * @module @deepseek-ai/dsh-tui/src/render
 */

import React, { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { resolve } from 'node:path'
import {
  Box, Text, measureElement, render, useAnimation, useApp, useCursor, useInput, usePaste, useStdout,
} from 'ink'
import type { DOMElement, Key } from 'ink'
import stringWidth from 'string-width'
import { projectCallCard, projectResultCard } from './card-project'
import { csiTailKey, escapeArbiter, syntheticKey } from './csi-arbiter'
import { formatCostUsd } from './deepseek-cost'
import { PermissionCycleGate } from './permission-cycle'
import {
  DISABLE_WHEEL_MOUSE, ENABLE_WHEEL_MOUSE, parseMouseReport, parseMouseWheel, scrollOffsetForWheel, stripMouseReports,
} from './mouse'
import { busyStarFrame, BUSY_STAR_INTERVAL_MS, QUIET_BUSY_STAR_INTERVAL_MS } from './busy-star'
import { RESTORE_CURSOR_STYLE, cursorStyleForBusy } from './cursor-style'
import { fitDockLine, goalDockLine, todoDockLine } from './status-color'
import type { PluginToggleResult } from './plugin-toggle-runtime'
import { formatStats, helpText, localizeFoldStatus, markdownLines, retryCountdownSeconds, welcomeBlock, wrapRuns, fitStatsStrip } from './plain'
import { welcomeBanner } from './welcome-banner'
import type { MdRun } from './plain'
import { sanitizeTerminalText } from './sanitize'
import {
  buildJobsRows, buildPluginConfigRows, buildSessionRows, buildSettingsRows, buildSubagentRows, buildWorkflowRows, SETTINGS_PAGES,
} from './settings-data'
import type { PanelRow, SettingsPageId } from './settings-data'
import {
  cycleSettingsPage, filterSettingsRows, hitSettingsTab, SETTINGS_CHROME_ROWS, settingsChromeHit, settingsHintText,
  settingsListIndex, settingsSearchText, settingsTabCell, settingsTabLabels,
} from './settings-chrome'
import type { TuiSnapshot, TuiStore } from './store'
import type { TuiNode } from './types'
import {
  composerGlyphAt, composerOffsetForVerticalMove, composerTextPaintWidth, composerTextWrapWidth,
  composerVisibleRowCount, lineSelectableWidth, nextCodePointBoundary,
  previousCodePointBoundary, COMPOSER_PROMPT_WIDTH,
  rememberTranscriptWindow, scrollOffsetForScrollbarRow, selectComposerLayout, selectPanelViewport,
  selectScrollbar, selectTerminalFrameWidth, selectTranscriptBlocksWindow,
  selectTranscriptViewport, transcriptCellAt, transcriptLineAtRow, TRANSCRIPT_LINE_OVERSCAN,
  exclusivePrefixSums, nodeIndexAtLine,
} from './viewport'
import type { TranscriptLine } from './viewport'
import { copyToClipboard, pasteFromClipboard } from './clipboard'
import { MAX_FOLD_NODES, MAX_TRACE } from './fold'
import { atTokenRange, listWorkspaceMentions, readWorkspaceDir, replaceAtToken } from './file-mention'
import { extractCopyText, resolveCopyTarget } from './copy-text'
import {
  attachmentsForSubmit, classifyPastedImagePaths, classifyPastedPath, formatByteSize, imageChipDeletionRange, insertImageChip,
  modelRouteAcceptsImages, stripImageChips,
} from './image-intake'
import {
  createPastedTextBlock, expandPastedTextBlocks, pastedTextDeletionRange,
  retainPastedTextBlocks, shouldCollapsePastedText,
} from './pasted-text'
import type { PastedTextBlock } from './pasted-text'
import {
  extractSelectedText, glyphSpanAt, selectionFromGlyphs, selectionIsDrag, selectionSpanOnLine, sliceDisplayParts,
} from './selection'
import type { GlyphAnchor, TextSelection } from './selection'
import { padEndDisplay, projectLiveThinkingTail, wrapDisplayLines, wrapLiveAssistantText } from './wrap'
import type { LiveThinkingTailState, LiveWrapState } from './wrap'

const MAX_POPUP_ITEMS = 8
const CTRL_C_EXIT_WINDOW_MS = 2_000
const MAX_TURN_INPUT_BYTES = 900_000
/** Replaced with a positioned full block by the patched Ink serializer. */
const SCROLLBAR_ANCHOR_GLYPH = '\uE000'
/** Cap on wrapped tool-card body rows: a giant card must not flood the frame. */
const MAX_TOOL_CARD_ROWS = 400
/** Lines one select-edge tick scrolls the transcript by. */
const SELECT_SCROLL_LINES = 2
/** Interval while the pointer stays against the transcript edge during a drag. */
const SELECT_SCROLL_MS = 40
/** Shared grapheme iterator for display-cell-safe one-line truncation. */
const DISPLAY_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** UI chrome language. */
type Locale = 'zh' | 'en'

function assertNever(value: never): never {
  throw new Error(`unreachable variant: ${String(value)}`)
}

/** Chrome copy keys (transcript content stays model/user-owned). */
interface Copy {
  idle: string
  busyCancel: string
  queued: string
  historyPaused: string
  plan: string
  planPending: string
  placeholder: string
  credentialPlaceholder: string
  secretPlaceholder: string
  numberPlaceholder: string
  stringPlaceholder: string
  paletteTitle: string
  paletteHint: string
  skillPaletteTitle: string
  skillPaletteHint: string
  filePaletteTitle: string
  filePaletteHint: string
  fileDir: string
  fileFile: string
  noMatch: string
  approval: string
  allowOnce: string
  deny: string
  approvalHint: string
  questionHint: string
  questionInput: string
  goalDock: string
  todoDock: string
  queueDock: string
  thinking: string
  generating: string
  callingTools: string
  awaiting: string
  turn: string
  effort: string
  effortChanged: (effort: string) => string
  effortUsage: string
  contextTitle: (producer: string) => string
  cardTruncated: string
  retryIn: (seconds: number) => string
  retryFired: string
  retryWaiting: string
  retryFailureCode: string
  retryDelay: string
  goalActive: string
  goalPaused: string
  goalBlocked: (reason: string) => string
  goalComplete: string
  todoInProgress: (count: number) => string
  todoPendingCount: (count: number) => string
  todoCompleteCount: (count: number) => string
  attachCount: (count: number) => string
  goalNone: string
  goalDetail: (revision: number, phase: string, rounds: number, max: number) => string
  goalObjective: string
  goalBlockedLine: (code: string, message: string) => string
  goalCreated: (created: string, updated: string) => string
  renameUsage: string
  renameDone: (title: string) => string
  workspaceUsage: string
  workspaceDone: (path: string) => string
  attachUsage: string
  attachDone: (path: string) => string
  imageUsage: string
  imageModelRefused: string
  imagePreview: (chip: string, name: string, width: number, height: number, bytes: string) => string
  clipboardNoImage: string
  forkUsage: string
  forkDone: string
  inputTooLarge: (bytes: number, max: number) => string
  busyEnterChanged: (next: string) => string
  thinkingChanged: (next: string) => string
  localeChanged: (next: string) => string
  modelDefault: (model: string) => string
  effortDefault: (effort: string) => string
  credentialReadOnly: (ref: string) => string
  credentialWritten: (ref: string) => string
  credentialWriteFailed: (error: string) => string
  credentialRemoved: (ref: string) => string
  credentialRemoveFailed: (error: string) => string
  killJobRequested: (id: string) => string
  resumeDone: (id: string) => string
  presetSwitched: (id: string) => string
  pluginTogglePending: (id: string) => string
  pluginToggleBusy: (id: string) => string
  pluginToggled: (id: string, enabled: boolean) => string
  pluginToggleFailed: (id: string, result: Exclude<PluginToggleResult, { ok: true }>) => string
  invalidNumber: string
  fieldUpdated: (field: string) => string
  cancelRequested: string
  exitHint: string
  effortOff: string
  permissionChip: (label: string) => string
  permissionHint: string
  backToBottom: string
  copyUsage: string
  copyEmpty: string
  copyRange: (n: string, total: number) => string
  copyDone: string
  copyFailed: (reason: string) => string
  resumeProgress: (done: number, total: number) => string
  resumeCancel: string
  rateUsage: string
  rateRange: (n: number, total: number) => string
  rateDone: (rating: string, n: number) => string
}

/** The chrome copy table. */
const COPY: Record<Locale, Copy> = {
  zh: {
    idle: '▣ idle · Enter 发送 · /help',
    busyCancel: '· Esc 取消',
    queued: 'queued',
    historyPaused: 'history paused · PgDn 继续',
    plan: '◈ plan',
    planPending: '◈ plan…',
    placeholder: '输入任务，或输入 /help 查看命令…',
    credentialPlaceholder: '输入凭据新值（不回显）',
    secretPlaceholder: '输入新值（不回显）',
    numberPlaceholder: '输入数字，Enter 提交',
    stringPlaceholder: '输入新值，Enter 提交',
    paletteTitle: '╭─ 命令（↑↓ 选择 · Enter 执行 · Tab 补全 · Esc 取消）',
    paletteHint: '╰─ ↑↓ 选择 · Enter 执行 · Tab 补全 · Esc 关闭',
    skillPaletteTitle: '╭─ Skills（↑↓ 选择 · Enter 插入 · Esc 返回）',
    skillPaletteHint: '╰─ 选择后输入参数，Enter 调用',
    filePaletteTitle: '╭─ 引用（文件 + 会话 · ↑↓ 选择 · Tab 补全 · Esc 取消）',
    filePaletteHint: '╰─ @引用 · 文件目录带 / · 会话插入耐久引用',
    fileDir: '目录',
    fileFile: '文件',
    noMatch: '  没有匹配项',
    approval: '⚠ 请求工具执行许可：',
    allowOnce: '● Allow once (y)',
    deny: '○ Deny (n)',
    approvalHint: '↑↓ 选择 · Enter/y 允许 · n/Esc 拒绝',
    questionHint: '↑↓ 选择 · Space 多选 · Enter 提交 · Shift+Enter 换行 · Esc 跳过',
    questionInput: '输入回答，Shift+Enter 换行，Enter 提交',
    goalDock: '◈ goal',
    todoDock: 'todo',
    queueDock: '⧗ 排队',
    thinking: 'Thinking',
    generating: 'Generating',
    callingTools: 'Calling tools',
    awaiting: 'Awaiting reply',
    turn: '轮',
    effort: 'effort',
    effortChanged: effort => `推理等级 → ${effort}`,
    effortUsage: '用法：/effort off|low|high|max',
    contextTitle: producer => `◆ 上下文注入 · ${producer}`,
    cardTruncated: '… 卡片过长，已截断显示',
    retryIn: seconds => `${seconds}s 后`,
    retryFired: '已触发',
    retryWaiting: '等待重试',
    retryFailureCode: '失败码',
    retryDelay: '延迟',
    goalActive: '进行中',
    goalPaused: '已暂停',
    goalBlocked: reason => `已阻塞：${reason}`,
    goalComplete: '已完成',
    todoInProgress: count => `${count} 进行中`,
    todoPendingCount: count => `${count} 待办`,
    todoCompleteCount: count => `${count} 已完成`,
    attachCount: count => `📎 ${count} 张图片附件随下一条消息发送`,
    goalNone: '当前会话没有 goal。用 /goal <目标> 创建一个。',
    goalDetail: (revision, phase, rounds, max) => `◈ goal rev ${revision} · ${phase} · round ${rounds}/${max}`,
    goalObjective: '目标：',
    goalBlockedLine: (code, message) => `阻塞原因 [${code}]：${message}`,
    goalCreated: (created, updated) => `创建 ${created} · 更新 ${updated}`,
    renameUsage: '用法：/rename <新标题>',
    renameDone: title => `会话标题 → ${title}`,
    workspaceUsage: '用法：/workspace <目录路径>',
    workspaceDone: path => `工作目录 → ${path}`,
    attachUsage: '用法：/attach <图片路径>（png/jpg/gif/webp）；Windows 截图用 Alt+V',
    attachDone: path => `已附加 ${path}（随下一条消息发送）`,
    imageUsage: '用法：/image [编号]（预览待发送图片；默认最后一张）',
    imageModelRefused: '当前模型不接受图片。请在 /settings models 选择带 · 图 的模型，或在 settings.yaml 声明 input: [text, image]。',
    imagePreview: (chip, name, width, height, bytes) => `${chip} ${name} · ${width}×${height} · ${bytes}`,
    clipboardNoImage: '剪贴板里没有图片（Windows 请用 Alt+V）',
    forkUsage: '用法：/fork 或 /fork <eventSeq>',
    forkDone: '已分叉新会话（/sessions 可见，可恢复）',
    inputTooLarge: (bytes, max) => `输入过大：${bytes} bytes（上限 ${max}）`,
    busyEnterChanged: next => `busyEnter → ${next === 'steer' ? 'Steer 转向' : 'Queue 排队'}`,
    thinkingChanged: next => `thinking 默认显示 → ${next === 'expanded' ? '展开' : '折叠'}`,
    localeChanged: next => `locale → ${next === 'en' ? 'English' : '中文'}`,
    modelDefault: model => `默认模型 → ${model}`,
    effortDefault: effort => `推理等级 → ${effort}`,
    credentialReadOnly: ref => `${ref} 只读：被环境变量等来源遮蔽，无法写入`,
    credentialWritten: ref => `凭据 ${ref} 已写入（值不回显）`,
    credentialWriteFailed: error => `写入失败：${error}`,
    credentialRemoved: ref => `凭据 ${ref} 已移除`,
    credentialRemoveFailed: error => `移除失败：${error}`,
    killJobRequested: id => `已请求杀掉任务 ${id}`,
    resumeDone: id => `已恢复会话 ${id}`,
    presetSwitched: id => `已切换当前会话到预设 ${id}`,
    pluginTogglePending: id => `正在热应用插件 ${id}…`,
    pluginToggleBusy: id => `插件 ${id} 正在热应用，请等待完成`,
    pluginToggled: (id, enabled) => `${id} → ${enabled ? '已开启' : '已关闭'}`,
    pluginToggleFailed: (id, result) => {
      const code = result.code
      switch (code) {
        case 'entry-unavailable': return `${id} 不是当前 profile 中唯一且可写的插件条目`
        case 'surface-owned': return 'TUI 插件承载当前界面，请退出后编辑 profile patch'
        case 'profile-managed': return `${id} 的状态由当前 profile 组合管理`
        case 'conditional': return `${id} 的状态由平台条件表达式控制`
        case 'dependency-blocked': return `存在活跃依赖方，无法操作：${id}${result.blockers?.length === 0 ? '' : ` ← ${result.blockers?.join(', ')}`}`
        case 'apply-failed': {
          const rollback = result.rollback === 'restored'
            ? '；profile patch 已回滚'
            : result.rollback === 'preserved-concurrent-edit'
              ? '；检测到后续文件编辑，已保留该版本'
              : result.rollback === 'failed'
                ? '；profile patch 回滚失败'
                : ''
          return `${id} 热应用失败${rollback}：${result.detail ?? 'Loader 未达到目标状态'}`
        }
        default: return assertNever(code)
      }
    },
    invalidNumber: '请输入有效的数字',
    fieldUpdated: field => `${field} 已更新`,
    cancelRequested: '已请求取消 · 2 秒内再按 Ctrl+C 退出',
    exitHint: '2 秒内再按 Ctrl+C 退出',
    effortOff: 'off',
    permissionChip: label => `权限 ${label}`,
    permissionHint: ' · Shift+Tab 切换',
    backToBottom: '▼ 回到底部',
    copyUsage: '用法：/copy 或 /copy <n>（第 n 条最近的回复）',
    copyEmpty: '没有可复制的回复',
    copyRange: (n, total) => `没有第 ${n} 条最近回复（共 ${total} 条）`,
    copyDone: '已复制',
    copyFailed: reason => `复制失败：${reason}`,
    resumeProgress: (done, total) => `恢复 ${done}/${total}`,
    resumeCancel: '· Esc 取消恢复',
    rateUsage: '用法：/rate up|down [n]（n 为倒数第 n 条助手回复）',
    rateRange: (n, total) => `没有倒数第 ${n} 条可评分回复（共 ${total} 条）`,
    rateDone: (rating, n) => `已更新倒数第 ${n} 条回复的评价：${rating}`,
  },
  en: {
    idle: '▣ idle · Enter send · /help',
    busyCancel: '· Esc cancel',
    queued: 'queued',
    historyPaused: 'history paused · PgDn resume',
    plan: '◈ plan',
    planPending: '◈ plan…',
    placeholder: 'Type a task, or /help for commands…',
    credentialPlaceholder: 'New credential value (not echoed)',
    secretPlaceholder: 'New value (not echoed)',
    numberPlaceholder: 'Enter a number, Enter to submit',
    stringPlaceholder: 'New value, Enter to submit',
    paletteTitle: '╭─ commands (↑↓ select · Enter run · Tab complete · Esc close)',
    paletteHint: '╰─ ↑↓ select · Enter run · Tab complete · Esc close',
    skillPaletteTitle: '╭─ skills (↑↓ select · Enter insert · Esc back)',
    skillPaletteHint: '╰─ select, type arguments, then press Enter',
    filePaletteTitle: '╭─ references (files + sessions · ↑↓ select · Tab complete · Esc close)',
    filePaletteHint: '╰─ @reference · directories keep / · sessions insert durable mentions',
    fileDir: 'directory',
    fileFile: 'file',
    noMatch: '  No matching options',
    approval: '⚠ tool execution request: ',
    allowOnce: '● Allow once (y)',
    deny: '○ Deny (n)',
    approvalHint: '↑↓ select · Enter/y allow · n/Esc deny',
    questionHint: '↑↓ select · Space toggle · Enter submit · Shift+Enter newline · Esc skip',
    questionInput: 'Type an answer; Shift+Enter newline, Enter submit',
    goalDock: '◈ goal',
    todoDock: 'todo',
    queueDock: '⧗ queued',
    thinking: 'Thinking',
    generating: 'Generating',
    callingTools: 'Calling tools',
    awaiting: 'Awaiting reply',
    turn: 'turn',
    effort: 'effort',
    effortChanged: effort => `reasoning effort → ${effort}`,
    effortUsage: 'Usage: /effort off|low|high|max',
    contextTitle: producer => `◆ context injected · ${producer}`,
    cardTruncated: '… card too long, display truncated',
    retryIn: seconds => `in ${seconds}s`,
    retryFired: 'fired',
    retryWaiting: 'waiting',
    retryFailureCode: 'failure code',
    retryDelay: 'delay',
    goalActive: 'active',
    goalPaused: 'paused',
    goalBlocked: reason => `blocked: ${reason}`,
    goalComplete: 'complete',
    todoInProgress: count => `${count} in progress`,
    todoPendingCount: count => `${count} pending`,
    todoCompleteCount: count => `${count} done`,
    attachCount: count => `📎 ${count} image attachment${count === 1 ? '' : 's'} sent with the next message`,
    goalNone: 'This session has no goal. Create one with /goal <objective>.',
    goalDetail: (revision, phase, rounds, max) => `◈ goal rev ${revision} · ${phase} · round ${rounds}/${max}`,
    goalObjective: 'Objective: ',
    goalBlockedLine: (code, message) => `blocked reason [${code}]: ${message}`,
    goalCreated: (created, updated) => `created ${created} · updated ${updated}`,
    renameUsage: 'Usage: /rename <new title>',
    renameDone: title => `session title → ${title}`,
    workspaceUsage: 'Usage: /workspace <directory>',
    workspaceDone: path => `workspace → ${path}`,
    attachUsage: 'Usage: /attach <image path> (png/jpg/gif/webp); Windows screenshots: Alt+V',
    attachDone: path => `attached ${path} (sent with the next message)`,
    imageUsage: 'Usage: /image [number] (preview a pending image; defaults to the last one)',
    imageModelRefused: 'The current model does not accept images. Pick a model marked · image in /settings models, or set input: [text, image] in settings.yaml.',
    imagePreview: (chip, name, width, height, bytes) => `${chip} ${name} · ${width}×${height} · ${bytes}`,
    clipboardNoImage: 'No image on the clipboard (on Windows use Alt+V)',
    forkUsage: 'Usage: /fork or /fork <eventSeq>',
    forkDone: 'Forked a new session (visible in /sessions, resumable)',
    inputTooLarge: (bytes, max) => `input too large: ${bytes} bytes (limit ${max})`,
    busyEnterChanged: next => `busyEnter → ${next === 'steer' ? 'steer' : 'queue'}`,
    thinkingChanged: next => `thinking default → ${next === 'expanded' ? 'expanded' : 'collapsed'}`,
    localeChanged: next => `locale → ${next === 'en' ? 'English' : 'Chinese'}`,
    modelDefault: model => `default model → ${model}`,
    effortDefault: effort => `reasoning effort → ${effort}`,
    credentialReadOnly: ref => `${ref} is read-only: shadowed by an env-var source, cannot write`,
    credentialWritten: ref => `credential ${ref} written (value not echoed)`,
    credentialWriteFailed: error => `write failed: ${error}`,
    credentialRemoved: ref => `credential ${ref} removed`,
    credentialRemoveFailed: error => `remove failed: ${error}`,
    killJobRequested: id => `kill requested for job ${id}`,
    resumeDone: id => `resumed session ${id}`,
    presetSwitched: id => `switched the current session to preset ${id}`,
    pluginTogglePending: id => `Hot-applying plugin ${id}…`,
    pluginToggleBusy: id => `Plugin ${id} is still hot-applying; wait for it to finish`,
    pluginToggled: (id, enabled) => `${id} → ${enabled ? 'enabled' : 'disabled'}`,
    pluginToggleFailed: (id, result) => {
      const code = result.code
      switch (code) {
        case 'entry-unavailable': return `${id} is not one unique writable entry in this profile`
        case 'surface-owned': return 'The TUI plugin owns this screen; exit before editing the profile patch'
        case 'profile-managed': return `${id} is managed by the current profile composition`
        case 'conditional': return `${id} is controlled by a platform condition`
        case 'dependency-blocked': return `Active dependents block this operation: ${id}${result.blockers?.length === 0 ? '' : ` ← ${result.blockers?.join(', ')}`}`
        case 'apply-failed': {
          const rollback = result.rollback === 'restored'
            ? '; the profile patch was rolled back'
            : result.rollback === 'preserved-concurrent-edit'
              ? '; a later file edit was preserved'
              : result.rollback === 'failed'
                ? '; profile patch rollback failed'
                : ''
          return `${id} hot-apply failed${rollback}: ${result.detail ?? 'Loader did not reach the requested state'}`
        }
        default: return assertNever(code)
      }
    },
    invalidNumber: 'Please enter a valid number',
    fieldUpdated: field => `${field} updated`,
    cancelRequested: 'cancel requested · press Ctrl+C again within 2s to exit',
    exitHint: 'press Ctrl+C again within 2s to exit',
    effortOff: 'off',
    permissionChip: label => `permission ${label}`,
    permissionHint: ' · Shift+Tab to switch',
    backToBottom: '▼ back to bottom',
    copyUsage: 'Usage: /copy or /copy <n> (Nth-latest reply)',
    copyEmpty: 'No assistant reply to copy',
    copyRange: (n, total) => `No ${n}-latest reply (${total} available)`,
    copyDone: 'Copied',
    copyFailed: reason => `Copy failed: ${reason}`,
    resumeProgress: (done, total) => `resume ${done}/${total}`,
    resumeCancel: '· Esc cancel resume',
    rateUsage: 'Usage: /rate up|down [n] (n selects the Nth-latest assistant reply)',
    rateRange: (n, total) => `There is no rateable assistant reply #${n} from the end (${total} total)`,
    rateDone: (rating, n) => `Updated the Nth-latest assistant reply (${n}): ${rating}`,
  },
}

const INK_NAMED = /^(?:red|green|yellow|blue|magenta|cyan|white|gray|grey)(?:Bright)?$/

const DARK_PALETTE: Record<string, string> = {
  black: 'whiteBright',
  gray: 'gray',
  grey: 'gray',
  white: 'whiteBright',
  cyan: 'cyan',
  yellow: 'yellowBright',
  green: 'greenBright',
  magenta: 'magentaBright',
  blue: 'blue',
  red: 'redBright',
  whiteBright: 'whiteBright',
  cyanBright: 'cyanBright',
  yellowBright: 'yellowBright',
  greenBright: 'greenBright',
  magentaBright: 'magentaBright',
  blueBright: 'blueBright',
  redBright: 'redBright',
}

const LIGHT_PALETTE: Record<string, string> = {
  black: 'blue',
  gray: 'blue',
  grey: 'blue',
  white: 'blue',
  whiteBright: 'blue',
  cyan: 'blue',
  cyanBright: 'blue',
  yellow: 'yellow',
  yellowBright: 'yellow',
  green: 'green',
  greenBright: 'green',
  red: 'red',
  redBright: 'red',
  blue: 'blue',
  blueBright: 'blue',
  magenta: 'magenta',
  magentaBright: 'magenta',
}

/**
 * Map a TrueColor hex to a named Ink color. Hex on Windows Terminal often
 * paints as black, so banner art must not pass `#rrggbb` through to Ink.
 * @param hex - a `#rrggbb` string.
 * @param theme - active tui theme.
 * @returns a named Ink color.
 */
function namedColorFromHex(hex: string, theme: 'dark' | 'light'): string {
  const fallback = theme === 'light' ? 'blue' : 'whiteBright'
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  const lum = (r * 299 + g * 587 + b * 114) / 1000
  const blueish = b > r + 20 && b > g
  if (lum < 96) return theme === 'light' ? 'blue' : (blueish ? 'blue' : 'whiteBright')
  if (blueish) return theme === 'light' ? 'blue' : 'blueBright'
  return fallback
}

/**
 * Remap one Ink color intent for the active palette.
 * Dark uses bright named ANSI. Hex and `black` never reach Ink: they paint
 * invisible text on Windows Terminal.
 * @param color - the requested color, including hex from banner art.
 * @param theme - active tui theme.
 * @param fallback - used when `color` is empty.
 * @returns a named Ink color.
 */
export function themed(color: string | undefined, theme: 'dark' | 'light', fallback: string): string {
  const raw = color === undefined || color === '' ? fallback : color
  const intent = raw.startsWith('#') ? namedColorFromHex(raw, theme) : raw
  const table = theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE
  const mapped = table[intent] ?? intent
  if (!INK_NAMED.test(mapped)) return theme === 'light' ? 'blue' : 'whiteBright'
  return mapped
}

/**
 * Resolve one transcript line's foreground without remapping exact TrueColor.
 * @param line - transcript foreground intent.
 * @param theme - active TUI theme.
 * @returns the Ink foreground value.
 */
export function resolveTranscriptLineColor(
  line: Pick<TranscriptLine, 'color' | 'exactColor'>,
  theme: 'dark' | 'light',
): string | undefined {
  if (line.color === undefined) return undefined
  return line.exactColor === true ? line.color : themed(line.color, theme, 'white')
}

/** Exact TrueColor for a completed tool row. */
const TOOL_SUCCESS_COLOR = '#7FB77E'

/** Exact TrueColor shared by warning and selected-setting chrome. */
const WARNING_COLOR = '#C9B84A'

/** Exact TrueColor for the model and busy-enter header row. */
const MODEL_MODE_COLOR = '#7F83C6'

/** Exact TrueColor for unrestricted file-policy chrome. */
const FULL_ACCESS_COLOR = '#C75C67'

/** Half-width of the live-Thinking highlight window in cells. */
const SHIMMER_WINDOW = 4

/**
 * One character's grayscale level under the sweeping highlight. The window
 * travels left to right across the label and loops. Pure: one phase per
 * ~100 ms tick.
 * @param index - the character index inside the label.
 * @param phase - the animation phase (increments once per tick).
 * @param length - the label length the window sweeps across.
 * @returns the grayscale level, 0-255.
 */
export function thinkingShimmerLevel(index: number, phase: number, length: number): number {
  const span = length + SHIMMER_WINDOW * 2 + 1
  const center = (phase % span) - SHIMMER_WINDOW
  const t = Math.max(0, Math.min(1, 1 - Math.abs(index - center) / (SHIMMER_WINDOW + 1)))
  const smooth = t * t * (3 - 2 * t)
  return Math.round(145 + 110 * smooth)
}

/**
 * Map a shimmer level to a named Ink color. Hex grayscale paints as black
 * on Windows Terminal, so the original 145–255 sweep becomes gray vs
 * whiteBright.
 * @param level - {@link thinkingShimmerLevel} output.
 * @returns a named Ink color.
 */
export function thinkingShimmerColor(level: number): 'gray' | 'whiteBright' {
  return level >= 200 ? 'whiteBright' : 'gray'
}

const BRAILLE_SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/**
 * Glyph, elapsed suffix, and per-character shimmer runs for a live
 * thinking or compacting header. Pure in `tick` so Transcript can animate
 * without ChatTranscript rebuilding the window.
 * @param kind - which live header to paint.
 * @param tick - 100ms phase.
 * @param since - epoch ms for the thinking elapsed suffix; ignored for compact.
 * @returns display text and colored runs.
 */
export function liveShimmerPaint(
  kind: 'thinking' | 'compact',
  tick: number,
  since?: number,
): { text: string; runs: NonNullable<TranscriptLine['runs']> } {
  const glyph = BRAILLE_SPINNER[tick % BRAILLE_SPINNER.length] ?? '⠋'
  if (kind === 'compact') {
    const label = `${glyph} compacting…`
    return {
      text: label,
      runs: [...label].map((character, index) => ({
        text: character,
        color: thinkingShimmerColor(thinkingShimmerLevel(index, tick, label.length)),
      })),
    }
  }
  const label = `${glyph} Thinking`
  const elapsed = since === undefined ? '' : ` ${((Date.now() - since) / 1000).toFixed(1)}s…`
  return {
    text: `${label}${elapsed}`,
    runs: [
      ...[...label].map((character, index) => ({
        text: character,
        color: thinkingShimmerColor(thinkingShimmerLevel(index, tick, label.length)),
      })),
      ...(elapsed === '' ? [] : [{ text: elapsed, color: 'gray' as const }]),
    ],
  }
}

/** Structured-trajectory palette: model blue, tool activity red, user cyan. */
export function traceLineColor(text: string): 'blue' | 'red' | 'cyan' | undefined {
  if (text.startsWith('· assistant')) return 'blue'
  if (text.startsWith('· tool ') || text.startsWith('· result ')) return 'red'
  if (text.startsWith('· user')) return 'cyan'
  return undefined
}

/**
 * The brand glyph leading the header title. The whale is two cells on
 * modern terminals. Dumb TERM and Apple Terminal mishandle that width, so
 * those hosts get a one-cell diamond.
 * @param env - the environment mapping.
 * @returns the glyph.
 */
export function brandGlyph(env: Record<string, string | undefined>): string {
  if (env.TERM === 'dumb') return '✦'
  if (env.TERM_PROGRAM === 'Apple_Terminal') return '✦'
  return '🐋'
}

/**
 * Set the terminal tab/window title through the standard OSC sequence. The
 * previous title is queried first (`ESC[21t`); the report arrives on stdin
 * and is captured for restore on exit. Terminals without title support
 * ignore the writes silently.
 */
function installTerminalTitle(stdout: { write(chunk: string): unknown }, report: { current: string }): () => void {
  stdout.write('\x1b[21t')
  stdout.write('\x1b]0;🐋 DeepSeek Harness\x07')
  return () => {
    if (report.current !== '') stdout.write(`\x1b]0;${report.current}\x07`)
  }
}
/** Result of one host image intake attempt. */
export interface ImageAttachResult {
  /** Localized failure text, or null after the attachment entered the pending list. */
  error: string | null
  /** Stable chip label assigned by the host after a successful append. */
  chip?: string
  /** Clipboard probe found no image; callers may fall back to text paste. */
  empty?: boolean
}

/** Result of atomic admission for a pasted image-file batch. */
export interface ImageAttachBatchResult {
  error: string | null
  /** Host-assigned chips in input order after the whole batch succeeds. */
  chips?: readonly string[]
}

/** One cross-session completion row carrying the official canonical mention. */
export interface SessionReferenceEntry {
  label: string
  mention: string
  cwd?: string
}

/** Persisted or live panel whose data is refreshed on open or polling. */
export type TuiPanelRefreshKind = 'jobs' | 'subagents' | 'sessions'

/** Host callbacks the renderer drives; supplied by the plugin. */
export interface TuiHost {
  submit(text: string, steer: boolean): void
  cancel(): void
  exit(): void
  newSession(): void
  selectModel(provider: string, model: string, reasoningEffort?: string): void
  /** `/effort off|low|high|max`: set or clear the reasoning effort on the current route. */
  setEffort(effort: string | undefined): void
  /** Shift+Tab: rotate the session's file-policy mode; returns the new mode. */
  cycleSandbox(): 'read-only' | 'workspace-write' | 'danger-full-access'
  /** Abort an in-flight session resume fold. */
  cancelResume(): void
  approve(outcome: 'allowed-once' | 'rejected'): void
  answerQuestion(answers: { id: string; selected: string[]; custom?: string }[]): void
  /** Write one `tui` namespace setting (busyEnter / thinking / theme / locale). */
  updateSetting(patch: { busyEnter?: 'queue' | 'steer'; thinking?: 'collapsed' | 'expanded'; theme?: 'dark' | 'light'; locale?: 'zh' | 'en' }): Promise<void>
  /** Durably store one credential; the renderer never sees the previous value. */
  setCredential(ref: string, value: string): Promise<void>
  /** Remove one credential from the managed store. */
  unsetCredential(ref: string): Promise<void>
  /** Reload only the panel whose data is opening or polling. */
  refreshPanels(kind: TuiPanelRefreshKind): void
  /** Reload the /settings page data (settings panel open). */
  refreshSettings(): void
  /** Persist and hot-apply one host plugin's enabled state. */
  togglePlugin(id: string): Promise<PluginToggleResult>
  /** Request one running job to stop. */
  killJob(id: string): void
  /** Create/replace/remove feedback for one assistant message (toggle on re-rate). */
  rateMessage(messageId: string, rating: 'positive' | 'negative'): Promise<string | null>
  /** Resume one persisted session onto the surface (null on success). */
  resumeSession(sessionId: string): Promise<string | null>
  /** Recompose the blank live session from one agent preset (null on success). */
  switchPreset(presetId: string): Promise<string | null>
  /** Write one field of a plugin's settings namespace (null on success). */
  updatePluginConfig(ns: string, patch: Record<string, unknown>): Promise<string | null>
  /** Rename the live session (explicit user title). */
  renameSession(title: string): Promise<string | null>
  /** Switch the workspace directory for this and future sessions. */
  changeWorkspace(path: string): Promise<string | null>
  /** Discover other sessions for the trailing `@token`. */
  listSessionReferences(query: string): Promise<readonly SessionReferenceEntry[]>
  /** Attach one image file to the next user message. */
  attachFile(path: string): Promise<ImageAttachResult>
  /** Attach an ordered image-file batch without partially admitting it. */
  attachFiles(paths: readonly string[]): Promise<ImageAttachBatchResult>
  /** Attach a bitmap from the desktop clipboard (Windows: Alt+V). */
  attachClipboardImage(): Promise<ImageAttachResult>
  /** Drop pending images whose chips disappeared and return renumbered chip text. */
  syncImageChips(previousDraft: string, nextDraft: string): string
  /** Fork the session at the last completed turn (or the turn containing atSeq). */
  forkSession(atSeq?: number): Promise<string | null>
  /** Boot-time panel request: open this panel (with an optional filter) once the app mounts. */
  startup?: { panel?: { kind: PanelKind; filter?: string } }
}

/**
 * Chinese descriptions for the host slash commands (their packages publish
 * English-only descriptions); display-layer only — execution is untouched.
 */
const HOST_COMMAND_ZH: Record<string, string> = {
  goal: '设置或查看长期任务的 goal',
  plan: '进入或退出 plan 模式',
  compact: '压缩较早的对话历史',
  feedback: '记录对本次会话的反馈',
  permission: '设置命令权限预设',
  export: '下载本会话日志（ZIP 归档）',
}

interface PaletteItem {
  name: string
  description: string
  needsArgs: boolean
  /** Display label; command rows default to `/<name>`. */
  label?: string
  /** Complete command executed when this finite option is selected. */
  command?: string
  /** Replace the composer draft (file mentions) instead of running a command. */
  insert?: string
  /** React identity when two candidate domains share a display name. */
  key?: string
}

/** The `dsh` slash catalog: host commands plus TUI-local commands. */
function localCommands(locale: Locale): PaletteItem[] {
  const zh = locale === 'zh'
  return [
    { name: 'help', description: zh ? '显示帮助' : 'show this help', needsArgs: false },
    { name: 'clear', description: zh ? '清空显示（保留会话）' : 'clear the display (session kept)', needsArgs: false },
    { name: 'copy', description: zh ? '复制最近一条回复（/copy n 为第 n 条最近回复）' : 'copy the latest assistant reply (/copy n = Nth-latest)', needsArgs: true },
    { name: 'rate', description: zh ? '评价最近一条助手回复（up/down，可指定倒数第 n 条）' : 'rate the latest assistant reply (up/down, optional Nth-latest)', needsArgs: true },
    { name: 'trajectory', description: zh ? '切换结构化轨迹视图' : 'toggle the structured trajectory view', needsArgs: false },
    { name: 'model', description: zh ? '选择模型' : 'pick a model', needsArgs: false },
    { name: 'settings', description: zh ? '设置（Tab / 点击切换分页）' : 'settings (Tab / click to switch pages)', needsArgs: false },
    { name: 'skills', description: zh ? '选择当前 agent 可调用的 skill' : 'choose a skill available to the current agent', needsArgs: false },
    { name: 'jobs', description: zh ? '后台任务面板（Enter 杀掉选中任务）' : 'background jobs panel (Enter kills the selected job)', needsArgs: false },
    { name: 'subagents', description: zh ? '子代理树面板' : 'subagent tree panel', needsArgs: false },
    { name: 'workflows', description: zh ? 'workflow 运行进度面板' : 'workflow run progress panel', needsArgs: false },
    { name: 'sessions', description: zh ? '列出活动会话' : 'list live sessions', needsArgs: false },
    { name: 'presets', description: zh ? '切换 agent 预设（设置页）' : 'switch the agent preset (settings page)', needsArgs: false },
    { name: 'effort', description: zh ? '设置推理力度（off/low/high/max）' : 'set the reasoning effort (off/low/high/max)', needsArgs: true },
    { name: 'goal', description: zh ? '查看当前 goal 详情' : 'current goal details', needsArgs: false },
    { name: 'rename', description: zh ? '重命名当前会话标题' : 'rename the current session title', needsArgs: true },
    { name: 'workspace', description: zh ? '切换工作目录' : 'switch the workspace directory', needsArgs: true },
    { name: 'attach', description: zh ? '附加图片到下一消息（png/jpg/gif/webp）' : 'attach an image to the next message (png/jpg/gif/webp)', needsArgs: true },
    { name: 'image', description: zh ? '预览待发送图片的名称、尺寸和大小' : 'preview pending image metadata', needsArgs: true },
    { name: 'fork', description: zh ? '在最后完成回合处分叉会话' : 'fork the session at the last completed turn', needsArgs: false },
    { name: 'new', description: zh ? '开始新会话' : 'start a new session', needsArgs: false },
    { name: 'quit', description: zh ? '保存并退出' : 'save and exit', needsArgs: false },
  ]
}

/** Keep the tail of one line within a display width (DamnatioX `shorten`). */
function shorten(value: string, width: number): string {
  const safe = sanitizeTerminalText(value)
  if (width < 2 || stringWidth(safe) <= width) return safe
  // Cut from the FRONT by display cells: a code-unit slice would let
  // double-width CJK glyphs overshoot the budget.
  let used = 0
  const characters = [...safe]
  let start = 0
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const next = Math.max(1, stringWidth(characters[index] ?? ''))
    if (used + next > width - 1) break
    used += next
    start = index
  }
  return `…${characters.slice(start).join('')}`
}

/** Hard-wrap one source line by terminal cell width. */
function wrapText(text: string, width: number): string[] {
  return wrapDisplayLines(text, width)
}

/** Word-aware hard wrap for prose: breaks on spaces, only over-long words break by cells. */
function wrapTextWords(text: string, width: number): string[] {
  const lines: string[] = []
  for (const source of text.split('\n')) {
    const words = source.split(/\s+/).filter(word => word !== '')
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    let currentWidth = 0
    for (const word of words) {
      const wordWidth = stringWidth(word)
      if (current === '') {
        if (wordWidth > width) {
          lines.push(...wrapText(word, width))
          continue
        }
        current = word
        currentWidth = wordWidth
        continue
      }
      if (currentWidth + 1 + wordWidth <= width) {
        current += ` ${word}`
        currentWidth += 1 + wordWidth
      } else {
        lines.push(current)
        current = ''
        currentWidth = 0
        if (wordWidth > width) lines.push(...wrapText(word, width))
        else {
          current = word
          currentWidth = wordWidth
        }
      }
    }
    if (current !== '') lines.push(current)
  }
  return lines
}

/** Collapsible node kinds: they render a title line plus an optional body. */
function isCollapsible(node: TuiNode): boolean {
  return node.kind === 'context' || node.kind === 'think' || node.kind === 'tool' || node.kind === 'retry'
}

/** Project one node into wrapped, colored lines, honoring expand state. */
function nodeLines(
  node: TuiNode,
  width: number,
  expanded: boolean,
  feedback: ReadonlyMap<string, { rating: 'positive' | 'negative' }> | undefined,
  locale: Locale,
): TranscriptLine[] {
  const copy = COPY[locale]
  const marker = ''
  type NodeLineDraft = {
    text: string
    color?: string
    exactColor?: boolean
    dim?: boolean
    pulse?: boolean
    runs?: MdRun[]
    background?: boolean
  }
  const withKey = (lines: NodeLineDraft[]): TranscriptLine[] =>
    lines.map((line, index) => ({
      key: `${node.kind}-${node.id}-${index}`,
      ...line,
      ...(line.runs !== undefined ? { runs: line.runs } : {}),
      dim: line.dim === true,
      ...(isCollapsible(node) && (line.text.endsWith('▶') || line.text.endsWith('▼'))
        ? {
          disclosureNodeId: node.id,
          disclosureKind: node.kind === 'think' ? 'thinking' as const : 'node' as const,
        }
        : {}),
    }))
  switch (node.kind) {
    case 'user':
      return withKey(wrapText(`${marker}▸ ${sanitizeTerminalText(node.text)}`, width).map(text => ({
        text: padEndDisplay(text, width),
        color: 'white',
        background: true,
      })))
    case 'context': {
      const title = expanded
        ? `${copy.contextTitle(node.producer)} ▼`
        : `${copy.contextTitle(node.producer)} ▶`
      const head = wrapText(marker + title, width).map(text => ({
        text, color: 'gray',
      }))
      const body = expanded
        ? wrapText(sanitizeTerminalText(node.text), width - 2).map(text => ({ text: `  ${text}`, dim: true }))
        : []
      return withKey([...head, ...body])
    }
    case 'assistant': {
      if (node.text === '') return []
      const rating = feedback?.get(node.messageId)?.rating
      const ratingGlyph = rating === 'positive' ? '👍 ' : rating === 'negative' ? '👎 ' : ''
      const lines: { text: string; color?: string; runs?: MdRun[] }[] = []
      let first = true
      for (const md of markdownLines(sanitizeTerminalText(node.text), width)) {
        const interruptMark = node.interrupted === true ? (locale === 'zh' ? '已中断 · ' : 'interrupted · ') : ''
        const prefix = first && md.text !== '' ? `${marker}${ratingGlyph}● ${interruptMark}` : ''
        first = md.text === '' ? first : false
        if (md.runs !== undefined) {
          for (const wrapped of wrapRuns(md.runs, width, prefix)) {
            lines.push({
              text: wrapped.text,
              runs: wrapped.runs,
              ...(md.color !== undefined ? { color: md.color } : {}),
            })
          }
        } else {
          for (const text of wrapText(`${prefix}${md.text}`, width)) {
            lines.push({ text, ...(md.color !== undefined ? { color: md.color } : {}) })
          }
        }
      }
      while (lines.length > 0) {
        const last = lines[lines.length - 1]
        if (last === undefined || last.text !== '' || (last.runs?.length ?? 0) > 0) break
        lines.pop()
      }
      return withKey(lines)
    }
    case 'deliverables':
      return withKey(wrapText(
        `${locale === 'zh' ? '◆ 产出' : '◆ produced'} · ${node.paths.map(path => sanitizeTerminalText(path)).join(' · ')}`,
        width,
      ).map(text => ({ text, color: 'cyan', dim: true })))
    case 'think': {
      const durationLabel = `${(node.durationMs / 1000).toFixed(1)}s`
      const head = wrapText(marker + (expanded ? `✓ Thinking ${durationLabel} ▼` : `✓ Thinking ${durationLabel} ▶`), width).map(text => ({
        text, color: 'gray', dim: !expanded,
      }))
      // The `  │ ` prefix consumes 4 cells and is added AFTER wrapping, so
      // the wrap budget must reserve those 4 cells: wrapping the raw text at
      // width - 2 made each budget-filling segment 2 cells wider than the
      // content area, and Ink's wrap machinery split the row right after the
      // prefix — the vertical bar ended up alone on its row while the text
      // moved to a bare row below it. With the prefix inside the budget,
      // every body row keeps its own bar and never overflows.
      const body = expanded
        ? wrapTextWords(sanitizeTerminalText(node.text), width - 4).map(text => ({ text: `  │ ${text}`, dim: true }))
        : []
      return withKey([...head, ...body])
    }
    case 'tool': {
      const glyph = node.status === 'running' ? '○' : '◇'
      const indent = node.parentCallId === undefined ? '' : '  '
      const title = `${indent}${glyph} ${sanitizeTerminalText(node.detail)}${node.status === 'running' ? ' …' : ` · ${node.status}`} ${expanded ? '▼' : '▶'}`
      const head = wrapText(marker + title, width).map(text => ({
        text,
        color: node.status === 'error' ? 'red' : node.status === 'running' ? 'yellow' : TOOL_SUCCESS_COLOR,
        exactColor: node.status !== 'error' && node.status !== 'running',
      }))
      if (!expanded) return withKey(head)
      const card = node.status === 'running'
        ? projectCallCard(node.callCard as never, node.detail)
        : projectResultCard(node.resultCard as never, node.text, locale)
      const body: { text: string; color?: string; dim?: boolean }[] = []
      let bodyRows = 0
      for (const line of card) {
        if (bodyRows >= MAX_TOOL_CARD_ROWS) break
        for (const text of wrapText(`  ${sanitizeTerminalText(line.text)}`, width - 2)) {
          if (bodyRows >= MAX_TOOL_CARD_ROWS) break
          body.push({
            text,
            ...(line.color !== undefined ? { color: line.color } : {}),
            dim: line.color === undefined || line.color === 'gray',
          })
          bodyRows += 1
        }
      }
      if (bodyRows >= MAX_TOOL_CARD_ROWS) {
        body.push({ text: `  ${copy.cardTruncated}`, dim: true })
      }
      return withKey([...head, ...body])
    }
    case 'retry': {
      const maxLabel = node.maxRetries === null ? '∞' : String(node.maxRetries)
      const remaining = retryCountdownSeconds(node.retryAt, Date.now())
      const waiting = !node.started && remaining !== null
      const title = waiting
        ? `⟳ retry ${node.retry}/${maxLabel} · ${copy.retryIn(remaining)}`
        : `⟳ retry ${node.retry}/${maxLabel} · ${node.started ? copy.retryFired : copy.retryWaiting}`
      const head = wrapText(`${marker}${title} ${expanded ? '▼' : '▶'}`, width).map(text => ({
        text, color: 'gray', dim: waiting ? false : !expanded, pulse: waiting,
      }))
      const body = expanded
        ? wrapText(
          `  │ ${node.provider} · ${node.policyKey} · ${copy.retryFailureCode} ${node.failure.code}${node.failure.status !== undefined ? ` · HTTP ${node.failure.status}` : ''}${node.delayMs > 0 ? ` · ${copy.retryDelay} ${Math.max(0, Math.round(node.delayMs))}ms` : ''}`,
          width - 2,
        ).map(text => ({ text, dim: true }))
        : []
      return withKey([...head, ...body])
    }
    case 'status':
      return withKey(wrapText(`${marker}${node.error ? '×' : '◆'} ${sanitizeTerminalText(localizeFoldStatus(node.text, locale))}`, width).map(text => ({
        text, color: node.error ? 'red' : 'gray', dim: !node.error,
      })))
  }
}

/** Per-node projection variants retained for the viewport-local working set. */
export interface NodeLineCache {
  lines: Map<TuiNode, Map<string, TranscriptLine[]>>
  counts: WeakMap<TuiNode, Map<string, number>>
  recency: TuiNode[]
}

/**
 * Empty viewport-local node projection cache.
 * @returns a cache with no painted rows.
 */
export function createNodeLineCache(): NodeLineCache {
  return { lines: new Map(), counts: new WeakMap(), recency: [] }
}

/** Max projected nodes whose line arrays stay in memory. */
export const MAX_NODE_LINE_CACHE = 256

function nodeLineVariantKey(
  node: TuiNode,
  width: number,
  expanded: boolean,
  feedback: ReadonlyMap<string, { rating: 'positive' | 'negative' }> | undefined,
  locale: Locale,
): string {
  const rating = node.kind === 'assistant' ? feedback?.get(node.messageId)?.rating ?? '' : ''
  return [
    width,
    isCollapsible(node) && expanded ? 1 : 0,
    rating,
    locale,
  ].join(':')
}

function rememberNodeLineCount(cache: NodeLineCache, node: TuiNode, key: string, count: number): void {
  let counts = cache.counts.get(node)
  if (counts === undefined) {
    counts = new Map()
    cache.counts.set(node, counts)
  }
  counts.set(key, count)
}

function touchNodeLineCache(cache: NodeLineCache, node: TuiNode): void {
  cache.recency = cache.recency.filter(entry => entry !== node)
  cache.recency.push(node)
}

/**
 * Drop painted rows until the cache is within {@link MAX_NODE_LINE_CACHE},
 * preferring nodes that are not in `keep`.
 * @param cache - the node projection cache.
 * @param keep - nodes intersecting the current overscan window.
 */
export function pruneNodeLineCache(cache: NodeLineCache, keep: ReadonlySet<TuiNode>): void {
  while (cache.lines.size > MAX_NODE_LINE_CACHE) {
    const victim = cache.recency.find(entry => !keep.has(entry)) ?? cache.recency[0]
    if (victim === undefined) break
    cache.lines.delete(victim)
    cache.recency = cache.recency.filter(entry => entry !== victim)
  }
}

/** Length-only block so off-window nodes do not keep their painted rows in the window walk. */
function sparseCountBlock(count: number): TranscriptLine[] {
  const block: TranscriptLine[] = []
  block.length = Math.max(0, Math.floor(count))
  return block
}

/**
 * Project one node once for a display-affecting input combination.
 * @param cache - the node projection cache.
 * @param node - the immutable transcript node.
 * @param width - wrap width in cells.
 * @param expanded - whether collapsible bodies are open.
 * @param feedback - assistant ratings by message id.
 * @param locale - chrome locale.
 * @returns painted rows for that node.
 */
export function cachedNodeLines(
  cache: NodeLineCache,
  node: TuiNode,
  width: number,
  expanded: boolean,
  feedback: ReadonlyMap<string, { rating: 'positive' | 'negative' }> | undefined,
  locale: Locale,
): TranscriptLine[] {
  const key = nodeLineVariantKey(node, width, expanded, feedback, locale)
  let variants = cache.lines.get(node)
  if (variants === undefined) {
    variants = new Map()
    cache.lines.set(node, variants)
  }
  const cached = variants.get(key)
  if (cached !== undefined) {
    rememberNodeLineCount(cache, node, key, cached.length)
    touchNodeLineCache(cache, node)
    return cached
  }
  const lines = nodeLines(node, width, expanded, feedback, locale)
  // Repeated terminal resizes must not retain an unbounded width history for
  // every transcript node. Expansion normally uses at most two variants.
  if (variants.size >= 8) variants.clear()
  variants.set(key, lines)
  rememberNodeLineCount(cache, node, key, lines.length)
  touchNodeLineCache(cache, node)
  return lines
}

/**
 * Line count for one node, using a stored count when the variant is known.
 * @param cache - the node projection cache.
 * @param node - the immutable transcript node.
 * @param width - wrap width in cells.
 * @param expanded - whether collapsible bodies are open.
 * @param feedback - assistant ratings by message id.
 * @param locale - chrome locale.
 * @returns painted row count including none for empty non-user bodies.
 */
export function cachedNodeLineCount(
  cache: NodeLineCache,
  node: TuiNode,
  width: number,
  expanded: boolean,
  feedback: ReadonlyMap<string, { rating: 'positive' | 'negative' }> | undefined,
  locale: Locale,
): number {
  const key = nodeLineVariantKey(node, width, expanded, feedback, locale)
  const hit = cache.counts.get(node)?.get(key)
  if (hit !== undefined) return hit
  return cachedNodeLines(cache, node, width, expanded, feedback, locale).length
}

/** Three-row compact header plus a separator (DamnatioX header geometry). */
const Header = React.memo(function Header(props: {
  snapshot: ReturnType<TuiStore['getSnapshot']>
  width: number
  theme: 'dark' | 'light'
}): React.ReactElement {
  const snapshot = props.snapshot
  const thinking = snapshot.settings?.general.thinking === 'expanded' ? 'on' : 'off'
  const busyEnter = snapshot.settings?.general.busyEnter ?? 'queue'
  const brand = `${brandGlyph(process.env)} DSH-TUI`
  // Both sides budget against the PHYSICAL width: an overflowing side would
  // wrap onto the next row and corrupt the frame on narrow windows.
  const sessionRight = `session ${snapshot.sessionId}`
  const rows: { left: { text: string; color?: string; exactColor?: boolean; bold?: boolean }; right: string }[] = [
    {
      left: { text: brand, color: 'cyan', bold: true },
      right: fitDisplayText(sessionRight, Math.max(6, props.width - stringWidth(brand) - 2)),
    },
    {
      left: { text: shorten(snapshot.cwd, Math.max(4, props.width - stringWidth(`thinking ${thinking}`) - 2)) },
      right: `thinking ${thinking}`,
    },
    {
      left: { text: shorten(`${snapshot.model} · busyEnter ${busyEnter}`, Math.max(4, props.width - stringWidth(`${snapshot.nodes.length} events`) - 2)), color: MODEL_MODE_COLOR, exactColor: true },
      right: `${snapshot.nodes.length} events`,
    },
  ]
  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        const pad = Math.max(1, props.width - stringWidth(row.left.text) - stringWidth(row.right))
        return (
          <Text key={index}>
            <Text color={row.left.exactColor === true && row.left.color !== undefined ? row.left.color : themed(row.left.color, props.theme, 'white')} bold={row.left.bold === true}>
              {row.left.text}
            </Text>
            <Text dimColor>{' '.repeat(pad)}{row.right}</Text>
          </Text>
        )
      })}
      <Text dimColor>{'─'.repeat(Math.max(1, props.width))}</Text>
    </Box>
  )
}, (previous, next) => (
  previous.width === next.width
  && previous.theme === next.theme
  && previous.snapshot.sessionId === next.snapshot.sessionId
  && previous.snapshot.cwd === next.snapshot.cwd
  && previous.snapshot.model === next.snapshot.model
  && previous.snapshot.busy === next.snapshot.busy
  && previous.snapshot.nodes.length === next.snapshot.nodes.length
  && previous.snapshot.settings === next.snapshot.settings
))

/**
 * One already-wrapped row with a highlighted mid-span. Keep every segment in
 * one Ink text layout: exact-width sibling boxes can independently clip or
 * displace glyphs when Windows Terminal repaints a styled selection.
 */
function SelectedLine(props: {
  text: string
  startCol: number
  endCol: number
  color?: string
  bold?: boolean
  dim?: boolean
  /** Composer uses a blue fill; transcript keeps inverse. */
  highlight?: 'inverse' | 'blue'
  /** Explicit cell width so Ink cannot wrap a pre-wrapped row again. */
  lineWidth: number
}): React.ReactElement {
  const { before, mid, after } = sliceDisplayParts(props.text, props.startCol, props.endCol)
  const rest = {
    wrap: 'truncate' as const,
    bold: props.bold === true,
    dimColor: props.dim === true,
    ...(props.color !== undefined ? { color: props.color } : {}),
  }
  const selected = props.highlight === 'blue'
    ? <Text color="white" backgroundColor="blue">{mid}</Text>
    : <Text inverse>{mid}</Text>
  return (
    <Box
      flexDirection="row"
      flexWrap="nowrap"
      height={1}
      overflow="hidden"
      width={Math.max(1, props.lineWidth)}
    >
      <Text {...rest}>
        {before}
        {mid === '' ? null : selected}
        {after}
      </Text>
    </Box>
  )
}

/** The transcript viewport with the browser-style right-edge scrollbar column and the floating back-to-bottom button. */
const Transcript = React.memo(function Transcript(props: {
  lines: readonly TranscriptLine[]
  height: number
  width: number
  offset: number
  /** Full-transcript hidden-from-bottom offset; defaults to the window-relative offset. */
  scrollOffset?: number | undefined
  /** Full transcript line count; defaults to {@link lines}.length. */
  lineCount?: number | undefined
  onMaximumOffsetChange?: ((maximumOffset: number, lineCount: number) => void) | undefined
  theme: 'dark' | 'light'
  locale: Locale
  /** Pin the floating back-to-bottom button when scrolled off the tail. */
  backButton?: boolean | undefined
  /** In-app drag-select range, in absolute transcript line indices. */
  selection?: TextSelection | null | undefined
  /** Absolute index of {@link lines}[0] in the full transcript. */
  windowStart?: number | undefined
}): React.ReactElement {
  const reserved = props.backButton === true ? 1 : 0
  const viewport = selectTranscriptViewport(props.lines, props.height, props.offset, reserved)
  const lineCount = props.lineCount ?? props.lines.length
  const scrollOffset = props.scrollOffset ?? viewport.offset
  const scrollbar = selectScrollbar(lineCount, props.height, scrollOffset, reserved)
  const hasPulse = props.lines.some(line => line.pulse === true)
  const pulse = useAnimation({ interval: 500, isActive: hasPulse })
  const pulseOn = pulse.frame % 2 === 0
  const hasShimmer = viewport.lines.some(line => line.shimmer !== undefined)
  const shimmer = useAnimation({ interval: 100, isActive: hasShimmer })
  const shimmerTick = shimmer.frame
  useEffect(() => {
    const capacity = Math.max(1, Math.max(1, Math.floor(props.height)) - reserved)
    const maximumOffset = Math.max(0, lineCount - capacity)
    props.onMaximumOffsetChange?.(maximumOffset, lineCount)
  }, [props.onMaximumOffsetChange, lineCount, props.height, reserved])
  // The scrollbar lives in its OWN right-edge column (a browser-style strip,
  // never characters appended to content rows): content and gutter render as
  // sibling Boxes, so no line's text width can ever shift, wrap, or break the
  // rail — the gutter stays a perfectly straight line on the last column, and
  // the thumb sits at a stable, clickable position.
  const paintCapacity = Math.max(1, Math.floor(props.height) - reserved)
  const paintWindowOffset = Math.min(viewport.offset, Math.max(0, props.lines.length - paintCapacity))
  const paintSliceStart = Math.max(0, props.lines.length - paintWindowOffset - paintCapacity)
  const paintWindowStart = props.windowStart ?? 0
  return (
    <Box flexDirection="row" flexGrow={1} height={Math.max(1, props.height)} overflow="hidden">
      <Box
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
        paddingX={1}
        justifyContent="flex-end"
      >
        {viewport.lines.map((line, index) => {
          // Index keys: scrolling reorders the visible rows every wheel tick,
          // and keyed reordering through Ink's reconciler can accumulate stale
          // rows — position-keyed rows never move, only their text changes.
          const absoluteIndex = paintWindowStart + paintSliceStart + index
          const painted = line.shimmer !== undefined
            ? liveShimmerPaint(line.shimmer, shimmerTick, line.shimmerSince)
            : { text: line.text, runs: line.runs }
          const span = props.selection === undefined || props.selection === null
            ? null
            : selectionSpanOnLine(
              props.selection,
              absoluteIndex,
              lineSelectableWidth(painted.text),
            )
          const color = resolveTranscriptLineColor(line, props.theme)
          const dim = line.pulse === true ? pulseOn : line.dim === true
          const body = span === null
            ? (
              <Text wrap="truncate" {...(color !== undefined ? { color } : {})} bold={line.bold === true} dimColor={dim}>
                {painted.runs !== undefined && painted.runs.length > 0
                  ? painted.runs.map((run, runIndex) => (
                    <Text key={runIndex} bold={run.bold === true} underline={run.underline === true} dimColor={run.dim === true}
                      {...run.color !== undefined
                        ? { color: run.exactColor === true ? run.color : themed(run.color, props.theme, 'white') }
                        : run.code === true
                          ? { color: themed('cyan', props.theme, 'cyan') }
                          : {}}>
                      {run.text}
                    </Text>
                  ))
                  : (painted.text || ' ')}
              </Text>
            )
            : (
              <SelectedLine
                text={painted.text || ' '}
                startCol={span.start}
                endCol={span.end}
                {...(color !== undefined ? { color } : {})}
                bold={line.bold === true}
                dim={dim}
                lineWidth={Math.max(1, stringWidth(painted.text || ' '))}
              />
            )
          return (
            <Box
              key={index}
              height={1}
              overflow="hidden"
              width="100%"
              {...(line.background === true
                ? { backgroundColor: props.theme === 'dark' ? '#2d2d2d' : 'gray' }
                : {})}
            >
              {body}
            </Box>
          )
        })}
        {props.backButton === true ? (
          <Text key="back-button">
            {' '.repeat(Math.max(0, Math.floor((Math.max(1, props.width - 3) - stringWidth(` ${COPY[props.locale].backToBottom} `)) / 2)))}
            <Text bold inverse color={themed('cyan', props.theme, 'cyan')}>{` ${COPY[props.locale].backToBottom} `}</Text>
          </Text>
        ) : null}
      </Box>
      <Box flexDirection="column" width={1} overflow="hidden">
        {scrollbar.visible
          ? Array.from({ length: Math.max(1, props.height) }, (_, index) => {
            const thumb = index >= scrollbar.thumbTop && index < scrollbar.thumbTop + scrollbar.thumbHeight
            return (
              <Text key={index} dimColor={!thumb} {...(thumb ? { color: themed('cyan', props.theme, 'cyan') } : {})}>
                {SCROLLBAR_ANCHOR_GLYPH}
              </Text>
            )
          })
          : null}
      </Box>
    </Box>
  )
})

/** One full-screen panel row list (settings/jobs/subagents/workflows). */
function PanelView(props: {
  rows: readonly PanelRow[]
  height: number
  offset: number
  selectedIndex: number
  theme: 'dark' | 'light'
}): React.ReactElement {
  const lines: TranscriptLine[] = props.rows.map((row, index) => ({
    key: row.key,
    text: `${index === props.selectedIndex ? '▸ ' : '  '}${row.text}`,
    ...(row.color !== undefined ? { color: row.color } : {}),
    dim: row.dim === true,
  }))
  const viewport = selectPanelViewport(lines, props.height, props.offset)
  return (
    <Box flexDirection="column" flexGrow={1} height={Math.max(1, props.height)} overflow="hidden" paddingX={1}>
      {viewport.lines.map((line, index) => {
        const selected = line.text.startsWith('▸ ')
        return (
          <Text key={index} wrap="truncate">
            <Text
              {...(selected ? { color: WARNING_COLOR } : {})}
              bold={selected}
            >
              {line.text.slice(0, 2)}
            </Text>
            <Text
              color={selected && !line.dim ? WARNING_COLOR : themed(line.dim ? 'gray' : line.color, props.theme, 'white')}
              bold={selected && !line.dim}
              dimColor={line.dim === true}
            >
              {line.text.slice(2)}
            </Text>
          </Text>
        )
      })}
    </Box>
  )
}

/** Claude Code-style search field, tab strip, and key hint above the list. */
function SettingsChrome(props: {
  page: SettingsPageId
  locale: Locale
  theme: 'dark' | 'light'
  width: number
  query: string
}): React.ReactElement {
  const tabs = settingsTabLabels(props.locale)
  return (
    <Box flexDirection="column" width={props.width} paddingX={1}>
      <Text dimColor wrap="truncate">{settingsSearchText(props.locale, props.query)}</Text>
      <Text wrap="truncate">
        {tabs.map((tab) => {
          const active = tab.id === props.page
          return (
            <Text
              key={tab.id}
              inverse={active}
              bold={active}
              dimColor={!active}
              color={themed(active ? 'white' : 'cyan', props.theme, 'cyan')}
            >
              {settingsTabCell(tab.label)}
            </Text>
          )
        })}
      </Text>
      <Text dimColor wrap="truncate">{settingsHintText(props.locale)}</Text>
    </Box>
  )
}

/** Find the first row that performs a panel action. */
function firstActionablePanelRow(rows: readonly PanelRow[]): number | undefined {
  const index = rows.findIndex(row => row.action !== undefined)
  return index < 0 ? undefined : index
}

/** Move between actionable panel rows without landing on headers or help text. */
function movePanelSelection(rows: readonly PanelRow[], current: number, direction: -1 | 1): number {
  const actionable = rows.flatMap((row, index) => row.action === undefined ? [] : [index])
  if (actionable.length === 0) {
    return Math.max(0, Math.min(rows.length - 1, current + direction))
  }
  if (direction < 0) {
    return actionable.findLast(index => index < current) ?? actionable[0] ?? current
  }
  return actionable.find(index => index > current) ?? actionable[actionable.length - 1] ?? current
}

/** The slash picker between transcript and composer (DamnatioX palette style). */
function CommandPaletteView(props: {
  matches: readonly PaletteItem[]
  selectedIndex: number
  width: number
  height: number
  locale: Locale
  theme: 'dark' | 'light'
  title?: string
  hint?: string
}): React.ReactElement {
  const paletteWidth = Math.max(1, Math.floor(props.width))
  const contentWidth = Math.max(1, paletteWidth - 2)
  const items = props.matches
  const copy = COPY[props.locale]
  // The budgeted height owns the rendered rows: title + hint take two, the
  // rest list items — never more, or the rows below get overwritten.
  const itemCapacity = Math.max(0, props.height - 2)
  const start = Math.max(0, Math.min(props.selectedIndex - (itemCapacity - 1), Math.max(0, items.length - itemCapacity)))
  const visibleItems = items.slice(start, start + itemCapacity)
  return (
    <Box flexDirection="column" paddingX={paletteWidth > 2 ? 1 : 0} width={paletteWidth} height={Math.max(1, props.height)} overflow="hidden">
      <Text bold color={themed('cyan', props.theme, 'cyan')} wrap="truncate">{shorten(props.title ?? copy.paletteTitle, contentWidth)}</Text>
      {visibleItems.length === 0
        ? <Text dimColor>{copy.noMatch}</Text>
        : visibleItems.map((command, index) => {
          const absoluteIndex = start + index
          const label = command.label ?? (command.insert !== undefined ? command.name : `/${command.name}`)
          const description = fitDisplayText(sanitizeTerminalText(command.description), Math.max(1, contentWidth - stringWidth(label) - 4))
          return (
            <Box
              key={command.key ?? command.command ?? command.name}
              width={contentWidth}
              height={1}
              flexGrow={0}
              flexShrink={0}
              overflow="hidden"
            >
              <Text
                wrap="truncate"
                color={themed(absoluteIndex === props.selectedIndex ? 'cyan' : 'white', props.theme, 'white')}
                bold={absoluteIndex === props.selectedIndex}
                inverse={absoluteIndex === props.selectedIndex}
              >
                {fitDisplayText(`${absoluteIndex === props.selectedIndex ? '▸' : ' '} ${label}  ${description}`, contentWidth)}
              </Text>
            </Box>
          )
        })}
      <Text dimColor wrap="truncate">{shorten(props.hint ?? copy.paletteHint, contentWidth)}</Text>
    </Box>
  )
}

/** Keep the head of one line within a display width (trailing ellipsis). */
function fitDisplayText(value: string, width: number): string {
  const budget = Math.max(0, Math.floor(width))
  if (budget === 0) return ''
  const safe = sanitizeTerminalText(value).replace(/[\r\n\t]+/gu, ' ')
  if (stringWidth(safe) <= budget) return safe
  const contentBudget = budget - 1
  let used = 0
  let head = ''
  for (const { segment } of DISPLAY_SEGMENTER.segment(safe)) {
    const segmentWidth = stringWidth(segment)
    if (used + segmentWidth > contentBudget) break
    head += segment
    used += segmentWidth
  }
  return `${head}…`
}

/** Cap on composer lines: overflowing text wraps, never steals the frame. */
const MAX_COMPOSER_LINES = 5
/** Prompt on wrap line 0; later wrap rows use the same cell budget. */
const COMPOSER_PROMPT = '›'
const COMPOSER_INDENT = ' '

/** One composer wrap row: a 1-cell prefix plus already-wrapped text. */
function ComposerTextRow(props: {
  prefix: string
  text: string
  /** Painted text box; one cell wider than the wrap budget. */
  paintWidth: number
  dim?: boolean
  highlight?: { startCol: number; endCol: number }
}): React.ReactElement {
  const painted = props.text === '' ? ' ' : props.text
  const highlight = props.highlight
  return (
    <Box
      flexDirection="row"
      flexWrap="nowrap"
      height={1}
      overflow="hidden"
      flexGrow={0}
      flexShrink={0}
      width={COMPOSER_PROMPT_WIDTH + props.paintWidth}
    >
      <Box width={COMPOSER_PROMPT_WIDTH} height={1} flexGrow={0} flexShrink={0} overflow="hidden">
        <Text wrap="truncate" dimColor>{props.prefix}</Text>
      </Box>
      {highlight !== undefined
        ? (
          <SelectedLine
            text={painted}
            startCol={highlight.startCol}
            endCol={highlight.endCol}
            highlight="blue"
            lineWidth={props.paintWidth}
          />
        )
        : (
          <Box width={props.paintWidth} height={1} flexGrow={0} flexShrink={0} overflow="hidden">
            <Text wrap="truncate" dimColor={props.dim === true}>{painted}</Text>
          </Box>
        )}
    </Box>
  )
}

/** Multi-line caret-anchored input: overflowing text wraps onto further lines. */
function ImeTextInput(props: {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string, steer?: boolean) => void
  placeholder: string
  focus: boolean
  width: number
  mask?: string
  /** Shared with App so Ctrl+C copies the composer range instead of cancelling. */
  markOutRef?: React.MutableRefObject<{ anchor: number; head: number } | null>
  /** Bumped to drop the composer highlight (Esc). */
  clearSeq?: number
  /** Bumped when App assigns the draft without going through onChange. */
  valueSeq?: number
  /** Windows Alt+V / macOS-Linux Ctrl/Meta+V image clipboard. */
  onClipboardImage?: (fallbackToText: boolean) => Promise<boolean>
  /** Return replacement text, `''` to consume an image path, or null for ordinary paste. */
  onPasteText?: (text: string) => string | null
}): React.ReactElement {
  const [cursorOffset, setCursorOffset] = useState(props.value.length)
  const cursorOffsetRef = useRef(props.value.length)
  const latestValueRef = useRef(props.value)
  const valueSeqRef = useRef(-1)
  const [localValue, setLocalValue] = useState(props.value)
  const inputRef = useRef<DOMElement | null>(null)
  const [origin, setOrigin] = useState({ x: 0, y: 0, measured: false })
  const [mark, setMark] = useState<{ anchor: number; head: number } | null>(null)
  const markRef = useRef<{ anchor: number; head: number } | null>(null)
  const selectingRef = useRef(false)
  const pressGlyphRef = useRef<{ start: number; end: number } | null>(null)

  useEffect(() => {
    const seq = props.valueSeq ?? 0
    if (seq === valueSeqRef.current) return
    valueSeqRef.current = seq
    latestValueRef.current = props.value
    setLocalValue(props.value)
    cursorOffsetRef.current = props.value.length
    setCursorOffset(props.value.length)
    markRef.current = null
    setMark(null)
    if (props.markOutRef !== undefined) props.markOutRef.current = null
  }, [props.value, props.valueSeq, props.markOutRef])

  const displayValue = props.mask ? props.mask.repeat([...localValue].length) : localValue
  const displayCursorOffset = props.mask
    ? props.mask.length * [...localValue.slice(0, cursorOffset)].length
    : cursorOffset
  const boxWidth = Math.max(1, Math.floor(props.width))
  const paintWidth = composerTextPaintWidth(boxWidth)
  const textWrapWidth = composerTextWrapWidth(boxWidth)
  const wrapWidthRef = useRef(textWrapWidth)
  wrapWidthRef.current = textWrapWidth
  const layout = selectComposerLayout(displayValue, displayCursorOffset, textWrapWidth, MAX_COMPOSER_LINES)
  const composerRanges = layout.ranges
  const measureInputOrigin = useCallback(() => {
    if (inputRef.current === null) return
    const metrics = measureElement(inputRef.current)
    setOrigin(current =>
      current.measured && current.x === metrics.x && current.y === metrics.y
        ? current
        : { x: metrics.x, y: metrics.y, measured: true })
  }, [])
  useLayoutEffect(measureInputOrigin)
  // Ink recalculates Yoga after the resize-driven React commit. Measure once
  // more in the passive phase so the native IME cursor follows a composer
  // that moved vertically even when its own text and width stayed unchanged.
  useEffect(measureInputOrigin)
  const moveCursor = useCallback((nextOffset: number) => {
    cursorOffsetRef.current = nextOffset
    setCursorOffset(nextOffset)
  }, [])

  const publishMark = useCallback((next: { anchor: number; head: number } | null): void => {
    markRef.current = next
    setMark(next)
    if (props.markOutRef !== undefined) props.markOutRef.current = next
  }, [props.markOutRef])

  useEffect(() => {
    if (props.clearSeq === undefined || props.clearSeq === 0) return
    publishMark(null)
  }, [props.clearSeq, publishMark])

  const commitEdit = useCallback(
    (nextValue: string, nextOffset: number) => {
      latestValueRef.current = nextValue
      setLocalValue(nextValue)
      publishMark(null)
      moveCursor(nextOffset)
      props.onChange(nextValue)
    },
    [moveCursor, props.onChange, publishMark],
  )

  const replaceSelection = useCallback((insert: string): void => {
    const currentValue = latestValueRef.current
    const range = markRef.current
    if (range !== null && range.anchor !== range.head) {
      const lo = Math.min(range.anchor, range.head)
      const hi = Math.max(range.anchor, range.head)
      commitEdit(`${currentValue.slice(0, lo)}${insert}${currentValue.slice(hi)}`, lo + insert.length)
      return
    }
    const currentOffset = cursorOffsetRef.current
    commitEdit(`${currentValue.slice(0, currentOffset)}${insert}${currentValue.slice(currentOffset)}`, currentOffset + insert.length)
  }, [commitEdit])

  const replacePaste = useCallback((pasted: string): void => {
    // Clipboard providers use LF, CRLF, or bare CR. Normalize before the
    // general terminal sanitizer removes carriage returns as control bytes.
    const safePaste = sanitizeTerminalText(stripMouseReports(pasted).replace(/\r\n?/gu, '\n'))
    if (!safePaste) return
    const replacement = props.onPasteText?.(safePaste)
    if (replacement === '') return
    replaceSelection(replacement ?? safePaste)
  }, [props.onPasteText, replaceSelection])

  useInput(
    (input, key) => {
      const mouse = parseMouseReport(input)
      if (mouse !== null) {
        if ((mouse.button & 64) !== 0) return
        if (props.mask !== undefined || !origin.measured) return
        const localRow = mouse.row - 1 - origin.y
        const localCol = mouse.column - 1 - origin.x
        const widthNow = wrapWidthRef.current
        const layoutNow = selectComposerLayout(latestValueRef.current, cursorOffsetRef.current, widthNow, MAX_COMPOSER_LINES)
        const paintedRows = layoutNow.visibleLines.length
        if (mouse.action === 'press' && mouse.button === 0) {
          if (localRow < 0 || localCol < 0 || localRow >= paintedRows) {
            publishMark(null)
            return
          }
        } else if (!selectingRef.current) {
          return
        }
        const col = Math.max(0, localCol - COMPOSER_PROMPT_WIDTH)
        const glyph = composerGlyphAt(
          latestValueRef.current,
          widthNow,
          layoutNow.windowStart + Math.max(0, Math.min(localRow, layoutNow.visibleLines.length - 1)),
          col,
        )
        if ((mouse.button & 32) !== 0) {
          const press = pressGlyphRef.current ?? glyph
          const next = {
            anchor: Math.min(press.start, glyph.start),
            head: Math.max(press.end, glyph.end),
          }
          if (next.anchor !== next.head) publishMark(next)
          return
        }
        if (mouse.action === 'press' && mouse.button === 0) {
          selectingRef.current = true
          pressGlyphRef.current = glyph
          publishMark(null)
          return
        }
        if (mouse.action === 'release') {
          selectingRef.current = false
          const press = pressGlyphRef.current
          pressGlyphRef.current = null
          const range = markRef.current
          if (range !== null && range.anchor !== range.head) {
            moveCursor(range.head)
          } else if (press !== null) {
            moveCursor(press.start)
          }
        }
        return
      }
      if (parseMouseWheel(input) !== null) return
      // A bare CSI tail inside a pending-Escape window is the second half of
      // a split arrow sequence, not text: swallow it (App re-synthesizes the
      // key) so it can never pollute the draft.
      if (escapeArbiter.hasPending() && csiTailKey(input) !== null) return
      // A terminal title report (OSC answer to the title query) is metadata,
      // never draft content — swallow both whole and split forms.
      if (input.startsWith(']l') || input.startsWith('\x1b]l')) return
      if (
        key.tab ||
        (key.shift && key.tab) ||
        input === '\x1b[Z' ||
        (key.ctrl && input.toLowerCase() === 'c')
      ) {
        return
      }
      if (key.upArrow || key.downArrow) {
        const currentValue = latestValueRef.current
        if (currentValue === '') return
        const currentOffset = cursorOffsetRef.current
        const nextOffset = composerOffsetForVerticalMove(
          currentValue,
          wrapWidthRef.current,
          currentOffset,
          key.upArrow ? -1 : 1,
        )
        if (key.shift === true) {
          publishMark({ anchor: markRef.current?.anchor ?? currentOffset, head: nextOffset })
        } else {
          publishMark(null)
        }
        moveCursor(nextOffset)
        return
      }
      if (key.ctrl && input.toLowerCase() === 'a') {
        const value = latestValueRef.current
        if (value.length > 0) {
          publishMark({ anchor: 0, head: value.length })
          moveCursor(value.length)
        }
        return
      }
      if (key.ctrl && input.toLowerCase() === 'v') {
        const pasteText = (): void => {
          void pasteFromClipboard().then((text) => {
            if (text === null || text === '') return
            replacePaste(text)
          })
        }
        if (process.platform !== 'win32' && props.onClipboardImage !== undefined) {
          void props.onClipboardImage(true).then((attached) => {
            if (!attached) pasteText()
          })
        } else {
          pasteText()
        }
        return
      }
      // Bracketed paste is the primary path, but some terminal clipboard
      // actions still deliver one ordinary stdin chunk. Route only a chunk
      // that already meets the collapse threshold so IME and rapid typing
      // retain ordinary input semantics.
      if (shouldCollapsePastedText(input)) {
        replacePaste(input)
        return
      }
      if (key.end || (key.ctrl && input.toLowerCase() === 'e')) {
        publishMark(null)
        moveCursor(latestValueRef.current.length)
        return
      }
      if (key.return) {
        if (key.shift === true) {
          replaceSelection('\n')
          return
        }
        props.onSubmit(latestValueRef.current, key.ctrl === true)
        return
      }
      if (key.ctrl) return
      if (key.leftArrow || key.rightArrow) {
        const currentValue = latestValueRef.current
        const currentOffset = cursorOffsetRef.current
        const nextOffset = key.leftArrow
          ? previousCodePointBoundary(currentValue, currentOffset)
          : nextCodePointBoundary(currentValue, currentOffset)
        if (key.shift === true) {
          publishMark({ anchor: markRef.current?.anchor ?? currentOffset, head: nextOffset })
        } else {
          publishMark(null)
        }
        moveCursor(nextOffset)
        return
      }
      if (key.home) {
        publishMark(null)
        moveCursor(0)
        return
      }
      if (key.backspace || key.delete) {
        const range = markRef.current
        if (range !== null && range.anchor !== range.head) {
          replaceSelection('')
          return
        }
        const currentValue = latestValueRef.current
        const currentOffset = cursorOffsetRef.current
        const direction = key.backspace ? 'backspace' : 'delete'
        const chipRange = imageChipDeletionRange(currentValue, currentOffset, direction)
          ?? pastedTextDeletionRange(currentValue, currentOffset, direction)
        if (chipRange !== null) {
          commitEdit(
            `${currentValue.slice(0, chipRange.start)}${currentValue.slice(chipRange.end)}`,
            chipRange.start,
          )
          return
        }
        const edge = direction === 'backspace'
          ? previousCodePointBoundary(currentValue, currentOffset)
          : nextCodePointBoundary(currentValue, currentOffset)
        if (edge !== currentOffset) {
          const start = Math.min(edge, currentOffset)
          const end = Math.max(edge, currentOffset)
          commitEdit(`${currentValue.slice(0, start)}${currentValue.slice(end)}`, start)
        }
        return
      }
      const clipboardImageKey = process.platform === 'win32' ? key.meta : key.meta || key.super
      if (clipboardImageKey && (input === 'v' || input === 'V')) {
        void props.onClipboardImage?.(false)
        return
      }
      const safeInput = sanitizeTerminalText(stripMouseReports(input))
      if (!safeInput) return
      replaceSelection(safeInput)
    },
    { isActive: props.focus },
  )
  usePaste(
    (pasted: string) => {
      if (!props.focus) return
      replacePaste(pasted)
    },
    { isActive: props.focus },
  )

  return (
    <Box
      ref={inputRef}
      width={Math.max(1, Math.floor(props.width))}
      flexDirection="column"
      overflow="hidden"
      flexGrow={0}
      flexShrink={0}
    >
      {props.focus && origin.measured ? (
        <NativeCursor
          x={origin.x + COMPOSER_PROMPT_WIDTH + layout.caretColumn}
          y={origin.y + layout.caretLine}
        />
      ) : null}
      {props.value === ''
        ? (props.focus
        // Focused + empty keeps the row via a non-breaking space: the
        // placeholder hides so the IME pre-edit popup never collides
        // with it, and Ink drops whitespace-only Text content.
          ? (
            <ComposerTextRow prefix={COMPOSER_PROMPT} text={'\u00a0'} paintWidth={paintWidth} />
          )
          : (
            <ComposerTextRow prefix={COMPOSER_PROMPT} text={props.placeholder} paintWidth={paintWidth} dim />
          ))
        : layout.visibleLines.map((line, index) => {
          const range = composerRanges[layout.windowStart + index]
          const lo = mark === null ? 0 : Math.min(mark.anchor, mark.head)
          const hi = mark === null ? 0 : Math.max(mark.anchor, mark.head)
          const hasMark = mark !== null && mark.anchor !== mark.head && range !== undefined
            && hi > range.start && lo < range.end
          const startCol = !hasMark || range === undefined
            ? 0
            : stringWidth(line.slice(0, Math.max(0, lo - range.start)))
          const endCol = !hasMark || range === undefined
            ? 0
            : stringWidth(line.slice(0, Math.min(line.length, hi - range.start)))
          return (
            <ComposerTextRow
              key={index}
              prefix={layout.windowStart + index === 0 ? COMPOSER_PROMPT : COMPOSER_INDENT}
              text={line}
              paintWidth={paintWidth}
              {...(hasMark && range !== undefined ? { highlight: { startCol, endCol } } : {})}
            />
          )
        })}
    </Box>
  )
}

/** Anchor the native cursor through Ink's own output (IME composition). */
function NativeCursor({ x, y }: { x: number; y: number }): null {
  const { setCursorPosition } = useCursor()
  setCursorPosition({ x, y })
  return null
}

/** The composer: a separator, the `›` prompt, and the wrapping input. */
const Composer = React.memo(function Composer(props: {
  draft: string
  onDraftChange: (value: string) => void
  onSubmit: (value: string, steer?: boolean) => void
  disabled: boolean
  focused: boolean
  width: number
  placeholder: string
  mask?: string
  theme: 'dark' | 'light'
  markOutRef?: React.MutableRefObject<{ anchor: number; head: number } | null>
  clearSeq?: number
  draftSeq?: number
  locale: Locale
  onClipboardImage?: (fallbackToText: boolean) => Promise<boolean>
  onPasteText?: (text: string) => string | null
}): React.ReactElement {
  const safeValue = sanitizeTerminalText(props.draft)
  const boxWidth = Math.max(1, props.width - 2)
  return (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(Math.max(1, props.width))}</Text>
      <Box paddingX={1} flexShrink={0}>
        {props.disabled
          ? (
            <DisabledComposerLines value={safeValue} placeholder={props.placeholder} width={boxWidth} />
          )
          : (
            <ImeTextInput
              value={safeValue}
              onChange={next => props.onDraftChange(sanitizeTerminalText(stripMouseReports(next)))}
              onSubmit={props.onSubmit}
              placeholder={props.placeholder}
              focus={props.focused}
              width={boxWidth}
              {...(props.mask !== undefined ? { mask: props.mask } : {})}
              {...(props.markOutRef !== undefined ? { markOutRef: props.markOutRef } : {})}
              {...(props.clearSeq !== undefined ? { clearSeq: props.clearSeq } : {})}
              {...(props.draftSeq !== undefined ? { valueSeq: props.draftSeq } : {})}
              {...(props.onClipboardImage !== undefined ? { onClipboardImage: props.onClipboardImage } : {})}
              {...(props.onPasteText !== undefined ? { onPasteText: props.onPasteText } : {})}
            />
          )}
      </Box>
    </Box>
  )
})

/** The wrapped read-only draft shown while the composer is disabled. */
function DisabledComposerLines(props: { value: string; placeholder: string; width: number }): React.ReactElement {
  const paintWidth = composerTextPaintWidth(props.width)
  const textWidth = composerTextWrapWidth(props.width)
  if (props.value === '') {
    return <ComposerTextRow prefix={COMPOSER_PROMPT} text={props.placeholder} paintWidth={paintWidth} dim />
  }
  const layout = selectComposerLayout(props.value, props.value.length, textWidth, MAX_COMPOSER_LINES)
  return (
    <>
      {layout.visibleLines.map((line, index) => (
        <ComposerTextRow
          key={index}
          prefix={layout.windowStart + index === 0 ? COMPOSER_PROMPT : COMPOSER_INDENT}
          text={line}
          paintWidth={paintWidth}
          dim
        />
      ))}
    </>
  )
}

/** Display label for one file-policy mode (the Web permission wording). */
export function permissionLabel(mode: 'read-only' | 'workspace-write' | 'danger-full-access'): string {
  return mode === 'read-only'
    ? 'read only'
    : mode === 'workspace-write'
      ? 'workspace write'
      : 'full access'
}

/** Permission-chip color by file-policy mode: bright white / warning gold / muted red. */
export function permissionColor(mode: 'read-only' | 'workspace-write' | 'danger-full-access'): 'whiteBright' | '#C9B84A' | '#C75C67' {
  return mode === 'read-only' ? 'whiteBright' : mode === 'workspace-write' ? WARNING_COLOR : FULL_ACCESS_COLOR
}

/**
 * Select the exact status text and leading-glyph TrueColor.
 * @param _busy - retained status-state input; both states share one color.
 * @param _theme - retained theme input; both themes share one color.
 * @returns the exact Ink foreground.
 */
export function statusActivityColor(_busy: boolean, _theme: 'dark' | 'light' = 'dark'): '#61D6D6' {
  return '#61D6D6'
}

/** Exact TrueColor used by the compact welcome card. */
export const WELCOME_CARD_COLOR = '#A99B45'

/** The status bar: separator, activity row, and the Web-stats strip. */
function StatusBar(props: {
  snapshot: ReturnType<TuiStore['getSnapshot']>
  width: number
  panelOpen: boolean
  scrollOffset: number
  locale: Locale
  theme: 'dark' | 'light'
}): React.ReactElement {
  const snapshot = props.snapshot
  const copy = COPY[props.locale]
  const phaseLabel = (snapshot.live?.think ?? '') !== ''
    ? copy.thinking
    : (snapshot.live?.text ?? '') !== ''
      ? copy.generating
      : snapshot.nodes.some(node => node.kind === 'tool' && node.status === 'running')
        ? copy.callingTools
        : copy.awaiting
  const elapsedLabel = snapshot.live?.thinkSince !== null && snapshot.live?.thinkSince !== undefined
    ? ` · ${((Date.now() - snapshot.live.thinkSince) / 1000).toFixed(1)}s`
    : ''
  const queuedLabel = snapshot.queued.length > 0 ? ` · ${copy.queued} ${snapshot.queued.length}` : ''
  const historyPaused = !props.panelOpen && props.scrollOffset > 0 ? ` · ${copy.historyPaused}` : ''
  const planLabel = snapshot.plan.active ? ` · ${copy.plan}` : snapshot.plan.pending ? ` · ${copy.planPending}` : ''
  const hasLiveMotion = (snapshot.live?.think ?? '') !== '' || (snapshot.live?.text ?? '') !== ''
  const intervalMs = hasLiveMotion ? BUSY_STAR_INTERVAL_MS : QUIET_BUSY_STAR_INTERVAL_MS
  const starAnimation = useAnimation({ interval: intervalMs, isActive: snapshot.busy })
  const starTick = starAnimation.frame
  const star = snapshot.busy ? busyStarFrame(starTick) : null
  const left = snapshot.resumeProgress !== null
    ? `${copy.resumeProgress(snapshot.resumeProgress.done, snapshot.resumeProgress.total)} ${copy.resumeCancel}`
    : snapshot.busy
      ? `${star?.glyph ?? '✶'} ${phaseLabel}${elapsedLabel}${queuedLabel}${planLabel} ${copy.busyCancel}`
      : `${copy.idle}${historyPaused}${planLabel}`
  const effortLabel = snapshot.reasoning.effort ?? copy.effortOff
  const effortText = `${copy.effort} ${effortLabel}`
  const rightRest = ` · ${copy.turn} ${snapshot.stats.turns} · ↑${snapshot.stats.tokens.input} ↓${snapshot.stats.tokens.output} Σ${snapshot.stats.tokens.input + snapshot.stats.tokens.output + snapshot.stats.tokens.cacheRead + snapshot.stats.tokens.cacheWrite + snapshot.stats.tokens.reasoning} tok`
  // Narrow windows drop the right-side counters instead of wrapping them
  // onto the strip row below.
  const showRight = props.width >= 52
  const leftBudget = Math.max(4, props.width - 2 - (showRight ? stringWidth(effortText) + stringWidth(rightRest) + 1 : 0))
  const leftColor = statusActivityColor(snapshot.busy, props.theme)
  return (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(Math.max(1, props.width))}</Text>
      <Box justifyContent="space-between" paddingX={1}>
        <Text wrap="truncate" color={leftColor}>{shorten(left, leftBudget)}</Text>
        {showRight ? (
          <Box>
            <Text dimColor>{effortText}</Text>
            <Text dimColor>{rightRest}</Text>
          </Box>
        ) : null}
      </Box>
      <Text dimColor wrap="truncate">{fitStatsStrip(formatStats(snapshot.stats, props.locale, snapshot.occupancy), props.width - 2)}</Text>
    </Box>
  )
}

/** The pinned permission row above the composer: mode label colored by policy plus the Shift+Tab hint. */
const PermissionBar = React.memo(function PermissionBar(props: {
  sandbox: TuiSnapshot['sandbox']
  costUsd: number
  width: number
  locale: Locale
  theme: 'dark' | 'light'
}): React.ReactElement {
  const copy = COPY[props.locale]
  const chip = copy.permissionChip(permissionLabel(props.sandbox))
  const hint = copy.permissionHint
  const space = Math.max(4, props.width - 2)
  const cost = formatCostUsd(props.costUsd)
  const showCost = space >= 24
  const leftSpace = Math.max(4, space - (showCost ? stringWidth(cost) + 1 : 0))
  const hintFits = stringWidth(hint) <= leftSpace - 10
  const chipMax = Math.max(4, leftSpace - (hintFits ? stringWidth(hint) : 0))
  const chipText = stringWidth(chip) <= chipMax ? chip : fitDisplayText(chip, chipMax)
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box>
        <Text bold wrap="truncate" color={permissionColor(props.sandbox)}>
          {chipText}
        </Text>
        {hintFits ? <Text dimColor wrap="truncate">{hint}</Text> : null}
      </Box>
      {showCost ? <Text dimColor>{cost}</Text> : null}
    </Box>
  )
}, (previous, next) => (
  previous.width === next.width
  && previous.locale === next.locale
  && previous.theme === next.theme
  && previous.sandbox === next.sandbox
  && previous.costUsd === next.costUsd
))

/** The approval/question takeover occupying the budgeted rows above the composer. */
function Takeover(props: {
  snapshot: ReturnType<TuiStore['getSnapshot']>
  approvalSel: number
  questionIndex: number
  questionSel: number
  questionSelected: ReadonlySet<number>
  questionText: string
  width: number
  height: number
  locale: Locale
  theme: 'dark' | 'light'
}): React.ReactElement {
  const approval = props.snapshot.pendingApproval
  const question = props.snapshot.pendingQuestion?.questions[
    Math.min(props.questionIndex, (props.snapshot.pendingQuestion?.questions.length ?? 1) - 1)
  ]
  const copy = COPY[props.locale]
  return (
    <Box flexDirection="column" paddingX={1} height={Math.max(1, props.height)} overflow="hidden">
      {approval !== null ? (
        <>
          <Text wrap="truncate" color={WARNING_COLOR} bold>{`${copy.approval}${approval.toolName}`}</Text>
          {approval.reason !== undefined && approval.reason !== '' && <Text wrap="truncate" dimColor>({sanitizeTerminalText(approval.reason)})</Text>}
          <Text wrap="truncate" bold={props.approvalSel === 0} {...props.approvalSel === 0 ? { color: WARNING_COLOR } : {}}>
            {props.approvalSel === 0 ? '▸' : ' '} {copy.allowOnce}
          </Text>
          <Text wrap="truncate" bold={props.approvalSel === 1} {...props.approvalSel === 1 ? { color: WARNING_COLOR } : {}}>
            {props.approvalSel === 1 ? '▸' : ' '} {copy.deny}
          </Text>
          <Text wrap="truncate" dimColor>{copy.approvalHint}</Text>
        </>
      ) : question !== undefined ? (
        <>
          <Text wrap="truncate" color={WARNING_COLOR} bold>? {sanitizeTerminalText(question.question)}</Text>
          {question.detail !== undefined && <Text wrap="truncate" dimColor>{sanitizeTerminalText(question.detail)}</Text>}
          {(question.options ?? []).length > 0 && (question.multiSelect === true || props.questionText === '')
            ? (question.options ?? []).map((option, index) => (
              <Text wrap="truncate" key={option.label} bold={index === props.questionSel} {...index === props.questionSel ? { color: WARNING_COLOR } : {}}>
                {index === props.questionSel ? '▸' : ' '} {question.multiSelect === true
                  ? `[${props.questionSelected.has(index) ? 'x' : ' '}]`
                  : '○'} {sanitizeTerminalText(option.label)}
                {option.description !== undefined ? ` · ${sanitizeTerminalText(option.description)}` : ''}
              </Text>
            ))
            : null}
          {(question.options ?? []).length === 0 || props.questionText !== '' ? wrapText(
            `› ${props.questionText || copy.questionInput}`,
            Math.max(1, props.width - 2),
          ).slice(-2).map((line, index) => (
            <Text key={`question-custom-${index}`} wrap="truncate" color={themed('cyan', props.theme, 'cyan')}>{line}</Text>
          )) : null}
          <Text wrap="truncate" dimColor>{copy.questionHint}</Text>
        </>
      ) : null}
    </Box>
  )
}

/** Live thinking/compaction plus incremental live text, isolated from App tick. */
const ChatTranscript = React.memo(function ChatTranscript(props: {
  settledBlocks: readonly (readonly TranscriptLine[])[]
  dockLines: readonly TranscriptLine[]
  snapshot: ReturnType<TuiStore['getSnapshot']>
  height: number
  width: number
  contentWidth: number
  offset: number
  onMaximumOffsetChange?: ((maximumOffset: number, lineCount: number) => void) | undefined
  theme: 'dark' | 'light'
  locale: Locale
  backButton?: boolean | undefined
  linesRef: React.MutableRefObject<readonly TranscriptLine[]>
  windowOffsetRef: React.MutableRefObject<number>
  blocksRef: React.MutableRefObject<readonly (readonly TranscriptLine[])[]>
  selection?: TextSelection | null | undefined
}): React.ReactElement {
  const snapshot = props.snapshot
  const liveWrapRef = useRef<LiveWrapState | null>(null)
  const liveThinkTailRef = useRef<LiveThinkingTailState | null>(null)
  const liveText = snapshot.live?.text ?? ''
  if (!snapshot.busy || liveText === '') liveWrapRef.current = null
  else {
    liveWrapRef.current = wrapLiveAssistantText(liveWrapRef.current, liveText, props.contentWidth)
  }
  const liveThink = snapshot.live?.think ?? ''
  const liveThinkPrefix = '  │ '
  if (!snapshot.busy || liveThink === '') liveThinkTailRef.current = null
  else {
    liveThinkTailRef.current = projectLiveThinkingTail(
      liveThinkTailRef.current,
      liveThink,
      Math.max(0, props.contentWidth - stringWidth(liveThinkPrefix)),
    )
  }
  const liveThinkLines: TranscriptLine[] = (() => {
    if (snapshot.live === null || !snapshot.busy || liveThink === '') return []
    const lines: TranscriptLine[] = [{
      key: 'live-think',
      text: 'Thinking',
      shimmer: 'thinking',
      ...(snapshot.live.thinkSince !== null ? { shimmerSince: snapshot.live.thinkSince } : {}),
    }]
    const content = liveThinkTailRef.current?.tail ?? ''
    if (content !== '') {
      lines.push({ key: 'live-think-tail', text: `${liveThinkPrefix}${content}`, dim: true })
    }
    return lines
  })()
  const liveTextLines: TranscriptLine[] = liveWrapRef.current === null
    ? []
    : liveWrapRef.current.lines.map((text, index) => ({
      key: `live-text-${index}`,
      text,
    }))
  const tailBlocks: TranscriptLine[][] = []
  if (liveThinkLines.length > 0) tailBlocks.push(liveThinkLines)
  if (liveTextLines.length > 0) tailBlocks.push(liveTextLines)
  if (snapshot.compaction) {
    tailBlocks.push([{
      key: 'live-compact',
      text: 'compacting…',
      shimmer: 'compact',
    }])
  }
  if (props.dockLines.length > 0) tailBlocks.push([...props.dockLines])
  const blocks = [...props.settledBlocks, ...tailBlocks]
  const windowed = selectTranscriptBlocksWindow(
    blocks,
    props.height,
    props.offset,
    TRANSCRIPT_LINE_OVERSCAN,
    props.backButton === true ? 1 : 0,
  )
  props.blocksRef.current = blocks
  props.linesRef.current = windowed.lines
  props.windowOffsetRef.current = windowed.windowStart
  return (
    <Transcript
      lines={windowed.lines}
      height={props.height}
      width={props.width}
      offset={windowed.relativeOffset}
      scrollOffset={windowed.offset}
      lineCount={windowed.totalCount}
      windowStart={windowed.windowStart}
      onMaximumOffsetChange={props.onMaximumOffsetChange}
      theme={props.theme}
      locale={props.locale}
      selection={props.selection}
      backButton={props.backButton}
    />
  )
})

/** One /settings panel page id. */
type PanelKind = 'settings' | 'jobs' | 'subagents' | 'workflows' | 'sessions' | 'plugin-config'

/** The app root. */
export function App(props: {
  store: TuiStore
  host: TuiHost
}): React.ReactElement {
  const { stdout } = useStdout()
  const { exit } = useApp()
  const snapshot = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const cursorStyle = cursorStyleForBusy(snapshot.busy)
  useEffect(() => {
    if (stdout.isTTY === true) stdout.write(cursorStyle)
  }, [cursorStyle, stdout])
  useEffect(() => () => {
    if (stdout.isTTY === true) stdout.write(RESTORE_CURSOR_STYLE)
  }, [stdout])
  const [pendingSandbox, setPendingSandbox] = useState<TuiSnapshot['sandbox'] | null>(null)
  const permissionCycleRef = useRef(new PermissionCycleGate())
  useEffect(() => {
    if (pendingSandbox !== null && snapshot.sandbox === pendingSandbox) setPendingSandbox(null)
  }, [pendingSandbox, snapshot.sandbox])
  const sandbox = pendingSandbox ?? snapshot.sandbox
  const theme = snapshot.settings?.general.theme ?? 'dark'
  const locale = snapshot.settings?.general.locale ?? 'zh'
  const copy = COPY[locale]
  const [terminalSize, setTerminalSize] = useState(() => ({
    width: stdout.columns ?? 100,
    height: stdout.rows ?? 30,
  }))
  // Keep the last physical column blank. Printing into a terminal's right
  // margin arms DECAWM pending-wrap state; a following LF or cursor command
  // is interpreted differently across terminal engines and can move later
  // rows, including Ink's native cursor and the scrollbar gutter.
  const width = selectTerminalFrameWidth(terminalSize.width)
  const rowCount = Math.max(6, terminalSize.height)
  // The transcript reserves its LAST column for the right-edge scrollbar
  // gutter (a browser-style strip rendered by its own Box), so every
  // transcript line wraps at width - 3: one left-margin cell, width - 3
  // content cells, one right-margin cell, then the gutter column.
  const transcriptContentWidth = Math.max(1, width - 3)

  const [draft, setDraft] = useState('')
  const [draftSeq, setDraftSeq] = useState(0)
  const assignDraft = useCallback((next: string | ((current: string) => string)) => {
    setDraftSeq(seq => seq + 1)
    setDraft(next)
  }, [])
  const pastedTextBlocksRef = useRef<readonly PastedTextBlock[]>([])
  const nextPastedTextOrdinalRef = useRef(1)
  const replacePastedTextBlocks = useCallback((blocks: readonly PastedTextBlock[]): void => {
    pastedTextBlocksRef.current = blocks
  }, [])
  useEffect(() => {
    const retained = retainPastedTextBlocks(draft, pastedTextBlocksRef.current)
    if (retained.length !== pastedTextBlocksRef.current.length) replacePastedTextBlocks(retained)
    if (draft === '' && retained.length === 0) nextPastedTextOrdinalRef.current = 1
  }, [draft, replacePastedTextBlocks])
  const [paletteDismissedInput, setPaletteDismissedInput] = useState<string | null>(null)
  const [paletteSelectedIndex, setPaletteSelectedIndex] = useState(0)
  const [sessionReferenceMatches, setSessionReferenceMatches] = useState<readonly SessionReferenceEntry[]>([])
  const sessionReferenceRequest = useRef(0)
  const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0)
  const transcriptScrollOffsetRef = useRef(0)
  const transcriptMaximumOffset = useRef(0)
  const applyTranscriptScroll = useCallback((next: number | ((current: number) => number)): void => {
    const current = transcriptScrollOffsetRef.current
    const value = typeof next === 'function' ? next(current) : next
    const clamped = Math.max(0, Math.floor(value))
    transcriptScrollOffsetRef.current = clamped
    setTranscriptScrollOffset(clamped)
  }, [])
  const wheelBurstRef = useRef<Array<'up' | 'down'>>([])
  const wheelCoalesceRef = useRef(false)
  const panelWheelDeltaRef = useRef(0)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const [viewMode, setViewMode] = useState<'chat' | 'trajectory'>('chat')
  const [notice, setNotice] = useState('')
  const [approvalSel, setApprovalSel] = useState(0)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [questionSel, setQuestionSel] = useState(0)
  const [questionSelected, setQuestionSelected] = useState<ReadonlySet<number>>(new Set())
  const [questionText, setQuestionText] = useState('')
  const [questionAnswers, setQuestionAnswers] = useState<{ id: string; selected: string[]; custom?: string }[]>([])
  const [panel, setPanel] = useState<{ kind: PanelKind; settingsPage: SettingsPageId; filter?: string } | null>(null)
  const [settingsSel, setSettingsSel] = useState(0)
  const [settingsTop, setSettingsTop] = useState(0)
  const [settingsEdit, setSettingsEdit] = useState<string | null>(null)
  const [settingsEditText, setSettingsEditText] = useState('')
  const [settingsConfirm, setSettingsConfirm] = useState<string | null>(null)
  const [pluginEdit, setPluginEdit] = useState<{ ns: string; field: string; kind: 'string' | 'number' | 'secret' } | null>(null)
  const [pluginEditText, setPluginEditText] = useState('')
  // The in-flight id is interaction state rather than display state. Keeping
  // it in a ref rejects key-repeat synchronously without an extra full frame.
  const pluginTogglePendingRef = useRef<string | null>(null)
  const [settingsFilter, setSettingsFilter] = useState('')
  const lastCtrlCAt = useRef(0)
  // Whether a left-button press on the right-edge scrollbar column is being
  // dragged; button-motion reports keep scrolling until the release.
  const scrollbarDragRef = useRef(false)
  // Shell-style input history (cmd/PowerShell ↑/↓ recall), in-memory only.
  const historyRef = useRef<string[]>([])
  const historyScratchRef = useRef('')
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null)
  const textSelectionRef = useRef<TextSelection | null>(null)
  const selectingRef = useRef(false)
  const composerMarkRef = useRef<{ anchor: number; head: number } | null>(null)
  const [composerClearSeq, setComposerClearSeq] = useState(0)
  const selectPressRef = useRef<GlyphAnchor | null>(null)
  const selectPointerRef = useRef<{ row: number; column: number } | null>(null)
  const selectScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pendingApproval = snapshot.pendingApproval
  const pendingQuestion = snapshot.pendingQuestion
  const panelOpen = panel !== null
  const settingsPage = panel?.settingsPage ?? 'general'

  useEffect(() => {
    setQuestionIndex(0)
    setQuestionSel(0)
    setQuestionSelected(new Set())
    setQuestionText('')
    setQuestionAnswers([])
  }, [pendingQuestion])

  const refreshTerminalSize = useCallback(() => {
    setTerminalSize({ width: stdout.columns ?? 100, height: stdout.rows ?? 30 })
  }, [stdout])

  useEffect(() => {
    stdout.on('resize', refreshTerminalSize)
    return () => { stdout.off('resize', refreshTerminalSize) }
  }, [refreshTerminalSize, stdout])

  useEffect(() => {
    stdout.write(ENABLE_WHEEL_MOUSE)
    return () => { stdout.write(DISABLE_WHEEL_MOUSE) }
  }, [stdout])

  // Session discovery reads persisted metadata, so debounce it and discard
  // superseded results. Local filesystem candidates remain synchronous.
  useEffect(() => {
    const range = atTokenRange(draft)
    const request = sessionReferenceRequest.current + 1
    sessionReferenceRequest.current = request
    if (range === null || range.query.startsWith('"')) {
      setSessionReferenceMatches([])
      return
    }
    setSessionReferenceMatches([])
    const timer = setTimeout(() => {
      void props.host.listSessionReferences(range.query).then((matches) => {
        if (sessionReferenceRequest.current === request) setSessionReferenceMatches(matches)
      }).catch(() => {
        if (sessionReferenceRequest.current === request) setSessionReferenceMatches([])
      })
    }, 60)
    return () => { clearTimeout(timer) }
  }, [draft, props.host])
  const exitApp = useCallback((): void => {
    // Reset app-owned mouse modes while Ink still has a writable terminal;
    // alternate-screen teardown intentionally discards effect-cleanup output.
    stdout.write(DISABLE_WHEEL_MOUSE)
    exit()
  }, [exit, stdout])
  // Terminal tab/window title: set `🐋 DeepSeek Harness` at mount through
  // the OSC sequence, keep it for the session, and restore the previous
  // title (captured from the `ESC[21t` report arriving on stdin) on exit.
  // Terminals without title support ignore the writes silently.
  const restoredTitleRef = useRef('')
  useEffect(() => {
    const restore = installTerminalTitle(stdout, restoredTitleRef)
    return restore
  }, [stdout])
  // The /jobs panel polls its rows once a second while open.
  useEffect(() => {
    if (panel?.kind !== 'jobs') return
    const interval = setInterval(() => { props.host.refreshPanels('jobs') }, 1000)
    return () => { clearInterval(interval) }
  }, [panel?.kind, props.host])

  // A takeover arriving while a panel owns the screen must not stay invisible.
  useEffect(() => {
    if (panelOpen && (pendingApproval !== null || pendingQuestion !== null)) {
      setSettingsEdit(null)
      setSettingsEditText('')
      setSettingsConfirm(null)
      setPluginEdit(null)
      setPluginEditText('')
      setPanel(null)
    }
  }, [panelOpen, pendingApproval, pendingQuestion])

  // The combined slash catalog: TUI-local commands first, then host commands.
  // A host command whose name a local command already owns (e.g. `goal`) is
  // SKIPPED here — the palette shows one row per name; execution semantics
  // are unchanged (the exact `/goal` stays local, `/goal <text>` still
  // reaches the host command). Host descriptions get their Chinese copy in
  // the zh locale.
  const commands = useMemo(() => {
    const local = localCommands(locale)
    const localNames = new Set(local.map(command => command.name))
    const host = snapshot.commands
      .filter(command => !localNames.has(command.name))
      .map((command) => {
        const localized = locale === 'zh' ? HOST_COMMAND_ZH[command.name] : undefined
        return {
          name: command.name,
          description: localized ?? command.description,
          needsArgs: command.needsArgs,
        }
      })
    return [...local, ...host]
  }, [locale, snapshot.commands])
  const slashMatchesFor = (value: string): PaletteItem[] | null => {
    if (!value.startsWith('/')) return null
    const skillMatch = /^\/skills\s+(.*)$/u.exec(value)
    if (skillMatch !== null) {
      const query = (skillMatch[1] ?? '').trim()
      const commandNames = new Set(commands.map(command => command.name))
      return snapshot.skills
        .filter(skill => !commandNames.has(skill.name) && skill.name.startsWith(query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(skill => ({
          name: skill.name,
          label: skill.name,
          description: `${skill.modelInvocable ? '' : locale === 'zh' ? '仅用户调用 · ' : 'user only · '}${skill.description}`,
          needsArgs: false,
          insert: `/${skill.name} `,
          key: `skill:${skill.name}`,
        }))
    }
    const effortMatch = /^\/effort(?:\s+(.*))?$/.exec(value)
    if (effortMatch !== null) {
      const query = (effortMatch[1] ?? '').trim().toLowerCase()
      const current = snapshot.reasoning.effort ?? 'off'
      const descriptions: Record<string, string> = locale === 'zh'
        ? { off: '关闭额外推理', low: '低强度推理', high: '高强度推理', max: '最大强度推理' }
        : { off: 'disable additional reasoning', low: 'low reasoning effort', high: 'high reasoning effort', max: 'maximum reasoning effort' }
      const catalog = snapshot.reasoning.levels.length > 0
        ? ['off', ...snapshot.reasoning.levels]
        : ['off', 'low', 'high', 'max']
      return [...new Set(catalog)]
        .filter(option => option.startsWith(query))
        .map(option => ({
          name: `effort:${option}`,
          label: option,
          description: `${descriptions[option] ?? option}${option === current ? (locale === 'zh' ? ' · 当前' : ' · current') : ''}`,
          needsArgs: false,
          command: `/effort ${option}`,
        }))
    }
    const query = value.slice(1)
    // Alphabetical a→z by command name, top to bottom.
    const matches = commands
      .filter(command => command.name.startsWith(query.trim()))
      .sort((a, b) => a.name.localeCompare(b.name))
    return matches.length === 0 ? null : matches
  }
  const referenceMatchesFor = (value: string): PaletteItem[] => {
    const range = atTokenRange(value)
    if (range === null) return []
    const copy = COPY[locale]
    const files = listWorkspaceMentions(snapshot.cwd, range.query, readWorkspaceDir).map((entry) => {
      const suffix = entry.directory ? `${entry.relative}/` : `${entry.relative} `
      return {
        name: entry.relative,
        label: `@${entry.relative}${entry.directory ? '/' : ''}`,
        description: entry.directory ? copy.fileDir : copy.fileFile,
        needsArgs: false,
        insert: replaceAtToken(value, suffix),
        key: `file:${entry.relative}`,
      }
    })
    const sessions = sessionReferenceMatches.map(entry => ({
      name: entry.label,
      label: `@${entry.label}`,
      description: `${locale === 'zh' ? '会话' : 'session'}${entry.cwd === undefined ? '' : ` · ${entry.cwd}`}`,
      needsArgs: false,
      insert: `${value.slice(0, range.start)}${entry.mention} `,
      key: `session:${entry.mention}`,
    }))
    return [...files, ...sessions]
  }
  const palette = useMemo(() => {
    if (paletteDismissedInput === draft || panelOpen || pendingApproval !== null || pendingQuestion !== null) return null
    const slash = slashMatchesFor(draft)
    if (slash !== null) return slash
    const references = referenceMatchesFor(draft)
    if (references.length === 0) return null
    return references
  }, [
    draft, paletteDismissedInput, panelOpen, pendingApproval, pendingQuestion, commands, locale,
    snapshot.reasoning.effort, snapshot.cwd, snapshot.skills, sessionReferenceMatches,
  ])
  const skillPaletteActive = palette !== null && draft.startsWith('/skills ')

  useEffect(() => {
    setPaletteSelectedIndex(current =>
      palette === null ? 0 : Math.min(current, Math.max(0, palette.length - 1)))
  }, [palette])

  // ── transcript lines ──────────────────────────────────────────────────
  const thinkDefaultOpen = snapshot.settings?.general.thinking === 'expanded'
  const expandedOf = (node: TuiNode): boolean => node.kind === 'think' ? thinkDefaultOpen : expanded.has(node.id)
  const nodeLineCache = useRef<NodeLineCache>(createNodeLineCache())

  // ── layout budget ─────────────────────────────────────────────────────
  // A panel action's notice pins one dim row under the panel list, so the
  // feedback stays visible while the panel remains open.
  const panelNoticeVisible = panelOpen && notice !== ''
  // The composer becomes the masked credential/plugin-config editor while a
  // credential row or plugin field is being edited inside a panel.
  const composerDraft = pluginEdit !== null
    ? pluginEditText
    : settingsEdit !== null
      ? settingsEditText
      : draft
  const composerDisplay = pluginEdit?.kind === 'secret'
    ? '•'.repeat([...composerDraft].length)
    : sanitizeTerminalText(composerDraft)
  const composerLines = Math.min(
    MAX_COMPOSER_LINES,
    Math.max(
      1,
      composerVisibleRowCount(
        composerDisplay,
        composerDisplay.length,
        composerTextWrapWidth(Math.max(1, width - 2)),
        MAX_COMPOSER_LINES,
      ),
    ),
  )
  // The frame must always fill the physical rows exactly. Ink derives the
  // fullscreen cursor suffix from that final output row, so clipped chrome
  // would move the composer without changing its measured layout position.
  // Budget the palette and takeover down until the complete frame fits.
  const reserved = 4 + 1 + composerLines + 1 + 3 + (panelNoticeVisible ? 1 : 0)
  const activeQuestion = pendingQuestion?.questions[Math.min(questionIndex, (pendingQuestion?.questions.length ?? 1) - 1)]
  const questionRows = activeQuestion === undefined ? 0 : Math.min(
    10,
    3 + (activeQuestion.options?.length ?? 0) + (questionText === '' ? 0 : 2),
  )
  let takeoverH = pendingApproval !== null ? 6 : pendingQuestion !== null ? Math.max(6, questionRows) : 0
  const fullPaletteH = palette !== null
    ? palette.length === 0 ? 3 : Math.min(MAX_POPUP_ITEMS + 2, Math.min(MAX_POPUP_ITEMS, palette.length) + 2)
    : 0
  const paletteH = Math.min(fullPaletteH, Math.max(0, rowCount - reserved - takeoverH - 1))
  takeoverH = Math.min(takeoverH, Math.max(0, rowCount - reserved - paletteH - 1))
  const fixedRows = reserved + takeoverH + paletteH
  const transcriptHeight = Math.max(1, rowCount - fixedRows)
  // A panel replaces the transcript row-for-row. Notices are already part of
  // `reserved`, so subtracting them again shifts every bottom chrome row up.
  const panelHeight = transcriptHeight
  const snapshotTranscriptWindow = useEffectEvent((offset: number) => selectTranscriptBlocksWindow(
    transcriptBlocksRef.current,
    transcriptHeight,
    offset,
    TRANSCRIPT_LINE_OVERSCAN,
    offset > 0 ? 1 : 0,
  ))
  const hitTranscriptCell = useEffectEvent((
    terminalRow: number,
    terminalColumn: number,
    offset: number,
    recordWindow: boolean,
  ) => {
    const reserved = offset > 0 ? 1 : 0
    const contentHeight = Math.max(1, transcriptHeight - reserved)
    const clampedRow = Math.max(0, Math.min(contentHeight - 1, terminalRow - 5))
    const windowed = snapshotTranscriptWindow(offset)
    if (recordWindow) {
      rememberTranscriptWindow(selectionLinesRef.current, windowed.lines, windowed.windowStart)
    }
    return transcriptCellAt(
      windowed.lines,
      transcriptHeight,
      windowed.relativeOffset,
      reserved,
      clampedRow,
      terminalColumn,
      windowed.windowStart,
    )
  })
  const extendTranscriptSelection = useEffectEvent((terminalRow: number, terminalColumn: number): void => {
    let offset = transcriptScrollOffsetRef.current
    const maximum = transcriptMaximumOffset.current
    if (terminalRow <= 5) offset = Math.min(maximum, offset + SELECT_SCROLL_LINES)
    else if (terminalRow >= 4 + transcriptHeight) offset = Math.max(0, offset - SELECT_SCROLL_LINES)
    if (offset !== transcriptScrollOffsetRef.current) applyTranscriptScroll(offset)
    const cell = hitTranscriptCell(terminalRow, terminalColumn, offset, true)
    const press = selectPressRef.current
    if (cell === undefined || press === null) return
    const span = glyphSpanAt(cell.line.text, cell.column)
    // Spacer rows can start a drag, but the pointer sitting on one must not
    // extend the head onto that empty row (which would select the rest of
    // the previous line from a one-row jitter). A zero-width span on a
    // content row is the exclusive end of that line, not a spacer.
    if (span.start === span.end && lineSelectableWidth(cell.line.text) <= 0) return
    const next = selectionFromGlyphs(press, {
      lineIndex: cell.lineIndex,
      start: span.start,
      end: span.end,
    })
    textSelectionRef.current = next
    if (selectionIsDrag(next)) setTextSelection(next)
  })
  const stopSelectScroll = useCallback((): void => {
    selectPointerRef.current = null
    if (selectScrollTimerRef.current !== null) {
      clearInterval(selectScrollTimerRef.current)
      selectScrollTimerRef.current = null
    }
  }, [])
  const armSelectScroll = useEffectEvent((row: number, column: number): void => {
    selectPointerRef.current = { row, column }
    const atEdge = row <= 5 || row >= 4 + transcriptHeight
    if (atEdge) {
      if (selectScrollTimerRef.current === null) {
        selectScrollTimerRef.current = setInterval(() => {
          const pointer = selectPointerRef.current
          if (pointer === null || !selectingRef.current) return
          extendTranscriptSelection(pointer.row, pointer.column)
        }, SELECT_SCROLL_MS)
      }
    } else if (selectScrollTimerRef.current !== null) {
      clearInterval(selectScrollTimerRef.current)
      selectScrollTimerRef.current = null
    }
  })
  const settingsChromeRows = panel?.kind === 'settings' ? SETTINGS_CHROME_ROWS : 0
  const panelListHeight = Math.max(1, panelHeight - settingsChromeRows)

  const visibleNodes = useMemo(
    () => snapshot.nodes.slice(Math.max(0, snapshot.nodes.length - MAX_FOLD_NODES)),
    [snapshot.nodes],
  )
  const trajectoryLines = useMemo((): TranscriptLine[] => snapshot.trace
    .slice(Math.max(0, snapshot.trace.length - MAX_TRACE))
    .map((entry, index) => {
      // One flat row per trace entry, truncated to the content width so a
      // long entry can never wrap and shift the rows below it.
      const text = fitDisplayText(`· ${sanitizeTerminalText(entry.text)}`, transcriptContentWidth)
      // Structured-trajectory palette: model turns blue, tool activity red,
      // user input cyan, structural boundaries dim.
      const color = traceLineColor(text)
      return {
        key: `trace-${entry.id}-${index}`,
        text,
        ...(color === undefined ? { dim: true } : { color }),
      }
    }), [snapshot.trace, transcriptContentWidth])
  const preparedHistory = useMemo((): { node: TuiNode; count: number; topPad: boolean; botPad: boolean }[] => {
    const liveNodes = new Set(visibleNodes)
    if (![...nodeLineCache.current.lines.keys()].some(node => liveNodes.has(node))) {
      nodeLineCache.current.lines.clear()
      nodeLineCache.current.recency = []
    }
    const prepared: { node: TuiNode; count: number; topPad: boolean; botPad: boolean }[] = []
    let previousKind: TuiNode['kind'] | undefined
    for (const node of visibleNodes) {
      const count = cachedNodeLineCount(
        nodeLineCache.current,
        node,
        transcriptContentWidth,
        expandedOf(node),
        snapshot.feedback,
        locale,
      )
      if (node.kind === 'user') {
        prepared.push({
          node,
          count,
          topPad: previousKind !== 'user',
          botPad: true,
        })
      } else if (count > 0) {
        prepared.push({ node, count, topPad: false, botPad: false })
      }
      previousKind = node.kind
    }
    return prepared
  }, [
    visibleNodes, transcriptContentWidth,
    expanded, thinkDefaultOpen, snapshot.feedback, locale,
  ])
  const historyHeightIndex = useMemo(() => {
    const lengths = preparedHistory.map(entry =>
      entry.count + (entry.topPad ? 1 : 0) + (entry.botPad ? 1 : 0))
    const prefix = exclusivePrefixSums(lengths)
    const total = prefix[prefix.length - 1] ?? 0
    return { lengths, prefix, total }
  }, [preparedHistory])
  const historyBlocks = useMemo((): TranscriptLine[][] => {
    const { lengths, prefix, total } = historyHeightIndex
    const reserved = transcriptScrollOffset > 0 ? 1 : 0
    const capacity = Math.max(1, Math.max(1, Math.floor(transcriptHeight)) - reserved)
    const extra = TRANSCRIPT_LINE_OVERSCAN
    const maximumOffset = Math.max(0, total - capacity)
    const offset = Math.min(
      Number.isFinite(transcriptScrollOffset) ? Math.max(0, Math.floor(transcriptScrollOffset)) : 0,
      maximumOffset,
    )
    const end = Math.max(0, total - offset)
    const start = Math.max(0, end - capacity)
    const windowStart = Math.max(0, start - extra)
    const windowEnd = Math.min(total, end + extra)
    const keep = new Set<TuiNode>()
    const blocks: TranscriptLine[][] = []
    if (preparedHistory.length === 0) return blocks
    const first = nodeIndexAtLine(prefix, windowStart)
    const last = nodeIndexAtLine(prefix, Math.max(windowStart, windowEnd - 1))
    const hiddenPrefix = prefix[first] ?? 0
    if (hiddenPrefix > 0) blocks.push(sparseCountBlock(hiddenPrefix))
    for (let index = first; index <= last; index += 1) {
      const entry = preparedHistory[index]
      const length = lengths[index]
      const blockStart = prefix[index] ?? 0
      if (entry === undefined || length === undefined) continue
      if (blockStart + length <= windowStart || blockStart >= windowEnd) continue
      keep.add(entry.node)
      const body = cachedNodeLines(
        nodeLineCache.current,
        entry.node,
        transcriptContentWidth,
        expandedOf(entry.node),
        snapshot.feedback,
        locale,
      )
      const block: TranscriptLine[] = []
      if (entry.topPad) block.push({ key: `${entry.node.id}-vpad-top`, text: ' ' })
      block.push(...body)
      if (entry.botPad) block.push({ key: `${entry.node.id}-vpad-bot`, text: ' ' })
      blocks.push(block)
    }
    const paintedEnd = prefix[last + 1] ?? total
    const hiddenTail = Math.max(0, total - paintedEnd)
    if (hiddenTail > 0) blocks.push(sparseCountBlock(hiddenTail))
    pruneNodeLineCache(nodeLineCache.current, keep)
    return blocks
  }, [
    preparedHistory, historyHeightIndex, transcriptContentWidth,
    expanded, thinkDefaultOpen, snapshot.feedback, locale,
    transcriptScrollOffset, transcriptHeight,
  ])
  const welcomeLines = useMemo((): TranscriptLine[] => {
    if (visibleNodes.length > 0) return []
    // First load of a NEW session only: the whale banner. Any event
    // (user message, resume replay, …) fills `nodes`, so the banner can
    // never reappear later in the session.
    const banner = welcomeBanner(transcriptContentWidth, transcriptHeight)
    if (banner.length > 0) {
      return banner.map((entry, index) => ({
        key: `welcome-${index}`,
        text: entry.text,
        ...(entry.runs !== undefined ? { runs: entry.runs } : {}),
        ...(entry.color !== undefined ? { color: entry.color } : {}),
      }))
    }
    // Too narrow/short for the art: the plain adaptive welcome card.
    return welcomeBlock(transcriptContentWidth, snapshot.model, snapshot.cwd, snapshot.sessionId, locale).map((line, index) => {
      const chrome = line.startsWith('┏') || line.startsWith('┃') || line.startsWith('┗')
      return {
        key: `welcome-${index}`,
        text: line,
        ...(chrome ? { color: WELCOME_CARD_COLOR, exactColor: true } : { dim: true }),
      }
    })
  }, [visibleNodes.length, transcriptContentWidth, transcriptHeight, snapshot.model, snapshot.cwd, snapshot.sessionId, locale])
  const settledBlocks = viewMode === 'trajectory'
    ? (trajectoryLines.length > 0 ? [trajectoryLines] : [])
    : visibleNodes.length === 0 ? (welcomeLines.length > 0 ? [welcomeLines] : [])
      : historyBlocks
  const dockLines = useMemo((): TranscriptLine[] => {
    const lines: TranscriptLine[] = []
    if (notice !== '') {
      wrapText(notice, transcriptContentWidth).forEach((line, index) => {
        lines.push({ key: `notice-${index}`, text: line, color: 'gray' })
      })
    }
    if (snapshot.queued.length > 0) {
      const preview = snapshot.queued.map(entry => `${entry.steer ? '▸▸ ' : ''}${sanitizeTerminalText(entry.text)}`).join(' · ')
      lines.push({ key: 'queue-dock', text: fitDisplayText(`${copy.queueDock} ${snapshot.queued.length}：${preview}`, transcriptContentWidth), color: 'yellow' })
    }
    if (snapshot.todos.length > 0) {
      let pending = 0
      let active = 0
      let done = 0
      for (const todo of snapshot.todos) {
        if (todo.status === 'pending') pending += 1
        else if (todo.status === 'in_progress') active += 1
        else done += 1
      }
      const dock = todoDockLine(
        copy.todoDock,
        copy.todoInProgress(active),
        copy.todoPendingCount(pending),
        copy.todoCompleteCount(done),
      )
      const fitted = fitDockLine(dock, transcriptContentWidth)
      lines.push({
        key: 'todo-dock',
        text: fitted.text,
        color: fitted.color,
        runs: fitted.runs,
        ...(fitted.exactColor === true ? { exactColor: true } : {}),
      })
    }
    if (snapshot.goal !== null) {
      const phaseLabel = snapshot.goal.phase === 'active' ? copy.goalActive
        : snapshot.goal.phase === 'paused' ? copy.goalPaused
          : snapshot.goal.phase === 'blocked' ? copy.goalBlocked(snapshot.goal.blockedReason?.message ?? snapshot.goal.blockedReason?.code ?? '')
            : copy.goalComplete
      const objective = snapshot.goal.objective.length <= 80 ? snapshot.goal.objective : `${snapshot.goal.objective.slice(0, 80)}…`
      const dock = goalDockLine(
        copy.goalDock,
        phaseLabel,
        `round ${snapshot.goal.roundsStarted}/${snapshot.goal.maxGoalRounds}`,
        objective,
      )
      const fitted = fitDockLine(dock, transcriptContentWidth)
      lines.push({
        key: 'goal-dock',
        text: fitted.text,
        color: fitted.color,
        runs: fitted.runs,
        ...(fitted.exactColor === true ? { exactColor: true } : {}),
      })
    }
    if (snapshot.pendingImages.length > 0) {
      const chips = snapshot.pendingImages
        .map(image => `${image.chip} ${image.name} ${image.width}×${image.height} ${formatByteSize(image.bytes)}`)
        .join(' · ')
      lines.push({
        key: 'attach-dock',
        text: fitDisplayText(`${copy.attachCount(snapshot.pendingImages.length)} · ${chips}`, transcriptContentWidth),
        color: 'yellow',
      })
    } else if (snapshot.attachmentCount > 0) {
      lines.push({ key: 'attach-dock', text: fitDisplayText(copy.attachCount(snapshot.attachmentCount), transcriptContentWidth), color: 'yellow' })
    }
    return lines
  }, [
    notice, transcriptContentWidth, snapshot.queued, snapshot.todos, snapshot.goal, snapshot.attachmentCount,
    snapshot.pendingImages, copy,
  ])

  // The view stays on the same CONTENT while new lines stream in at the
  // tail: compensate only for real line growth, never for chrome changes
  // (the back-button reservation also moves the maximum).
  const transcriptLineCountRef = useRef(0)
  const transcriptLinesRef = useRef<readonly TranscriptLine[]>([])
  const transcriptWindowOffsetRef = useRef(0)
  const transcriptBlocksRef = useRef<readonly (readonly TranscriptLine[])[]>([])
  const selectionLinesRef = useRef(new Map<number, TranscriptLine>())
  const updateTranscriptMaximumOffset = useCallback((maximumOffset: number, lineCount: number) => {
    transcriptMaximumOffset.current = maximumOffset
    const grew = Math.max(0, lineCount - transcriptLineCountRef.current)
    transcriptLineCountRef.current = lineCount
    applyTranscriptScroll((current) => {
      if (current === 0) return 0
      return Math.min(maximumOffset, Math.max(0, current + grew))
    })
  }, [applyTranscriptScroll])

  const pageSize = Math.max(1, rowCount - 12)

  // ── panels ────────────────────────────────────────────────────────────
  const settingsRows = useMemo((): PanelRow[] => {
    if (panel === null) return []
    switch (panel.kind) {
      case 'settings': return filterSettingsRows(buildSettingsRows(snapshot, panel.settingsPage, locale), settingsFilter)
      case 'jobs': return buildJobsRows(snapshot.jobs, locale)
      case 'subagents': return buildSubagentRows(snapshot.subagents, locale)
      case 'workflows': return buildWorkflowRows(snapshot.workflows, locale)
      case 'sessions': return buildSessionRows(snapshot.sessions, panel.filter, locale)
      case 'plugin-config': return buildPluginConfigRows(snapshot.settings?.configs[panel.filter ?? ''] ?? [], panel.filter ?? '', locale)
    }
  }, [snapshot, panel, locale, settingsFilter])
  const settingsViewport = selectPanelViewport(settingsRows.map(row => ({
    key: row.key,
    text: row.text,
    ...(row.color !== undefined ? { color: row.color } : {}),
    dim: row.dim === true,
  })), panelListHeight, settingsTop)
  const settingsSelClamped = Math.max(0, Math.min(settingsSel, settingsRows.length - 1))

  // Panels open on a row that can be activated. Static headers and hints are
  // never presented as the current choice when the panel has real actions.
  useEffect(() => {
    if (!panelOpen || settingsRows.length === 0 || settingsRows[settingsSelClamped]?.action !== undefined) return
    const first = firstActionablePanelRow(settingsRows)
    if (first === undefined) return
    setSettingsSel(first)
    setSettingsTop(current => first >= current + panelListHeight ? first - panelListHeight + 1 : Math.min(current, first))
  }, [panelOpen, panelListHeight, settingsRows, settingsSelClamped])

  // ── command routing ───────────────────────────────────────────────────
  const openPanel = useCallback((kind: PanelKind, settingsPageArg: SettingsPageId = 'general', filter?: string): void => {
    setPanel({
      kind,
      settingsPage: settingsPageArg,
      ...(filter === undefined ? {} : { filter }),
    })
    setSettingsSel(0)
    setSettingsTop(0)
    setSettingsEdit(null)
    setSettingsEditText('')
    setSettingsConfirm(null)
    setPluginEdit(null)
    setPluginEditText('')
    setSettingsFilter('')
    assignDraft('')
    setPaletteDismissedInput(null)
    setNotice('')
    if (kind === 'settings') {
      // The plugins page is a read-only projection of the current Loader
      // tree, so refresh it whenever settings opens.
      props.host.refreshSettings()
    } else if (kind === 'jobs' || kind === 'subagents' || kind === 'sessions') {
      props.host.refreshPanels(kind)
    }
  }, [assignDraft, props.host])

  // A launcher-provided startup panel (bare --resume picker, or an ambiguous
  // --resume query) opens once the app mounts; the host object is stable for
  // the surface's lifetime, so the effect runs on mount only.
  useEffect(() => {
    const panel = props.host.startup?.panel
    if (panel !== undefined) openPanel(panel.kind, 'general', panel.filter)
  }, [openPanel, props.host])

  const executeCommand = useCallback((raw: string): void => {
    const text = raw.trim()
    if (text === '') return
    if (text === '/quit' || text === '/exit') {
      exitApp()
      return
    }
    if (text === '/help') {
      setNotice(helpText(locale))
      return
    }
    if (text === '/clear') {
      setNotice('')
      return
    }
    if (text === '/copy' || text.startsWith('/copy ')) {
      const argument = text === '/copy' ? '' : text.slice('/copy '.length)
      const resolved = resolveCopyTarget(snapshot.nodes, argument)
      if (!resolved.ok) {
        setNotice(resolved.error === 'empty' ? copy.copyEmpty
          : resolved.error === 'range' ? copy.copyRange(argument.trim() === '' || argument.trim() === 'last' ? '1' : argument.trim(), snapshot.nodes.filter(node => node.kind === 'assistant' && extractCopyText(node) !== null).length)
            : copy.copyUsage)
        return
      }
      const semantic = extractCopyText(resolved.target.node)
      if (semantic === null) {
        setNotice(copy.copyEmpty)
        return
      }
      void copyToClipboard(semantic, stdout).then((outcome) => {
        setNotice(outcome.ok ? copy.copyDone : copy.copyFailed(outcome.error ?? 'unknown'))
      })
      return
    }
    if (text === '/rate' || text.startsWith('/rate ')) {
      const parts = text.split(/\s+/u)
      const direction = parts[1]
      const ordinal = parts[2] === undefined ? 1 : Number(parts[2])
      if ((direction !== 'up' && direction !== 'down')
        || !Number.isSafeInteger(ordinal) || ordinal < 1 || parts.length > 3) {
        setNotice(copy.rateUsage)
        return
      }
      const targets = snapshot.nodes.filter(node => node.kind === 'assistant' && node.text !== '').reverse()
      const target = targets[ordinal - 1]
      if (target?.kind !== 'assistant') {
        setNotice(copy.rateRange(ordinal, targets.length))
        return
      }
      const rating = direction === 'up' ? 'positive' : 'negative'
      void props.host.rateMessage(target.messageId, rating).then((error) => {
        setNotice(error ?? copy.rateDone(direction, ordinal))
      })
      return
    }
    if (text === '/trajectory') {
      setViewMode(viewMode === 'chat' ? 'trajectory' : 'chat')
      applyTranscriptScroll(0)
      return
    }
    if (text === '/skills' || text.startsWith('/skills ')) {
      // `/skills` is the discovery surface. The selected item still inserts
      // the canonical `/name ` text owned by the Harness skill pre-step.
      assignDraft(`${text === '/skills' ? '/skills' : text} `)
      setPaletteDismissedInput(null)
      return
    }
    if (text === '/settings' || text.startsWith('/settings ')) {
      const argument = text.split(' ')[1]
      openPanel('settings', SETTINGS_PAGES.includes(argument as SettingsPageId) ? argument as SettingsPageId : 'general')
      return
    }
    if (text === '/jobs' || text === '/subagents' || text === '/workflows') {
      openPanel(text.slice(1) as PanelKind)
      return
    }
    if (text === '/sessions' || text.startsWith('/sessions ')) {
      const query = text === '/sessions' ? undefined : text.slice('/sessions '.length).trim()
      openPanel('sessions', 'general', query === '' ? undefined : query)
      return
    }
    if (text === '/presets') {
      openPanel('settings', 'presets')
      return
    }
    if (text === '/goal') {
      const goal = snapshot.goal
      if (goal === null) {
        setNotice(copy.goalNone)
        return
      }
      const phaseLabel = goal.phase === 'active' ? copy.goalActive
        : goal.phase === 'paused' ? copy.goalPaused
          : goal.phase === 'blocked' ? copy.goalBlocked(goal.blockedReason?.message ?? goal.blockedReason?.code ?? '')
            : copy.goalComplete
      const lines = [
        copy.goalDetail(goal.revision, phaseLabel, goal.roundsStarted, goal.maxGoalRounds),
        `${copy.goalObjective}${goal.objective}`,
        ...(goal.blockedReason !== undefined ? [copy.goalBlockedLine(goal.blockedReason.code, goal.blockedReason.message)] : []),
        copy.goalCreated(new Date(goal.createdAt).toLocaleString(), new Date(goal.updatedAt).toLocaleString()),
      ]
      setNotice(lines.join('\n'))
      return
    }
    if (text === '/effort' || text.startsWith('/effort ')) {
      const argument = text === '/effort' ? '' : text.slice('/effort '.length).trim()
      const allowed = snapshot.reasoning.levels.length > 0
        ? ['off', ...snapshot.reasoning.levels]
        : ['off', 'low', 'high', 'max']
      if (!allowed.includes(argument)) {
        setNotice(copy.effortUsage)
        return
      }
      props.host.setEffort(argument === 'off' ? undefined : argument)
      setNotice(copy.effortChanged(argument))
      return
    }
    if (text === '/new') {
      props.host.newSession()
      applyTranscriptScroll(0)
      return
    }
    if (text === '/rename' || text.startsWith('/rename ')) {
      const title = text === '/rename' ? '' : text.slice('/rename '.length).trim()
      if (title === '') {
        setNotice(copy.renameUsage)
        return
      }
      void props.host.renameSession(title).then((error) => {
        setNotice(error === null ? copy.renameDone(title) : error)
      })
      return
    }
    if (text === '/workspace' || text.startsWith('/workspace ')) {
      const path = text === '/workspace' ? '' : text.slice('/workspace '.length).trim()
      if (path === '') {
        setNotice(copy.workspaceUsage)
        return
      }
      void props.host.changeWorkspace(path).then((error) => {
        setNotice(error === null ? copy.workspaceDone(path) : error)
      })
      return
    }
    if (text === '/attach' || text.startsWith('/attach ')) {
      const path = text === '/attach' ? '' : text.slice('/attach '.length).trim()
      if (path === '') {
        setNotice(copy.attachUsage)
        return
      }
      void props.host.attachFile(path).then((result) => {
        if (result.error !== null) {
          setNotice(result.error)
          return
        }
        setNotice(copy.attachDone(path))
      })
      return
    }
    if (text === '/image' || text.startsWith('/image ')) {
      const argument = text === '/image' ? '' : text.slice('/image '.length).trim()
      const requested = argument === '' ? snapshot.pendingImages.length : Number(argument)
      const image = Number.isSafeInteger(requested) && requested > 0
        ? snapshot.pendingImages[requested - 1]
        : undefined
      if (image === undefined) {
        setNotice(copy.imageUsage)
        return
      }
      setNotice(copy.imagePreview(
        image.chip,
        image.name,
        image.width,
        image.height,
        formatByteSize(image.bytes),
      ))
      return
    }
    if (text === '/fork' || text.startsWith('/fork ')) {
      const argument = text === '/fork' ? '' : text.slice('/fork '.length).trim()
      const atSeq = argument === '' ? undefined : Number(argument)
      if (atSeq !== undefined && !Number.isSafeInteger(atSeq)) {
        setNotice(copy.forkUsage)
        return
      }
      void props.host.forkSession(atSeq).then((error) => {
        setNotice(error === null ? copy.forkDone : error)
      })
      return
    }
    if (text === '/model') {
      openPanel('settings', 'models')
      return
    }
    // Anything else routes through the host: registered slash commands
    // dispatch without a model turn; unknown lines become model messages.
    props.host.submit(text, false)
    setNotice('')
  }, [assignDraft, exitApp, viewMode, snapshot, props.host, openPanel, locale, copy, stdout])

  const submit = useCallback((value: string, steer = false): void => {
    const trimmed = expandPastedTextBlocks(value, pastedTextBlocksRef.current).trim()
    if (trimmed.startsWith('/')) {
      assignDraft('')
      executeCommand(trimmed)
      return
    }
    const sending = attachmentsForSubmit(trimmed, snapshot.pendingImages)
    const prose = stripImageChips(trimmed)
    const hasImages = sending.length > 0
    if (prose === '' && !hasImages) return
    if (hasImages && !modelRouteAcceptsImages(snapshot.models, snapshot.provider, snapshot.model)) {
      setNotice(copy.imageModelRefused)
      return
    }
    const inputBytes = Buffer.byteLength(prose, 'utf8')
    if (inputBytes > MAX_TURN_INPUT_BYTES) {
      setNotice(copy.inputTooLarge(inputBytes, MAX_TURN_INPUT_BYTES))
      return
    }
    assignDraft('')
    applyTranscriptScroll(0)
    const busyEnter = snapshot.settings?.general.busyEnter ?? 'queue'
    const effectiveSteer = snapshot.busy
      ? (steer ? busyEnter !== 'steer' : busyEnter === 'steer')
      : steer
    props.host.submit(trimmed, effectiveSteer)
    setNotice('')
    const history = historyRef.current
    if (history[history.length - 1] !== trimmed) history.push(trimmed)
    historyScratchRef.current = ''
    setHistoryIndex(-1)
  }, [
    assignDraft,
    executeCommand,
    snapshot.busy,
    snapshot.settings?.general.busyEnter,
    snapshot.pendingImages,
    snapshot.models,
    snapshot.provider,
    snapshot.model,
    props.host,
    copy,
  ])

  const applyPalette = useCallback((completeOnly: boolean): void => {
    if (palette === null) return
    const item = palette[Math.min(paletteSelectedIndex, palette.length - 1)]
    if (item === undefined) return
    if (item.insert !== undefined) {
      assignDraft(item.insert)
      setPaletteDismissedInput(item.insert.endsWith('/') ? null : item.insert)
      setPaletteSelectedIndex(0)
      return
    }
    if (item.command !== undefined) {
      if (completeOnly) {
        assignDraft(item.command)
        setPaletteDismissedInput(item.command)
      } else {
        assignDraft('')
        setPaletteDismissedInput(null)
        executeCommand(item.command)
      }
      setPaletteSelectedIndex(0)
      return
    }
    if (completeOnly || item.needsArgs) {
      assignDraft(`/${item.name} `)
      setPaletteDismissedInput(null)
      setPaletteSelectedIndex(0)
      return
    }
    assignDraft('')
    setPaletteDismissedInput(null)
    executeCommand(`/${item.name}`)
  }, [assignDraft, palette, paletteSelectedIndex, executeCommand])

  /** Commit the composer's plugin-config edit into the namespace. */
  const commitPluginEdit = useCallback((): void => {
    if (pluginEdit === null) return
    const { ns, field, kind } = pluginEdit
    let value: unknown = pluginEditText
    if (kind === 'number') {
      const parsed = Number(pluginEditText.trim())
      if (!Number.isFinite(parsed)) {
        setNotice(copy.invalidNumber)
        return
      }
      value = parsed
    }
    setPluginEdit(null)
    setPluginEditText('')
    void props.host.updatePluginConfig(ns, { [field]: value }).then((error) => {
      setNotice(error === null ? copy.fieldUpdated(field) : error)
    })
  }, [pluginEdit, pluginEditText, props.host, copy])

  const submitComposer = useCallback((value: string, steer = false): void => {
    if (pluginEdit !== null) {
      commitPluginEdit()
      return
    }
    if (settingsEdit !== null) {
      commitCredentialEdit()
      return
    }
    if (palette !== null && palette.length > 0) {
      applyPalette(false)
      return
    }
    if (snapshot.resumeProgress !== null) return
    if (panelOpen) return
    submit(value, steer)
  }, [
    pluginEdit, commitPluginEdit, settingsEdit, settingsEditText, settingsConfirm,
    palette, applyPalette, snapshot.resumeProgress, panelOpen, submit,
  ])

  // ── settings credential edit through the composer ────────────────────
  const commitCredentialEdit = useCallback((): void => {
    if (settingsEdit === null) return
    const row = settingsRows.find(entry => entry.key === settingsEdit)
    const ref = row?.meta?.ref
    if (ref === undefined) {
      setSettingsEdit(null)
      setSettingsEditText('')
      return
    }
    if (settingsConfirm !== null) {
      void props.host.setCredential(ref, settingsEditText).then(() => {
        setNotice(copy.credentialWritten(ref))
      }).catch((error: unknown) => {
        setNotice(copy.credentialWriteFailed(error instanceof Error ? error.message : String(error)))
      })
      setSettingsConfirm(null)
      setSettingsEdit(null)
      setSettingsEditText('')
      return
    }
    if (settingsEditText === '') {
      void props.host.unsetCredential(ref).then(() => {
        setNotice(copy.credentialRemoved(ref))
      }).catch((error: unknown) => {
        setNotice(copy.credentialRemoveFailed(error instanceof Error ? error.message : String(error)))
      })
      setSettingsEdit(null)
      return
    }
    setSettingsConfirm(settingsEdit)
  }, [settingsEdit, settingsEditText, settingsConfirm, settingsRows, props.host, copy])

  /** Activate the panel row under the cursor. */
  const activateSettingsRow = useCallback((row: PanelRow | undefined): void => {
    if (row === undefined || row.action === undefined) return
    switch (row.action) {
      case 'toggle-busy-enter': {
        const next = snapshot.settings?.general.busyEnter === 'steer' ? 'queue' : 'steer'
        void props.host.updateSetting({ busyEnter: next }).then(() => {
          setNotice(copy.busyEnterChanged(next))
        }).catch(() => {})
        return
      }
      case 'toggle-thinking': {
        const next = snapshot.settings?.general.thinking === 'expanded' ? 'collapsed' : 'expanded'
        void props.host.updateSetting({ thinking: next }).then(() => {
          setNotice(copy.thinkingChanged(next))
        }).catch(() => {})
        return
      }
      case 'toggle-locale': {
        const next = snapshot.settings?.general.locale === 'en' ? 'zh' : 'en'
        void props.host.updateSetting({ locale: next }).then(() => {
          setNotice(copy.localeChanged(next))
        }).catch(() => {})
        return
      }
      case 'select-model': {
        if (row.meta?.provider === undefined || row.meta.model === undefined) return
        props.host.selectModel(row.meta.provider, row.meta.model)
        setNotice(copy.modelDefault(row.meta.model))
        return
      }
      case 'select-reasoning-effort': {
        if (row.meta?.provider === undefined || row.meta.model === undefined || row.meta.effort === undefined) return
        props.host.selectModel(row.meta.provider, row.meta.model, row.meta.effort)
        setNotice(copy.effortDefault(row.meta.effort))
        return
      }
      case 'edit-credential': {
        const credential = snapshot.settings?.models.credentials.find(entry => entry.ref === row.meta?.ref)
        if (credential === undefined) return
        if (!credential.writable) {
          setNotice(copy.credentialReadOnly(credential.ref))
          return
        }
        setSettingsEdit(row.key)
        setSettingsEditText('')
        return
      }
      case 'kill-job': {
        if (row.meta?.id === undefined) return
        props.host.killJob(row.meta.id)
        setNotice(copy.killJobRequested(row.meta.id))
        return
      }
      case 'resume-session': {
        if (row.meta?.id === undefined) return
        void props.host.resumeSession(row.meta.id).then((error) => {
          if (error !== null) {
            setNotice(error)
          } else {
            setNotice(copy.resumeDone(row.meta?.id ?? ''))
            setPanel(null)
            // The resumed transcript starts at the newest history tail.
            applyTranscriptScroll(0)
          }
        })
        return
      }
      case 'select-preset': {
        if (row.meta?.id === undefined) return
        void props.host.switchPreset(row.meta.id).then((error) => {
          if (error !== null) {
            setNotice(error)
          } else {
            // The switch is IN PLACE (the Web mechanism): the panel stays
            // open so the ● marker can move to the new preset.
            setNotice(copy.presetSwitched(row.meta?.id ?? ''))
          }
        })
        return
      }
      case 'toggle-plugin': {
        const id = row.meta?.id
        if (id === undefined) return
        if (pluginTogglePendingRef.current !== null) {
          setNotice(copy.pluginToggleBusy(pluginTogglePendingRef.current))
          return
        }
        pluginTogglePendingRef.current = id
        setNotice(copy.pluginTogglePending(id))
        void props.host.togglePlugin(id).then((result) => {
          setNotice(result.ok ? copy.pluginToggled(id, result.enabled) : copy.pluginToggleFailed(id, result))
        }).catch((error: unknown) => {
          setNotice(copy.pluginToggleFailed(id, {
            ok: false,
            code: 'apply-failed',
            detail: error instanceof Error ? error.message : String(error),
          }))
        }).finally(() => {
          if (pluginTogglePendingRef.current === id) pluginTogglePendingRef.current = null
        })
        return
      }
      case 'toggle-config-boolean': {
        if (row.meta?.ns === undefined || row.meta.field === undefined) return
        const current = row.text.includes('● ') && row.text.includes('= true')
        void props.host.updatePluginConfig(row.meta.ns, { [row.meta.field]: !current }).then((error) => {
          setNotice(error === null ? `${row.meta?.field ?? ''} → ${!current}` : error)
        })
        return
      }
      case 'edit-config-number':
      case 'edit-config-secret':
      case 'edit-config-string': {
        if (row.meta?.ns === undefined || row.meta.field === undefined) return
        const kind = row.action === 'edit-config-number' ? 'number' : row.action === 'edit-config-secret' ? 'secret' : 'string'
        setPluginEdit({ ns: row.meta.ns, field: row.meta.field, kind })
        // Secrets never prefetch their redacted marker into the draft.
        setPluginEditText(kind === 'secret' ? '' : row.text.split('= ', 2)[1]?.split(' · Enter')[0]?.trim() ?? '')
        return
      }
    }
  }, [snapshot, props.host, copy])

  /** Keep the selected panel row inside the visible window (scroll-follow). */
  const ensurePanelSelectionVisible = useCallback((selected: number): void => {
    setSettingsTop((current) => {
      if (selected < current) return selected
      if (selected >= current + panelListHeight) return selected - panelListHeight + 1
      return current
    })
  }, [panelListHeight])

  const handlePanelKey = useCallback((input: string, key: Key): boolean => {
    // Escape is intercepted upstream and routed through the debounced
    // handleEscape, so only Enter and non-escape panel keys arrive here.
    const isEnter = input.includes('\r') || input.includes('\n') || key.return
    if (pluginEdit !== null) {
      if (isEnter) commitPluginEdit()
      return true
    }
    if (settingsConfirm !== null) {
      if (isEnter) {
        commitCredentialEdit()
      }
      return true
    }
    if (settingsEdit !== null) {
      return true
    }
    if ((input === 'q' || input === 'Q') && (panel?.kind !== 'settings' || settingsFilter === '')) {
      // From a plugin-config editor, `q` returns to the plugins list.
      if (panel?.kind === 'plugin-config') {
        openPanel('settings', 'plugins')
        return true
      }
      setPanel(null)
      setNotice('')
      return true
    }
    if (panel?.kind === 'settings' && (key.tab || key.rightArrow || key.leftArrow)) {
      const nextPage = cycleSettingsPage(settingsPage, key.leftArrow ? -1 : 1)
      setPanel(previous => previous === null ? previous : { ...previous, settingsPage: nextPage })
      setSettingsSel(0)
      setSettingsTop(0)
      setSettingsFilter('')
      return true
    }
    if (key.upArrow) {
      const next = movePanelSelection(settingsRows, settingsSelClamped, -1)
      setSettingsSel(next)
      ensurePanelSelectionVisible(next)
      return true
    }
    if (key.downArrow) {
      const next = movePanelSelection(settingsRows, settingsSelClamped, 1)
      setSettingsSel(next)
      ensurePanelSelectionVisible(next)
      return true
    }
    if (key.pageUp) {
      // Top-anchored list: PageUp walks toward the older rows.
      setSettingsTop(value => Math.max(0, value - pageSize))
      return true
    }
    if (key.pageDown) {
      setSettingsTop(value => Math.min(settingsViewport.maximumOffset, value + pageSize))
      return true
    }
    if (isEnter) {
      activateSettingsRow(settingsRows[settingsSelClamped])
      return true
    }
    if (panel?.kind === 'settings') {
      if (key.backspace) {
        setSettingsFilter(current => current.slice(0, -1))
        return true
      }
      if (input.length === 1 && input >= ' ' && !input.startsWith('\x1b')) {
        setSettingsFilter(current => current + input)
        return true
      }
    }
    return false
  }, [
    pluginEdit, commitPluginEdit, settingsConfirm, settingsEdit, commitCredentialEdit, panel, settingsPage, settingsRows, settingsSel,
    settingsSelClamped, settingsViewport.maximumOffset, pageSize, activateSettingsRow, ensurePanelSelectionVisible, openPanel,
    settingsFilter,
  ])

  /** Retain each answer in a batch and resolve the provider after the last question. */
  const completeQuestion = useCallback((answer: { id: string; selected: string[]; custom?: string }): void => {
    if (pendingQuestion === null) return
    const answers = [...questionAnswers, answer]
    if (questionIndex >= pendingQuestion.questions.length - 1) {
      props.host.answerQuestion(answers)
      setQuestionAnswers([])
      setQuestionIndex(0)
    } else {
      setQuestionAnswers(answers)
      setQuestionIndex(index => index + 1)
    }
    setQuestionSel(0)
    setQuestionSelected(new Set())
    setQuestionText('')
  }, [pendingQuestion, props.host, questionAnswers, questionIndex])

  // ── input routing ─────────────────────────────────────────────────────
  // Every Escape action funnels through here so the 60ms phantom-Escape
  // confirmation window can drop split-CSI artifacts without side effects.
  const handleEscape = useEffectEvent(() => {
    if (snapshot.resumeProgress !== null) {
      props.host.cancelResume()
      return
    }
    const composerMark = composerMarkRef.current
    if (composerMark !== null && composerMark.anchor !== composerMark.head) {
      composerMarkRef.current = null
      setComposerClearSeq(seq => seq + 1)
      return
    }
    if (textSelection !== null) {
      textSelectionRef.current = null
      setTextSelection(null)
      selectingRef.current = false
      selectPressRef.current = null
      selectionLinesRef.current = new Map()
      stopSelectScroll()
      return
    }
    if (pluginEdit !== null) {
      setPluginEdit(null)
      setPluginEditText('')
      return
    }
    if (settingsConfirm !== null) {
      setSettingsConfirm(null)
      setSettingsEdit(null)
      setSettingsEditText('')
      return
    }
    if (settingsEdit !== null) {
      setSettingsEdit(null)
      setSettingsEditText('')
      return
    }
    if (panelOpen) {
      // Esc from a plugin-config editor returns to the plugins list.
      if (panel?.kind === 'plugin-config') {
        openPanel('settings', 'plugins')
        return
      }
      if (panel?.kind === 'settings' && settingsFilter !== '') {
        setSettingsFilter('')
        return
      }
      setPanel(null)
      setNotice('')
      return
    }
    if (pendingApproval !== null) {
      props.host.approve('rejected')
      setApprovalSel(0)
      return
    }
    if (pendingQuestion !== null) {
      const question = pendingQuestion.questions[questionIndex]
      if (question !== undefined) {
        completeQuestion({ id: question.id, selected: [] })
      }
      return
    }
    if (palette !== null && palette.length > 0) {
      setPaletteDismissedInput(draft)
      return
    }
    if (draft !== '') assignDraft('')
    else if (snapshot.busy) props.host.cancel()
  })
  useEffect(() => () => {
    escapeArbiter.cancel()
    stopSelectScroll()
  }, [stopSelectScroll])

  useInput((input, key) => {
    // The terminal's title report (the `ESC]l<title>ESC\` answer to our
    // `ESC[21t` query) must never reach the composer; capture it for the
    // exit restore. The head may arrive split from the tail.
    const titleReport = /^\x1b?\]l([^\x07\x1b]*)\x1b?(?:\\|\x07)$/.exec(input)
    if (titleReport !== null) {
      restoredTitleRef.current = titleReport[1] ?? ''
      return
    }
    if (input.startsWith(']l')) return
    if (key.escape) {
      escapeArbiter.schedule(() => { handleEscape() })
      return
    }
    // A bare CSI tail inside a pending-Escape window is the second half of a
    // split arrow/function key: cancel the phantom Escape and act as that
    // key. Any other key also cancels it (a real Esc followed by fast typing
    // loses the Esc, which the keypress itself supersedes anyway).
    if (escapeArbiter.hasPending()) {
      const tail = escapeArbiter.cancel() ? csiTailKey(input) : null
      if (tail !== null) {
        key = { ...key, ...syntheticKey(tail) }
      }
    }
    // A fresh '/' keystroke always re-arms the slash picker: any dismissal
    // left behind by an earlier Escape at the same input value must not
    // swallow the next invocation.
    if (input === '/') setPaletteDismissedInput(null)
    if (key.ctrl && input.toLowerCase() === 'c') {
      const mark = composerMarkRef.current
      if (
        pluginEdit?.kind !== 'secret'
        && pendingApproval === null
        && pendingQuestion === null
        && !panelOpen
        && mark !== null
        && mark.anchor !== mark.head
      ) {
        const value = pluginEdit !== null ? pluginEditText : settingsEdit !== null ? settingsEditText : draft
        const selected = value.slice(Math.min(mark.anchor, mark.head), Math.max(mark.anchor, mark.head))
        if (selected !== '') {
          void copyToClipboard(selected, stdout).then((outcome) => {
            setNotice(outcome.ok ? copy.copyDone : copy.copyFailed(outcome.error ?? 'unknown'))
          })
        }
        return
      }
      const now = Date.now()
      if (now - lastCtrlCAt.current <= CTRL_C_EXIT_WINDOW_MS) {
        exitApp()
        return
      }
      lastCtrlCAt.current = now
      if (snapshot.busy) {
        props.host.cancel()
        setNotice(copy.cancelRequested)
      } else {
        setNotice(copy.exitHint)
      }
      return
    }
    // Shift+Tab rotates file policy. A matching release, or a CSI-Z that
    // ConPTY flushes in the same drain as Enter, must not rotate again.
    const looksLikeShiftTab = (key.shift && key.tab) || input === '\x1b[Z'
    if (looksLikeShiftTab) {
      permissionCycleRef.current.request(input, key, () => {
        setPendingSandbox(props.host.cycleSandbox())
      })
      return
    }
    // The wheel scrolls the panel when one is open, the transcript otherwise.
    // Panels anchor to the TOP, so wheel-up walks toward older rows.
    const wheel = parseMouseWheel(input)
    if (wheel !== null) {
      if (selectingRef.current) return
      if (textSelection !== null) {
        textSelectionRef.current = null
        setTextSelection(null)
        selectionLinesRef.current = new Map()
      }
      if (panelOpen) {
        panelWheelDeltaRef.current += wheel === 'up' ? -3 : 3
        if (!wheelCoalesceRef.current) {
          wheelCoalesceRef.current = true
          queueMicrotask(() => {
            wheelCoalesceRef.current = false
            const delta = panelWheelDeltaRef.current
            panelWheelDeltaRef.current = 0
            if (delta === 0) return
            setSettingsTop(current => Math.max(0, Math.min(settingsViewport.maximumOffset, current + delta)))
          })
        }
      } else {
        wheelBurstRef.current.push(wheel)
        if (!wheelCoalesceRef.current) {
          wheelCoalesceRef.current = true
          queueMicrotask(() => {
            wheelCoalesceRef.current = false
            const ticks = wheelBurstRef.current
            wheelBurstRef.current = []
            if (ticks.length === 0) return
            applyTranscriptScroll(current => ticks.reduce(
              (offset, direction) => scrollOffsetForWheel(offset, transcriptMaximumOffset.current, direction),
              current,
            ))
          })
        }
      }
      return
    }
    // A mouse click can activate the floating back-to-bottom button, the
    // right-edge scrollbar, or a transcript disclosure arrow. Thinking
    // arrows change the global Thinking display setting; other disclosure
    // arrows retain per-node expansion. The transcript occupies 1-based rows
    // 5..4+height; its text begins at column 2 after the left padding cell.
    const click = parseMouseReport(input)
    if (click !== null && (click.button & 64) === 0) {
      if ((click.button & 32) !== 0) {
        // Drag motion: scrollbar thumb, or transcript text selection.
        if (scrollbarDragRef.current && !panelOpen) {
          const backButtonVisible = transcriptScrollOffset > 0
          const contentHeight = transcriptHeight - (backButtonVisible ? 1 : 0)
          const maximum = transcriptMaximumOffset.current
          const reserved = backButtonVisible ? 1 : 0
          const geometry = selectScrollbar(
            transcriptLineCountRef.current, transcriptHeight, transcriptScrollOffset, reserved,
          )
          if (geometry.visible && click.row >= 5 && click.row <= 4 + contentHeight) {
            applyTranscriptScroll(scrollOffsetForScrollbarRow(click.row, 5, contentHeight, maximum))
          }
        } else if (selectingRef.current && !panelOpen) {
          armSelectScroll(click.row, click.column)
          extendTranscriptSelection(click.row, click.column)
        }
        return
      }
      if (click.action === 'release') {
        scrollbarDragRef.current = false
        stopSelectScroll()
        if (selectingRef.current) {
          selectingRef.current = false
          const current = textSelectionRef.current
          textSelectionRef.current = null
          selectPressRef.current = null
          setTextSelection(null)
          if (current !== null && selectionIsDrag(current)) {
            const selected = extractSelectedText(selectionLinesRef.current, current)
            if (selected !== '') {
              void copyToClipboard(selected, stdout).then((outcome) => {
                setNotice(outcome.ok ? copy.copyDone : copy.copyFailed(outcome.error ?? 'unknown'))
              })
            }
          }
          selectionLinesRef.current = new Map()
        }
        return
      }
      if (click.row >= 5 + transcriptHeight) {
        textSelectionRef.current = null
        setTextSelection(null)
        selectingRef.current = false
        selectPressRef.current = null
        selectionLinesRef.current = new Map()
        stopSelectScroll()
        return
      }
      if (click.action === 'press' && panelOpen && click.button === 0 && panel?.kind === 'settings') {
        const region = settingsChromeHit(click.row, 4)
        if (region === 'tab') {
          const hit = hitSettingsTab(click.column, locale)
          if (hit !== undefined) {
            setPanel(previous => previous === null ? previous : { ...previous, settingsPage: hit })
            setSettingsSel(0)
            setSettingsTop(0)
            setSettingsFilter('')
          }
          return
        }
        if (region === 'search' || region === 'hint') return
        if (region === 'list') {
          const index = settingsListIndex(click.row, settingsTop, 4)
          if (index >= 0 && index < settingsTop + panelListHeight) {
            const row = settingsRows[index]
            if (row !== undefined) {
              setSettingsSel(index)
              if (row.action !== undefined) activateSettingsRow(row)
            }
          }
        }
        return
      }
      if (click.action === 'press' && !panelOpen) {
        if (transcriptScrollOffset > 0 && click.row === 4 + transcriptHeight) {
          applyTranscriptScroll(0)
          return
        }
        if (click.button === 0 && click.column >= width) {
          const backButtonVisible = transcriptScrollOffset > 0
          const contentHeight = transcriptHeight - (backButtonVisible ? 1 : 0)
          const maximum = transcriptMaximumOffset.current
          const reserved = backButtonVisible ? 1 : 0
          const geometry = selectScrollbar(
            transcriptLineCountRef.current, transcriptHeight, transcriptScrollOffset, reserved,
          )
          if (geometry.visible && click.row >= 5 && click.row <= 4 + contentHeight) {
            scrollbarDragRef.current = true
            applyTranscriptScroll(scrollOffsetForScrollbarRow(click.row, 5, contentHeight, maximum))
          }
          return
        }
        if (click.button === 0) {
          const backButtonVisible = transcriptScrollOffset > 0
          const windowed = snapshotTranscriptWindow(transcriptScrollOffsetRef.current)
          const line = transcriptLineAtRow(
            windowed.lines,
            transcriptHeight,
            windowed.relativeOffset,
            backButtonVisible ? 1 : 0,
            click.row - 5,
          )
          const hasArrow = line !== undefined && (line.text.endsWith('▶') || line.text.endsWith('▼'))
          const arrowColumn = line === undefined ? -1 : stringWidth(line.text) + 1
          const disclosureNodeId = line?.disclosureNodeId
          if (hasArrow && click.column === arrowColumn && disclosureNodeId !== undefined) {
            if (line.disclosureKind === 'thinking') {
              const next = thinkDefaultOpen ? 'collapsed' : 'expanded'
              void props.host.updateSetting({ thinking: next }).catch((error: unknown) => {
                setNotice(error instanceof Error ? error.message : String(error))
              })
            } else {
              setExpanded((previous) => {
                const next = new Set(previous)
                if (next.has(disclosureNodeId)) next.delete(disclosureNodeId)
                else next.add(disclosureNodeId)
                return next
              })
            }
            return
          }
          selectionLinesRef.current = new Map()
          const cell = hitTranscriptCell(
            click.row,
            click.column,
            transcriptScrollOffsetRef.current,
            true,
          )
          if (cell !== undefined) {
            const span = glyphSpanAt(cell.line.text, cell.column)
            selectingRef.current = true
            selectPressRef.current = {
              lineIndex: cell.lineIndex,
              start: span.start,
              end: span.end,
            }
            textSelectionRef.current = {
              anchor: { lineIndex: cell.lineIndex, column: span.start },
              head: { lineIndex: cell.lineIndex, column: span.start },
            }
            setTextSelection(null)
          } else {
            selectingRef.current = false
            selectPressRef.current = null
            textSelectionRef.current = null
            setTextSelection(null)
            selectionLinesRef.current = new Map()
          }
        }
      }
      return
    }
    if (panelOpen) {
      handlePanelKey(input, key)
      return
    }
    if (key.pageUp || (key.ctrl && key.home)) {
      applyTranscriptScroll((current) => {
        const maximum = transcriptMaximumOffset.current
        return key.home ? maximum : Math.min(maximum, current + pageSize)
      })
      return
    }
    if (key.pageDown || (key.end && (key.ctrl || transcriptScrollOffset > 0))) {
      applyTranscriptScroll((current) => {
        const clamped = Math.min(current, transcriptMaximumOffset.current)
        return key.end ? 0 : Math.max(0, clamped - pageSize)
      })
      return
    }
    if (pendingApproval !== null) {
      if (input === 'y' || input === 'Y' || (key.return && approvalSel === 0)) {
        props.host.approve('allowed-once')
        setApprovalSel(0)
      } else if (input === 'n' || input === 'N' || (key.return && approvalSel === 1)) {
        props.host.approve('rejected')
        setApprovalSel(0)
      } else if (key.upArrow || key.downArrow) {
        setApprovalSel(approvalSel === 0 ? 1 : 0)
      }
      return
    }
    if (pendingQuestion !== null) {
      const question = pendingQuestion.questions[questionIndex]
      if (question !== undefined) {
        const options = question.options ?? []
        const multi = question.multiSelect === true
        if (key.upArrow && options.length > 0) {
          setQuestionSel(Math.max(0, questionSel - 1))
        } else if (key.downArrow && options.length > 0) {
          setQuestionSel(Math.min(options.length - 1, questionSel + 1))
        } else if (key.return && key.shift) {
          setQuestionText(value => `${value}\n`)
        } else if (key.return) {
          if (multi) {
            const selected = options.flatMap((option, index) => questionSelected.has(index) ? [option.label] : [])
            completeQuestion({ id: question.id, selected, ...(questionText === '' ? {} : { custom: questionText }) })
          } else if (options.length > 0 && questionText === '') {
            const selected = options[Math.min(questionSel, options.length - 1)]?.label
            completeQuestion({ id: question.id, selected: selected === undefined ? [] : [selected] })
          } else {
            completeQuestion({ id: question.id, selected: [], ...(questionText === '' ? {} : { custom: questionText }) })
          }
        } else if (input === ' ' && multi && questionText === '' && options.length > 0) {
          setQuestionSelected((current) => {
            const next = new Set(current)
            if (next.has(questionSel)) next.delete(questionSel)
            else next.add(questionSel)
            return next
          })
        } else if (key.backspace) {
          setQuestionText(value => value.slice(0, -1))
        } else if (input !== '' && !key.tab) {
          // Typing enters a custom answer. Multi-select keeps already toggled
          // labels and submits the custom text alongside them.
          setQuestionText(value => value + sanitizeTerminalText(input))
        }
      }
      return
    }
    if (palette !== null && palette.length > 0) {
      if (key.upArrow || key.downArrow) {
        setPaletteSelectedIndex((current) => {
          const count = palette.length
          return key.upArrow ? (current - 1 + count) % count : (current + 1) % count
        })
        return
      }
      if (key.tab) {
        applyPalette(true)
        return
      }
      return
    }
    // Idle Tab has no transcript action. Tab remains owned by slash palettes
    // and settings-page navigation, while Shift+Tab keeps its permission role.
    if (key.tab) {
      return
    }
    const history = historyRef.current
    if (key.upArrow) {
      if (draft !== '') return
      if (history.length === 0) return
      if (historyIndex === -1) historyScratchRef.current = draft
      const nextIndex = historyIndex === -1
        ? history.length - 1
        : Math.max(0, historyIndex - 1)
      setHistoryIndex(nextIndex)
      assignDraft(history[nextIndex] ?? '')
      setPaletteDismissedInput(null)
      return
    }
    if (key.downArrow) {
      if (draft !== '') return
      if (historyIndex === -1) return
      const nextIndex = historyIndex + 1
      if (nextIndex >= history.length) {
        setHistoryIndex(-1)
        assignDraft(historyScratchRef.current)
        historyScratchRef.current = ''
      } else {
        setHistoryIndex(nextIndex)
        assignDraft(history[nextIndex] ?? '')
      }
      setPaletteDismissedInput(null)
      return
    }
    if (key.ctrl && input === 'l') {
      setNotice('')
      assignDraft('')
      return
    }
    if (key.ctrl && input === 'd') {
      if (draft === '' && !snapshot.busy) exitApp()
      return
    }
  })

  // The composer becomes the masked credential/plugin-config editor while a
  // credential row or plugin field is being edited inside a panel.
  const composerFocused = pluginEdit !== null || settingsEdit !== null
    ? true
    : pendingApproval === null && pendingQuestion === null && !panelOpen

  return (
    <Box flexDirection="column" width={width} height={rowCount} overflow="hidden">
      <Header snapshot={snapshot} width={width} theme={theme} />
      {panelOpen ? (
        <Box flexDirection="column" height={Math.max(1, panelHeight)} overflow="hidden">
          {panel?.kind === 'settings' ? (
            <SettingsChrome
              page={settingsPage}
              locale={locale}
              theme={theme}
              width={width}
              query={settingsFilter}
            />
          ) : null}
          <PanelView
            rows={settingsRows}
            height={panelListHeight}
            offset={settingsTop}
            selectedIndex={settingsSelClamped}
            theme={theme}
          />
        </Box>
      ) : (
        <ChatTranscript
          settledBlocks={settledBlocks}
          dockLines={dockLines}
          snapshot={snapshot}
          height={transcriptHeight}
          width={width}
          contentWidth={transcriptContentWidth}
          offset={transcriptScrollOffset}
          onMaximumOffsetChange={updateTranscriptMaximumOffset}
          theme={theme}
          locale={locale}
          backButton={transcriptScrollOffset > 0}
          linesRef={transcriptLinesRef}
          windowOffsetRef={transcriptWindowOffsetRef}
          blocksRef={transcriptBlocksRef}
          selection={textSelection}
        />
      )}
      {panelNoticeVisible ? (
        <Text dimColor>{fitDisplayText(notice.split('\n')[0] ?? '', Math.max(1, width - 2))}</Text>
      ) : null}
      {palette !== null && !panelOpen ? (
        <CommandPaletteView
          matches={palette}
          selectedIndex={paletteSelectedIndex}
          width={width - 2}
          height={Math.max(1, paletteH)}
          locale={locale}
          theme={theme}
          {...skillPaletteActive
            ? { title: copy.skillPaletteTitle, hint: copy.skillPaletteHint }
            : palette.some(item => item.command?.startsWith('/effort ') ?? false)
              ? {
                title: locale === 'zh'
                  ? '╭─ 推理力度（↑↓ 选择 · Enter 应用 · Tab 补全 · Esc 取消）'
                  : '╭─ reasoning effort (↑↓ select · Enter apply · Tab complete · Esc close)',
                hint: locale === 'zh'
                  ? '╰─ off / low / high / max · Enter 应用'
                  : '╰─ off / low / high / max · Enter applies',
              }
              : palette.some(item => item.insert !== undefined)
                ? { title: copy.filePaletteTitle, hint: copy.filePaletteHint }
                : {}}
        />
      ) : null}
      {takeoverH > 0 ? (
        <Takeover
          snapshot={snapshot}
          approvalSel={approvalSel}
          questionIndex={questionIndex}
          questionSel={questionSel}
          questionSelected={questionSelected}
          questionText={questionText}
          width={width}
          height={takeoverH}
          locale={locale}
          theme={theme}
        />
      ) : null}
      <PermissionBar sandbox={sandbox} costUsd={snapshot.stats.costUsd} width={width} locale={locale} theme={theme} />
      <Composer
        draft={composerDraft}
        onDraftChange={pluginEdit !== null
          ? setPluginEditText
          : settingsEdit !== null
            ? setSettingsEditText
            : (value: string) => {
              // Every keystroke clears a stale picker dismissal so the
              // palette can never stay suppressed after an Escape, and
              // edits a recalled history line (leaving history browsing).
              setPaletteDismissedInput(null)
              if (historyIndex !== -1 && value !== '') setHistoryIndex(-1)
              setDraft((current) => {
                const next = props.host.syncImageChips(current, value)
                if (next !== value) setDraftSeq(seq => seq + 1)
                return next
              })
            }}
        onSubmit={submitComposer}
        disabled={pluginEdit !== null || settingsEdit !== null
          ? false
          : (pendingApproval !== null || pendingQuestion !== null || panelOpen)}
        focused={composerFocused}
        width={width}
        placeholder={pluginEdit !== null
          ? (pluginEdit.kind === 'secret' ? copy.secretPlaceholder : pluginEdit.kind === 'number' ? copy.numberPlaceholder : copy.stringPlaceholder)
          : settingsEdit !== null ? copy.credentialPlaceholder : copy.placeholder}
        theme={theme}
        locale={locale}
        markOutRef={composerMarkRef}
        clearSeq={composerClearSeq}
        draftSeq={draftSeq}
        {...(pluginEdit?.kind === 'secret' ? { mask: '•' } : {})}
        onClipboardImage={async (fallbackToText) => {
          const result = await props.host.attachClipboardImage()
          if (result.error !== null) {
            if (!(fallbackToText && result.empty === true)) setNotice(result.error)
            return false
          }
          if (result.chip !== undefined) {
            assignDraft(current => insertImageChip(current, current.length, result.chip).draft)
          }
          setNotice(copy.attachDone('clipboard'))
          return true
        }}
        onPasteText={(text) => {
          const imageBatch = classifyPastedImagePaths(text)
          if (imageBatch !== null) {
            void props.host.attachFiles(imageBatch.map(image => image.path)).then((result) => {
              if (result.error !== null) {
                setNotice(result.error)
                return
              }
              if (result.chips !== undefined) {
                assignDraft(current => result.chips?.reduce(
                  (next, chip) => insertImageChip(next, next.length, chip).draft,
                  current,
                ) ?? current)
              }
              setNotice(copy.attachDone(`${imageBatch.length} ${locale === 'zh' ? '张图片' : 'images'}`))
            })
            return ''
          }
          const classified = classifyPastedPath(text)
          if (classified === null) {
            if (!shouldCollapsePastedText(text)) return null
            const block = createPastedTextBlock(text, nextPastedTextOrdinalRef.current)
            nextPastedTextOrdinalRef.current += 1
            replacePastedTextBlocks([...pastedTextBlocksRef.current, block])
            return block.token
          }
          if (classified.kind === 'file') return resolve(snapshot.cwd, classified.path)
          void props.host.attachFile(classified.path).then((result) => {
            if (result.error !== null) {
              setNotice(result.error)
              return
            }
            if (result.chip !== undefined) {
              assignDraft(current => insertImageChip(current, current.length, result.chip).draft)
            }
            setNotice(copy.attachDone(classified.path))
          })
          return ''
        }}
      />
      <StatusBar
        snapshot={snapshot}
        width={width}
        panelOpen={panelOpen}
        scrollOffset={transcriptScrollOffset}
        locale={locale}
        theme={theme}
      />
    </Box>
  )
}

/**
 * Mount the Ink 7 app in the alternate screen and resolve when it exits
 * (user command or Ctrl+C). Ink owns raw mode, the alternate screen, and the
 * cursor position.
 * @param store - the UI store.
 * @param host - submit/cancel/exit/answer callbacks.
 */
export async function runInk(store: TuiStore, host: TuiHost): Promise<void> {
  const instance = render(
    <App store={store} host={host} />,
    {
      alternateScreen: true,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: true,
      // The root intentionally leaves the physical last column blank, making
      // Ink's Windows fullscreen line diff safe. A columns/rows change still
      // takes one clearTerminal paint. Same-size Windows frames rewrite from
      // CUP 1;1 + erase-down so ConPTY wrap cannot leave overlapping cells.
      // If the terminal applies backpressure, Ink retains only one redraw.
      incrementalRendering: true,
      windowsFullscreenDiff: true,
      coalesceBackpressuredFrames: true,
    },
  )
  let exitError: unknown
  try {
    await instance.waitUntilExit()
  } catch (error) {
    exitError = error
  } finally {
    try {
      instance.unmount()
    } catch {
      // Ink may already have unmounted after useApp().exit().
    }
    try {
      // Ink discards effect-cleanup output while leaving the alternate screen,
      // so the terminal owner repeats the app-owned mouse-mode reset afterward.
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(DISABLE_WHEEL_MOUSE + RESTORE_CURSOR_STYLE, (error) => {
          if (error === null || error === undefined) resolve()
          else reject(error)
        })
      })
    } catch {
      // Process shutdown may close stdout before the mouse reset is written.
    }
  }
  if (exitError !== undefined) throw exitError
  host.exit()
}
