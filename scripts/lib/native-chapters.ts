import type { Chapter } from '../../src/domain/catalog'
import { parseTimestampLabel } from '../../src/domain/time'

const CHAPTER_LINE = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(?:[-–—]\s*)?(.+?)\s*$/

export function parseNativeChapters(description: string): Chapter[] {
  const chapters: Chapter[] = []

  for (const line of description.split('\n')) {
    const match = CHAPTER_LINE.exec(line)
    if (!match) {
      continue
    }

    let startSeconds: number
    try {
      startSeconds = parseTimestampLabel(match[1])
    } catch {
      continue
    }

    chapters.push({
      startSeconds,
      title: match[2],
    })
  }

  if (chapters.length < 3 || chapters[0].startSeconds !== 0) {
    return []
  }

  for (let index = 1; index < chapters.length; index += 1) {
    if (chapters[index].startSeconds - chapters[index - 1].startSeconds < 10) {
      return []
    }
  }

  return chapters
}
