// Проверка UI-правил: в стилях и разметке нет декоративных эффектов.
// Запуск: npm run check:style (выходит с кодом 1, если что-то найдено).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BANNED = [
  [/gradient\(/i, 'градиент'],
  [/@keyframes/i, 'keyframes-анимация'],
  [/animation\s*:/i, 'CSS-анимация'],
  [/box-shadow\s*:\s*0 0 \d+px/i, 'свечение (box-shadow без смещения)'],
  [/backdrop-filter/i, 'размытие фона'],
  [/requestAnimationFrame/, 'покадровая анимация в JS'],
  [/[\u{1F300}-\u{1FAFF}]/u, 'эмодзи'],
]

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : /\.(css|tsx?)$/.test(name) ? [p] : []
  })
}

let found = 0
for (const file of files(new URL('../src', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const [re, what] of BANNED) {
        if (re.test(line)) {
          console.log(`${file}:${i + 1}: ${what}: ${line.trim()}`)
          found++
        }
      }
    })
}
if (found) {
  console.log(`\nНарушений: ${found}`)
  process.exit(1)
}
console.log('check:style — ок')
