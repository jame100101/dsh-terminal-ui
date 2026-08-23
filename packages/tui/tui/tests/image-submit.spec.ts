import { describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createTuiUserMessage, encodeTuiCommandImages } from '../src/image-submit'

const IMAGE: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:test'),
  mediaType: 'image/png',
  bytes: 4,
  width: 2,
  height: 2,
  name: 'shot.png',
}

describe('TUI image submission', () => {
  it('puts durable images into the model-visible user message', () => {
    const message = createTuiUserMessage('describe this', [IMAGE])
    expect(message.content).toEqual([
      { type: 'text', text: 'describe this' },
      { type: 'image', attachment: IMAGE },
    ])
    expect(message.source).toEqual({ kind: 'user' })
  })

  it('verifies and base64-encodes slash-command images in order', async () => {
    const readImage = vi.fn().mockResolvedValue({ ref: IMAGE, data: Uint8Array.of(1, 2, 3, 4) })
    await expect(encodeTuiCommandImages({ readImage }, [IMAGE])).resolves.toEqual([{
      mediaType: 'image/png',
      data: 'AQIDBA==',
      name: 'shot.png',
    }])
    expect(readImage).toHaveBeenCalledWith(IMAGE)
    await expect(encodeTuiCommandImages({ readImage }, [])).resolves.toEqual([])
  })
})
