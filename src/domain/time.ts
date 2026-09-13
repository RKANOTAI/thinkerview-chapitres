const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

function invalidIsoDuration(value: string): never {
  throw new Error(`Durée ISO invalide: ${value}`)
}

export function parseIsoDuration(value: string): number {
  const match = ISO_DURATION.exec(value)
  if (!match) {
    return invalidIsoDuration(value)
  }

  const [, days, hours, minutes, seconds] = match
  const hasDateComponent = days !== undefined
  const hasTimeComponent = [hours, minutes, seconds].some((part) => part !== undefined)
  if (!hasDateComponent && !hasTimeComponent) {
    return invalidIsoDuration(value)
  }
  if (value.includes('T') && !hasTimeComponent) {
    return invalidIsoDuration(value)
  }

  const totalSeconds = BigInt(days ?? 0) * 86_400n
    + BigInt(hours ?? 0) * 3_600n
    + BigInt(minutes ?? 0) * 60n
    + BigInt(seconds ?? 0)

  if (totalSeconds > MAX_SAFE_INTEGER_BIGINT) {
    return invalidIsoDuration(value)
  }
  return Number(totalSeconds)
}

export function formatTimestamp(totalSeconds: number): string {
  if (!Number.isSafeInteger(totalSeconds) || totalSeconds < 0) {
    throw new Error(`Timestamp invalide: ${totalSeconds}`)
  }

  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function parseTimestampLabel(value: string): number {
  const parts = value.split(':')
  if (parts.length !== 2 && parts.length !== 3) {
    throw new Error(`Timestamp invalide: ${value}`)
  }
  if (parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error(`Timestamp invalide: ${value}`)
  }

  const numbers = parts.map((part) => BigInt(part))
  let totalSeconds: bigint
  if (parts.length === 2) {
    const [minutes, seconds] = numbers
    if (seconds >= 60n) {
      throw new Error(`Timestamp invalide: ${value}`)
    }
    totalSeconds = minutes * 60n + seconds
  } else {
    const [hours, minutes, seconds] = numbers
    if (minutes >= 60n || seconds >= 60n) {
      throw new Error(`Timestamp invalide: ${value}`)
    }
    totalSeconds = hours * 3_600n + minutes * 60n + seconds
  }

  if (totalSeconds > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`Timestamp invalide: ${value}`)
  }
  return Number(totalSeconds)
}
