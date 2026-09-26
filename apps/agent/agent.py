import json, logging, os, socket, time, threading
from datetime import datetime, timezone
import socketio
from pydantic import BaseModel, Field, ValidationError, model_validator

logging.basicConfig(level=os.getenv("LOG_LEVEL","INFO"),format="%(asctime)s %(levelname)s %(message)s")
PLAYER_ID=os.environ["PLAYER_ID"]; PLAYER_TOKEN=os.environ["PLAYER_TOKEN"]; SERVER_URL=os.environ["SERVER_URL"].rstrip("/")
LUA_HOST=os.getenv("LUA_HOST","127.0.0.1"); LUA_PORT=int(os.getenv("LUA_PORT","8765")); MAX_BYTES=32768
class Header(BaseModel): title:str=Field(max_length=32); gameCode:str=Field(max_length=8); version:int=Field(ge=0,le=255)
class Game(BaseModel): name:str; language:str|None=None; profileId:str|None=None; romStatus:str; revision:str|None=None; header:Header|None=None; romSha256:str|None=None
class Pokemon(BaseModel):
 slot:int=Field(ge=1,le=6); speciesId:int=Field(ge=1,le=386); speciesName:str=Field(min_length=1,max_length=32); nickname:str|None=None; level:int=Field(ge=1,le=100); currentHp:int=Field(ge=0,le=999); maxHp:int=Field(ge=1,le=999); shiny:bool
 @model_validator(mode="after")
 def hp(self):
  if self.currentHp>self.maxHp: raise ValueError("currentHp exceeds maxHp")
  return self
class State(BaseModel):
 protocolVersion:int=Field(ge=1,le=1); playerId:str; game:Game; trainer:dict|None; location:dict|None; party:list[Pokemon]=Field(max_length=6); observedAt:str; diagnostic:str|None=None
sio=socketio.Client(reconnection=True,reconnection_attempts=0,logger=False)
lua_socket=None;lua_lock=threading.Lock()
@sio.event(namespace="/agent")
def connect(): logging.info("Connected to server as %s",PLAYER_ID)
@sio.event(namespace="/agent")
def connect_error(data): logging.warning("Server connection failed: %s",data)
@sio.on("command",namespace="/agent")
def command(message):
 global lua_socket
 if message.get("type")!="injectPokemon": return
 d=message["data"];s=d["stats"];iv=d["ivs"];ev=d["evs"]
 clean=lambda value:"".join(c for c in str(value).upper() if c.isascii() and (c.isalnum() or c in " -"))[:10]
 values=["INJECT",d["slot"],d["speciesId"],clean(d["nickname"]),d["level"],d["experience"],d["currentHp"],s["maxHp"],s["attack"],s["defense"],s["speed"],s["spAttack"],s["spDefense"]]
 for move in d["moves"]: values.extend([move["id"],move["pp"]])
 values.extend([d["heldItem"],d["abilitySlot"],d["nature"],d["friendship"],clean(d["otName"]),d["trainerId"],d["secretId"],iv["hp"],iv["attack"],iv["defense"],iv["speed"],iv["spAttack"],iv["spDefense"],ev["hp"],ev["attack"],ev["defense"],ev["speed"],ev["spAttack"],ev["spDefense"],1 if d["shiny"] else 0])
 try:
  with lua_lock:
   if not lua_socket: raise OSError("Lua extractor is not connected")
   lua_socket.sendall(("\t".join(map(str,values))+"\n").encode("utf-8"))
  logging.info("Pokemon injection sent to Lua for slot %s",d["slot"])
 except OSError as exc: logging.warning("Pokemon injection failed: %s",exc)
def send(kind,data):
 try:
  ack=sio.call("telemetry",data,namespace="/agent",timeout=10)
  if not ack.get("ok"): logging.warning("Telemetry rejected: %s",ack.get("error"))
 except Exception as exc: logging.warning("Telemetry delivery failed: %s",exc)
def connect_server():
 while not sio.connected:
  try:sio.connect(SERVER_URL,auth={"playerId":PLAYER_ID,"token":PLAYER_TOKEN},namespaces=["/agent"],transports=["websocket"])
  except Exception as exc: logging.warning("Retrying server in 5s: %s",exc);time.sleep(5)
def lua_stream():
 global lua_socket
 while True:
  try:
   with socket.create_connection((LUA_HOST,LUA_PORT),timeout=10) as stream:
    stream.settimeout(None)
    with lua_lock: lua_socket=stream
    logging.info("Connected to Lua extractor")
    file=stream.makefile("rb")
    for raw in file:
     if len(raw)>MAX_BYTES: logging.warning("Discarded oversized Lua message");continue
     try:
      payload=json.loads(raw);payload["playerId"]=PLAYER_ID;payload["observedAt"]=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
      state=State.model_validate(payload)
      send("state",{"type":"state","data":state.model_dump()})
     except (json.JSONDecodeError,ValidationError) as exc: logging.warning("Discarded invalid Lua state: %s",exc)
  except OSError as exc: logging.warning("Lua unavailable, retrying in 3s: %s",exc);time.sleep(3)
  finally:
   with lua_lock: lua_socket=None
if __name__=="__main__": connect_server();lua_stream()
