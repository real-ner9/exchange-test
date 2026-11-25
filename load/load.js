// Нагрузочный профиль: 20 одновременных пользователей поверх реестра из 5000+ заданий.
// 16 инициаторов: список своих заданий, карточка, создание, отчёт.
// 4 оператора: сводка, очередь, карточка с историей, журнал.
// Пауза 1 с между действиями — интерактивная работа людей, а не синтетический флуд.
import http from 'k6/http'
import exec from 'k6/execution'
import { check, sleep } from 'k6'

const BASE = __ENV.BASE_URL || 'http://app-web'
const DURATION = __ENV.DURATION || '3m'
// Пауза между действиями пользователя, с. THINK=0 — стресс: 20 VU без пауз, оценка запаса
const THINK = Number(__ENV.THINK ?? 1)
const json = { headers: { 'Content-Type': 'application/json' } }

export const options = {
  noCookiesReset: true, // сессия (cookie) живёт всю работу VU, как у пользователя в браузере
  scenarios: {
    initiators: { executor: 'constant-vus', vus: 16, duration: DURATION, exec: 'initiator' },
    operators: { executor: 'constant-vus', vus: 4, duration: DURATION, exec: 'operator' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    'http_req_duration{name:create task}': ['p(95)<300'],
    'http_req_duration{name:my tasks}': ['p(95)<300'],
    'http_req_duration{name:operator queue}': ['p(95)<500'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

function login(name) {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ login: name, password: 'demo' }), json)
  check(res, { 'login 200': (r) => r.status === 200 })
}

function get(path, name) {
  const res = http.get(`${BASE}${path}`, { tags: { name } })
  check(res, { [`${name} 200`]: (r) => r.status === 200 })
  return res
}

export function initiator() {
  if (exec.vu.iterationInInstance === 0) {
    login('load' + String(exec.vu.idInTest).padStart(2, '0'))
  }
  const i = exec.vu.iterationInInstance
  const list = get('/api/tasks?filter=all&page=0&size=20', 'my tasks')
  const items = list.json('items') || []
  if (items.length > 0) {
    get(`/api/tasks/${items[i % items.length].id}`, 'task card')
  }
  if (i % 5 === 0) {
    const res = http.post(
      `${BASE}/api/tasks`,
      JSON.stringify({ clientRequestId: crypto.randomUUID(), title: `Нагрузка ${exec.vu.idInTest}-${i}`, amount: 500 }),
      { ...json, tags: { name: 'create task' } },
    )
    check(res, { 'create task 201': (r) => r.status === 201 })
  }
  if (i % 10 === 0) {
    get('/api/tasks/report', 'report')
  }
  sleep(THINK)
}

export function operator() {
  if (exec.vu.iterationInInstance === 0) {
    login(exec.vu.idInTest % 2 === 0 ? 'operator' : 'operator2')
  }
  const i = exec.vu.iterationInInstance
  get('/api/operator/summary', 'operator summary')
  const views = ['attention', 'all', 'retrying', 'closed']
  const q = get(`/api/operator/tasks?view=${views[i % views.length]}&page=${i % 5}&size=50`, 'operator queue')
  const items = q.json('items') || []
  if (items.length > 0) {
    get(`/api/operator/tasks/${items[i % items.length].id}`, 'operator task card')
  }
  if (i % 3 === 0) {
    get('/api/operator/events?page=0&size=100', 'journal')
  }
  sleep(THINK)
}

export function handleSummary(data) {
  const m = data.metrics
  const lines = ['', `requests: ${m.http_reqs.values.count}, ${m.http_reqs.values.rate.toFixed(1)} req/s, failed ${(m.http_req_failed.values.rate * 100).toFixed(2)}%`]
  for (const [k, v] of Object.entries(m)) {
    if (k.startsWith('http_req_duration')) {
      const x = v.values
      lines.push(`${k}: avg ${x.avg.toFixed(1)} med ${x.med.toFixed(1)} p95 ${x['p(95)'].toFixed(1)} p99 ${x['p(99)'].toFixed(1)} max ${x.max.toFixed(1)} ms`)
    }
  }
  for (const [k, v] of Object.entries(data.metrics)) {
    if (v.thresholds) {
      for (const [t, r] of Object.entries(v.thresholds)) lines.push(`threshold ${k} ${t}: ${r.ok ? 'OK' : 'FAILED'}`)
    }
  }
  lines.push('')
  return { [`/scripts/results/load-summary${THINK === 0 ? '-stress' : ''}.json`]: JSON.stringify(data, null, 2), stdout: lines.join('\n') }
}
