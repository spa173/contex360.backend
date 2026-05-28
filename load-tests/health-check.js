import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  stages: [
    { duration: '10s', target: 10 },
    { duration: '30s', target: 50 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001'

export default function () {
  const res = http.get(`${BASE_URL}/health`)

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 300ms': (r) => r.timings.duration < 300,
    'status is ok or degraded': (r) => {
      const body = JSON.parse(r.body)
      return body.status === 'ok' || body.status === 'degraded'
    },
    'database is up': (r) => {
      const body = JSON.parse(r.body)
      return body.database?.status === 'up'
    },
  })

  sleep(1)
}
