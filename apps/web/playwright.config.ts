import {defineConfig,devices} from '@playwright/test';
import {createServer} from 'node:net';

// Free ports chosen once by the runner process; workers inherit them through the environment.
const freePort=()=>new Promise<number>((resolve,reject)=>{
 const server=createServer();server.unref();server.on('error',reject);
 server.listen(0,'127.0.0.1',()=>{const {port}=server.address() as {port:number};server.close(()=>resolve(port));});
});
process.env.E2E_API_PORT??=String(await freePort());
process.env.E2E_WEB_PORT??=String(await freePort());
const api=`http://127.0.0.1:${process.env.E2E_API_PORT}`,web=`http://127.0.0.1:${process.env.E2E_WEB_PORT}`;

// Browser E2E: built Web (vite preview) -> real API + SQLite + Socket.IO -> Fake Game Client.
// No ROM, no BizHawk, no network outside 127.0.0.1. Requires `npm run build` beforehand.
export default defineConfig({
 testDir:'e2e',
 fullyParallel:false,workers:1,retries:0,
 timeout:60_000,expect:{timeout:10_000},
 forbidOnly:!!process.env.CI,
 reporter:process.env.CI?[['list'],['html',{open:'never',outputFolder:'e2e-report'}]]:'list',
 outputDir:'e2e-results',
 use:{baseURL:web,locale:'fr-FR',trace:'retain-on-failure',screenshot:'only-on-failure',video:'retain-on-failure'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
 webServer:[
  {command:'node --import tsx e2e/support/api-server.ts',url:`${api}/health`,env:{PORT:process.env.E2E_API_PORT!,CORS_ORIGIN:web},timeout:30_000,reuseExistingServer:false,stdout:'pipe'},
  {command:`npx vite preview --host 127.0.0.1 --port ${process.env.E2E_WEB_PORT} --strictPort`,url:web,env:{POKERACE_API_URL:api},timeout:30_000,reuseExistingServer:false}
 ]
});
