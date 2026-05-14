// pm2 ecosystem — dnfm-api
// 핵심: kill_timeout 180s — OCR multi-image (30-60s) in-flight 보호.
//   기본 1600ms → SIGINT 후 1.6초 만에 SIGKILL 강제 종료 → 사용자 OCR cut off.
//   180s 로 늘려 graceful drain 보장.
//
// 사용:
//   pm2 start ecosystem.config.cjs
//   또는 기존 process 가 cli 로 시작됐으면:
//   pm2 delete dnfm-api && pm2 start ecosystem.config.cjs

module.exports = {
  apps: [
    {
      name: "dnfm-api",
      script: "./dist/index.js",
      cwd: "/var/www/dnfm-api",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
      // graceful shutdown: SIGINT 후 in-flight 끝나길 180s 까지 기다림.
      // src/index.ts 의 setTimeout(180_000) 와 sync.
      kill_timeout: 180_000,
      // pm2 가 SIGINT 보낸 후 SIGKILL 까지 wait.
      // listen_timeout: 새 process 가 listening 시작 못 하면 fail. 60s 마진.
      listen_timeout: 60_000,
      // 자동 재시작 정책
      max_memory_restart: "512M",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      // 로그 위치 (기본값 사용)
    },
  ],
};
