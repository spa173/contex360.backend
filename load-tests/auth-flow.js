import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { SharedArray } from 'k6/data'

export const options = {
  stages: [
    { duration: '10s', target: 5 },
    { duration: '20s', target: 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001'

const credentials = {
  email: __ENV.TEST_EMAIL || 'test@contex360.com',
  password: __ENV.TEST_PASSWORD || '',
}

export default function () {
  group('Auth Flow', () => {
    // Login
    const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify(credentials), {
      headers: { 'Content-Type': 'application/json' },
    })

    check(loginRes, {
      'login successful': (r) => r.status === 200 || r.status === 201,
      'login response time < 2s': (r) => r.timings.duration < 2000,
    })

    if (loginRes.status !== 200 && loginRes.status !== 201) {
      console.log(`Login failed: ${loginRes.status} ${loginRes.body}`)
      sleep(1)
      return
    }

    const cookies = loginRes.headers['Set-Cookie'] || ''
    const authCookie = extractCookie(cookies, 'auth_token')

    const params = {
      headers: {
        Cookie: `auth_token=${authCookie}`,
        'Content-Type': 'application/json',
      },
    }

    sleep(1)

    // Get current user
    const meRes = http.get(`${BASE_URL}/auth/me`, params)

    check(meRes, {
      'me endpoint works': (r) => r.status === 200,
      'me response time < 1s': (r) => r.timings.duration < 1000,
    })
  })

  sleep(2)
}

function extractCookie(cookies, name) {
  const match = cookies.match(new RegExp(`${name}=([^;]+)`))
  return match ? match[1] : ''
}
