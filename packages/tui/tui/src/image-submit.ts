/**
 * Convert pending durable images into the two Harness submission forms used
 * by TUI text turns and slash commands.
 * @module @deepseek-ai/dsh-tui/src/image-submit
 */

import type { EncodedImageAttachment, ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Minimal attachment reader needed by slash-command image encoding. */
export interface ImageAttachmentReader {
  readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment>
}

/**
 * Build the identified user message used by ordinary TUI submissions.
 * @param text - prose after composer chip removal.
 * @param attachments - durable pending image references in user order.
 * @returns a user message whose image blocks reach LLM request assembly.
 */
export function createTuiUserMessage(
  text: string,
  attachments: readonly ImageAttachmentRef[] = [],
): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [
      { type: 'text', text },
      ...attachments.map(attachment => ({ type: 'image' as const, attachment })),
    ],
    source: { kind: 'user' },
  })
}

/**
 * Encode durable refs for the command service's wire-compatible image input.
 * @param reader - attachment service that verifies stored bytes.
 * @param refs - durable refs in composer order.
 * @returns base64 images in the same order.
 */
export async function encodeTuiCommandImages(
  reader: ImageAttachmentReader,
  refs: readonly ImageAttachmentRef[],
): Promise<EncodedImageAttachment[]> {
  const out: EncodedImageAttachment[] = []
  for (const ref of refs) {
    const stored = await reader.readImage(ref)
    out.push({
      mediaType: ref.mediaType,
      data: Buffer.from(stored.data).toString('base64'),
      ...(ref.name === undefined ? {} : { name: ref.name }),
    })
  }
  return out
}
