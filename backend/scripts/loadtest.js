// k6 load test: 50 virtual users browsing and updating for 5 minutes.
//
//   k6 run scripts/loadtest.js
//
// Needs a server with demo data (`cargo run --bin admin -- seed-demo`).
// Fails unless p95 latency < 200 ms and no request errors.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const ORIGIN = __ENV.ORIGIN || 'http://localhost:5173';
const VUS = Number(__ENV.VUS || 50);
const PASSWORD = 'demo-password';

export const options = {
  scenarios: {
    school_day: {
      executor: 'constant-vus',
      vus: VUS,
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: {
    'http_req_duration{phase:main}': ['p(95)<200'],
    'http_req_failed{phase:main}': ['rate==0'],
    checks: ['rate==1'],
  },
};

// Sign everyone in once: members 1-16 of each branch, plus the admins.
export function setup() {
  const emails = [];
  for (const branch of ['north', 'south', 'east']) {
    emails.push(`admin@${branch}.demo.school`);
    for (let n = 1; n <= 16; n++) emails.push(`member${n}@${branch}.demo.school`);
  }
  const cookies = [];
  for (const email of emails.slice(0, VUS)) {
    const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      tags: { phase: 'setup' },
    });
    if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${res.body}`);
    cookies.push(res.headers['Set-Cookie'].split(';')[0]);
  }
  return { cookies };
}

export default function (data) {
  const cookie = data.cookies[(__VU - 1) % data.cookies.length];
  const get = { headers: { Cookie: cookie }, tags: { phase: 'main' } };
  const post = { headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' }, tags: { phase: 'main' } };

  // Browse: the inbox badge, the dashboard, the issue list, one issue.
  const count = http.get(`${BASE}/api/notifications/unread-count`, { ...get, tags: { ...get.tags, name: 'unread-count' } });
  check(count, { 'unread count 200': (r) => r.status === 200 });

  if (__ITER % 3 === 0) {
    const dash = http.get(`${BASE}/api/dashboard`, { ...get, tags: { ...get.tags, name: 'dashboard' } });
    check(dash, { 'dashboard 200': (r) => r.status === 200 });
  }

  const list = http.get(`${BASE}/api/issues?limit=50`, { ...get, tags: { ...get.tags, name: 'issues' } });
  check(list, { 'issues 200': (r) => r.status === 200 });
  const items = list.status === 200 ? list.json('items') : [];
  sleep(0.5);
  if (!items || items.length === 0) return;

  const issue = items[Math.floor(Math.random() * items.length)];
  const detail = http.get(`${BASE}/api/issues/${issue.id}`, { ...get, tags: { ...get.tags, name: 'issue' } });
  check(detail, { 'issue 200': (r) => r.status === 200 });
  const comments = http.get(`${BASE}/api/issues/${issue.id}/comments`, { ...get, tags: { ...get.tags, name: 'comments' } });
  check(comments, { 'comments 200': (r) => r.status === 200 });

  // Update: mark it read; sometimes comment on it.
  const read = http.post(`${BASE}/api/issues/${issue.id}/read`, null, { ...post, tags: { ...post.tags, name: 'mark-read' } });
  check(read, { 'mark read 204': (r) => r.status === 204 });
  if (__ITER % 4 === 0) {
    const c = http.post(`${BASE}/api/issues/${issue.id}/comments`, JSON.stringify({ body: `Load test comment ${__VU}-${__ITER}` }), {
      ...post,
      tags: { ...post.tags, name: 'comment' },
    });
    check(c, { 'comment 201': (r) => r.status === 201 });
  }
  sleep(0.5);
}
