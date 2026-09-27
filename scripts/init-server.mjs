import {randomBytes} from "node:crypto";
import {writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
const roomCode=process.argv[2]??"123";
if(!roomCode.trim()||roomCode.length>128||/[\r\n]/.test(roomCode))throw Error("Code de salon invalide");
await mkdir(resolve("deploy/server"),{recursive:true});
try {
 await writeFile(resolve("deploy/server/.env"),`PUBLIC_DOMAIN=:80
HTTP_PORT=8080
HTTPS_PORT=443
DATABASE_PATH=/data/pokerace.sqlite
CORS_ORIGIN=http://localhost:8080
OFFLINE_AFTER_MS=15000
ROOM_CODE=${roomCode}
ADMIN_TOKEN=${randomBytes(32).toString("hex")}
`,{flag:"wx",mode:0o600});
 console.log("Serveur configuré. Partagez le code de salon choisi avec vos amis. Aucun jeton joueur à créer.");
} catch(error) {
 if(error.code==="EEXIST")throw Error("deploy/server/.env existe déjà. Modifiez ROOM_CODE dans ce fichier.");
 throw error;
}
