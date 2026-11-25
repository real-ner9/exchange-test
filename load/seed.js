// Подготовка данных: 5000 заданий через публичный API от 20 инициаторов (load01..load20),
// затем ожидание, пока весь обмен с эмулятором завершится. Так данные проходят реальный путь
// (outbox → отправщик → эмулятор → результат), а сверка видит согласованные системы.
import http from 'k6/http'
import exec from 'k6/execution'
import { check, sleep } from 'k6'
import { Trend } from 'k6/metrics'

const BASE = __ENV.BASE_URL || 'http://app-web'
const TOTAL = Number(__ENV.TOTAL || 5000)
const createTime = new Trend('create_task_ms', true)

export const options = {
  noCookiesReset: true, // сессия (cookie) живёт всю работу VU, как у пользователя в браузере
  teardownTimeout: '10m',
  scenarios: {
    seed: { executor: 'shared-iterations', vus: 20, iterations: TOTAL, maxDuration: '20m' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    create_task_ms: ['p(95)<500'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const json = { headers: { 'Content-Type': 'application/json' } }
const TITLES = ['Оплата поставщику', 'Возврат клиенту', 'Перевод между счетами', 'Выплата по договору', 'Компенсация расходов']

function login(name) {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ login: name, password: 'demo' }), json)
  check(res, { 'login 200': (r) => r.status === 200 })
}

export default function () {
  const vu = exec.vu.idInTest
  if (exec.vu.iterationInInstance === 0) {
    login('load' + String(((vu - 1) % 20) + 1).padStart(2, '0'))
  }
  const n = exec.scenario.iterationInTest
  const body = {
    clientRequestId: crypto.randomUUID(),
    title: `${TITLES[n % TITLES.length]} №${n + 1}`,
    amount: 100 + (n % 900),
    comment: n % 3 === 0 ? 'нагрузочные данные' : null,
  }
  const res = http.post(`${BASE}/api/tasks`, JSON.stringify(body), { ...json, tags: { name: 'create task' } })
  createTime.add(res.timings.duration)
  check(res, { 'created 201': (r) => r.status === 201 })
}

// Ожидание, пока все задания пройдут обмен: время «слива» очереди — пропускная способность отправщика.
export function teardown() {
  login('operator')
  const started = Date.now()
  let s = null
  for (let i = 0; i < 600; i++) {
    s = http.get(`${BASE}/api/operator/summary`).json()
    const b = s.byStatus
    const inFlight = b.QUEUED + b.SENDING + b.RETRY_WAIT + b.ACCEPTED
    if (inFlight === 0) break
    sleep(1)
  }
  const stats = http.get(`${BASE}/api/operator/demo/stats`).json()
  console.log(`exchange drained in ${Math.round((Date.now() - started) / 1000)} s after seeding; ` +
    `tasks by status: ${JSON.stringify(s.byStatus)}; emulator: ${JSON.stringify(stats)}`)
}

export function handleSummary(data) {
  return {
    '/scripts/results/seed-summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  }
}

function textSummary(data) {
  const m = data.metrics
  const t = (k) => (m[k] ? m[k].values : {})
  const fmt = (v) => (v === undefined ? '-' : v.toFixed(1))
  return [
    '',
    `requests: ${t('http_reqs').count}, failed: ${(t('http_req_failed').rate * 100).toFixed(2)}%`,
    `create task ms: avg ${fmt(t('create_task_ms').avg)} p95 ${fmt(t('create_task_ms')['p(95)'])} p99 ${fmt(t('create_task_ms')['p(99)'])} max ${fmt(t('create_task_ms').max)}`,
    `throughput: ${fmt(t('http_reqs').rate)} req/s over ${(data.state.testRunDurationMs / 1000).toFixed(1)} s`,
    '',
  ].join('\n')
}
