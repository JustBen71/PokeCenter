import {defineConfig} from "vite";import react from "@vitejs/plugin-react";
// POKERACE_API_URL lets the browser E2E point the dev/preview proxy at its own API port.
const api=process.env.POKERACE_API_URL??"http://localhost:3000";
const proxy={"/rooms":{target:api,ws:true},"/api":api,"/socket.io":{target:api,ws:true}};
export default defineConfig({plugins:[react()],server:{proxy},preview:{proxy},build:{outDir:"dist"}});
