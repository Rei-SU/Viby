/**
 * One frame of a digital scramble. Digits before their lock time are random;
 * digits after it show the target. Lock times stagger left to right, so the
 * display settles onto the real value like a slot machine.
 *
 * `random` is injectable so the frame logic can be tested deterministically.
 */
export type ScrambleOptions = {
  /** Time before the first digit locks. */
  lead?: number
  /** Extra time each subsequent digit keeps scrambling. */
  stagger?: number
  random?: () => number
}

export type ScrambleFrame = { text: string; done: boolean }

export function scrambleClock(
  target: string,
  elapsed: number,
  { lead = 360, stagger = 110, random = Math.random }: ScrambleOptions = {}
): ScrambleFrame {
  let order = 0
  let done = true
  let text = ''

  for (const char of target) {
    if (/\d/.test(char)) {
      if (elapsed >= lead + order * stagger) {
        text += char
      } else {
        done = false
        text += String(Math.floor(random() * 10))
      }
      order++
    } else {
      text += char
    }
  }

  return { text, done }
}
