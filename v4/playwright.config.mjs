import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
  testDir:'./tests/e2e',
  fullyParallel:true,
  forbidOnly:true,
  retries:0,
  workers:process.env.CI?2:undefined,
  timeout:30_000,
  expect:{timeout:7_500},
  reporter:process.env.CI?[['line'],['html',{open:'never',outputFolder:'test-results/report'}]]:'line',
  outputDir:'test-results/artifacts',
  use:{
    baseURL:'http://127.0.0.1:4173',
    locale:'ko-KR',
    timezoneId:'Asia/Seoul',
    trace:'retain-on-failure',
    screenshot:'only-on-failure',
    video:'retain-on-failure'
  },
  projects:[
    {
      name:'mobile-chromium',
      use:{...devices['Galaxy S9+'],viewport:{width:412,height:915}}
    },
    {
      name:'desktop-chromium',
      use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}
    }
  ],
  webServer:{
    command:'node scripts/serve-static.mjs',
    url:'http://127.0.0.1:4173',
    reuseExistingServer:!process.env.CI,
    timeout:15_000
  }
});
