import { scrambleClock } from '../src/renderer/lib/pixel-scramble'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const nine = (): number => 0.9
const frame = (elapsed: number, target = '17:10') =>
  scrambleClock(target, elapsed, { lead: 100, stagger: 100, random: nine })

const start = frame(0)
check('every digit is random before the lead', start.text === '99:99' && !start.done, JSON.stringify(start))
check('the colon never scrambles', start.text[2] === ':', start.text)
check('the first digit locks at the lead', frame(100).text === '19:99', frame(100).text)
check('the second digit locks next', frame(200).text === '17:99', frame(200).text)
check('the third digit locks next', frame(300).text === '17:19', frame(300).text)
check(
  'the final digit lands on the target',
  frame(400).text === '17:10' && frame(400).done,
  JSON.stringify(frame(400))
)
check(
  'the frame is not done while any digit is unlocked',
  frame(100).done === false && frame(300).done === false
)

const zero = scrambleClock('17:10', 0, { lead: 100, stagger: 100, random: () => 0 })
check('random digits stay inside 0–9', zero.text === '00:00', zero.text)

const long = '120:05'
check(
  'three-digit hours settle in the same order',
  frame(400, long).text === '120:09' && frame(500, long).text === long && frame(500, long).done,
  JSON.stringify({ at400: frame(400, long), at500: frame(500, long) })
)

if (failures > 0) {
  console.error(`\npixel-scramble: ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\npixel-scramble: all checks passed')
