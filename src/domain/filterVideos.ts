import type { CatalogVideo } from './catalog'

export type VideoFilter = 'all' | 'video' | 'live' | 'with-chapters' | 'without-chapters'
export type VideoOrder = 'recent' | 'oldest'

export interface FilterVideoOptions {
  query: string
  filter: VideoFilter
  order: VideoOrder
}

const RFC3339_SORT_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/

interface Rfc3339SortKey {
  epochSecond: number
  fraction: string
  leapSecond: boolean
}

function rfc3339SortKey(value: string): Rfc3339SortKey {
  const match = RFC3339_SORT_TIMESTAMP.exec(value)
  if (match === null) {
    throw new TypeError('Horodatage RFC3339 invalide')
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', offsetSign, offsetHourText, offsetMinuteText] = match
  const localMinute = new Date(0)
  localMinute.setUTCFullYear(Number(yearText), Number(monthText) - 1, Number(dayText))
  localMinute.setUTCHours(Number(hourText), Number(minuteText), 0, 0)
  const offsetMinutes = (Number(offsetHourText ?? 0) * 60 + Number(offsetMinuteText ?? 0))
    * (offsetSign === '-' ? -1 : 1)
  const second = Number(secondText)

  return {
    epochSecond: localMinute.getTime() / 1_000 - offsetMinutes * 60 + second,
    fraction,
    leapSecond: second === 60,
  }
}

function compareRfc3339(left: string, right: string): number {
  const leftKey = rfc3339SortKey(left)
  const rightKey = rfc3339SortKey(right)

  if (leftKey.epochSecond !== rightKey.epochSecond) {
    return leftKey.epochSecond - rightKey.epochSecond
  }
  if (leftKey.leapSecond !== rightKey.leapSecond) {
    return leftKey.leapSecond ? -1 : 1
  }

  const fractionLength = Math.max(leftKey.fraction.length, rightKey.fraction.length)
  const leftFraction = leftKey.fraction.padEnd(fractionLength, '0')
  const rightFraction = rightKey.fraction.padEnd(fractionLength, '0')
  return leftFraction < rightFraction ? -1 : leftFraction > rightFraction ? 1 : 0
}

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export function filterVideos(
  videos: readonly CatalogVideo[],
  options: FilterVideoOptions,
): CatalogVideo[] {
  const query = normalizeSearch(options.query.trim())

  return videos
    .filter((video) => {
      if (options.filter === 'video') {
        return video.kind === 'video'
      }
      if (options.filter === 'live') {
        return video.kind === 'live'
      }
      if (options.filter === 'with-chapters') {
        return video.chapterStatus === 'ready'
      }
      if (options.filter === 'without-chapters') {
        return video.chapterStatus !== 'ready'
      }
      return true
    })
    .filter((video) => {
      if (query.length === 0) {
        return true
      }
      return normalizeSearch(video.title).includes(query)
        || video.chapters.some((chapter) => normalizeSearch(chapter.title).includes(query))
    })
    .sort((left, right) => {
      const difference = compareRfc3339(left.publishedAt, right.publishedAt)
      return options.order === 'recent' ? -difference : difference
    })
}
