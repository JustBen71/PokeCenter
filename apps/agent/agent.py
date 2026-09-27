import json, logging, os, socket, time, threading, uuid
from pathlib import Path
from datetime import datetime, timezone
import socketio
from pydantic import BaseModel, Field, ValidationError, model_validator

logging.basicConfig(level=os.getenv("LOG_LEVEL","INFO"),format="%(asctime)s %(levelname)s %(message)s")
PLAYER_ID=os.environ["PLAYER_ID"]; PLAYER_TOKEN=os.getenv("PLAYER_TOKEN",""); SERVER_URL=os.environ["SERVER_URL"].rstrip("/")
PLAYER_NAME=os.getenv("ACCOUNT_NAME") or os.getenv("PLAYER_NAME",PLAYER_ID); ROOM_CODE=os.getenv("ROOM_CODE","")
LUA_HOST=os.getenv("LUA_HOST","127.0.0.1"); LUA_PORT=int(os.getenv("LUA_PORT","8765")); MAX_BYTES=32768
class Header(BaseModel): title:str=Field(max_length=32); gameCode:str=Field(max_length=8); version:int=Field(ge=0,le=255)
class Game(BaseModel): name:str; language:str|None=None; profileId:str|None=None; romStatus:str; revision:str|None=None; header:Header|None=None; romSha256:str|None=None
class Pokemon(BaseModel):
 raw:str|None=Field(default=None,pattern=r"^[a-f0-9]{200}$")
 slot:int=Field(ge=1,le=6); speciesId:int=Field(ge=1,le=386); speciesName:str=Field(min_length=1,max_length=32); nickname:str|None=None; level:int=Field(ge=1,le=100); currentHp:int=Field(ge=0,le=999); maxHp:int=Field(ge=1,le=999); shiny:bool
 @model_validator(mode="after")
 def hp(self):
  if self.currentHp>self.maxHp: raise ValueError("currentHp exceeds maxHp")
  return self
class Progression(BaseModel):
 version:int=Field(ge=1,le=1); completed:list[str]=Field(max_length=64)
class State(BaseModel):
 events:dict|None=None
 capabilities:list[str]=Field(default_factory=list,max_length=10)
 progression:Progression|None=None
 protocolVersion:int=Field(ge=1,le=1); playerId:str; playerName:str|None=None; game:Game; trainer:dict|None; location:dict|None; party:list[Pokemon]=Field(max_length=6); observedAt:str; diagnostic:str|None=None
sio=socketio.Client(reconnection=True,reconnection_attempts=0,logger=False)
lua_socket=None;lua_lock=threading.Lock()
pending={};pending_lock=threading.Lock()
@sio.event(namespace="/agent")
def connect(): logging.info("Connected to server as %s",PLAYER_ID)
@sio.event(namespace="/agent")
def connect_error(data): logging.warning("Server connection failed: %s",data)
@sio.on("command",namespace="/agent")
def command(message):
 global lua_socket
 if message.get("type")!="injectPokemon": return {"ok":False,"error":"Unknown command"}
 command_id=message.get("commandId","")
 try: uuid.UUID(command_id)
 except ValueError: return {"ok":False,"error":"Invalid command id"}
 d=message["data"]
 if d.get("action")=="bundle":
  import re
  before,after=d.get('before'),d.get('after')
  def valid(b):
   return isinstance(b,dict) and type(b.get('money')) is int and 0<=b['money']<=999999 and isinstance(b.get('party'),list) and len(b['party'])<=6 and all(isinstance(raw,str) and re.fullmatch('[a-f0-9]{200}',raw) for raw in b['party'])
  if not valid(before) or not valid(after) or not after['party']:return {'ok':False,'error':'Invalid bundle'}
  return send_lua_command(['BUNDLE',before['money'],''.join(before['party']),after['money'],''.join(after['party'])],command_id)
 if "raw" in d:
  import re
  if not isinstance(d["raw"],str) or not re.fullmatch(r"[a-f0-9]{200}",d["raw"]): return {"ok":False,"error":"Invalid Pokemon copy"}
  values=["REMOVE" if d.get("action")=="remove" else "RESTORE",d["slot"],d["raw"]]
  if d.get("action")=="compareReplace":
   if not isinstance(d.get("expectedRaw"),str) or not re.fullmatch(r"[a-f0-9]{200}",d["expectedRaw"]): return {"ok":False,"error":"Invalid comparison"}
   values=["PATCH",d["slot"],d["expectedRaw"],d["raw"]]
 else:
  s=d["stats"];iv=d["ivs"];ev=d["evs"]
  clean=lambda value:"".join(c for c in str(value).upper() if c.isascii() and (c.isalnum() or c in " -"))[:10]
  values=["INJECT",d["slot"],d["speciesId"],clean(d["nickname"]),d["level"],d["experience"],d["currentHp"],s["maxHp"],s["attack"],s["defense"],s["speed"],s["spAttack"],s["spDefense"]]
  for move in d["moves"]: values.extend([move["id"],move["pp"]])
  values.extend([d["heldItem"],d["abilitySlot"],d["nature"],d["friendship"],clean(d["otName"]),d["trainerId"],d["secretId"],iv["hp"],iv["attack"],iv["defense"],iv["speed"],iv["spAttack"],iv["spDefense"],ev["hp"],ev["attack"],ev["defense"],ev["speed"],ev["spAttack"],ev["spDefense"],1 if d["shiny"] else 0])
 if d.get("action")=="purchase":
  if "raw" in d or any(type(d.get(k)) is not int for k in ("price","expectedMoney","expectedCount")) or not 1<=d["price"]<=d["expectedMoney"]<=999999 or not 0<=d["expectedCount"]<6 or d["slot"]!=d["expectedCount"]+1:
   return {"ok":False,"error":"Invalid purchase"}
  values=["BUY",d["price"],d["expectedMoney"],d["expectedCount"]]+values
 return send_lua_command(values,command_id)

def send_lua_command(values,command_id,timeout=8):
 event=threading.Event();result={}
 with pending_lock: pending[command_id]=(event,result)
 try:
  with lua_lock:
   if not lua_socket: raise OSError("Lua extractor is not connected")
   lua_socket.sendall(("\t".join(map(str,values+[command_id]))+"\n").encode("utf-8"))
  if not event.wait(timeout): return {"ok":False,"error":"Lua confirmation timeout; do not retry blindly"}
  return result
 except OSError as exc: return {"ok":False,"error":str(exc)}
 finally:
  with pending_lock: pending.pop(command_id,None)
def send(kind,data):
 try:
  if not sio.connected: return False
  ack=sio.call("telemetry",data,namespace="/agent",timeout=10)
  if not ack.get("ok"): logging.warning("Telemetry rejected: %s",ack.get("error"))
  return ack.get("ok") is True
 except Exception as exc: logging.warning("Telemetry delivery failed: %s",exc)
def connect_server():
 while True:
  if not sio.connected:
   try:sio.connect(SERVER_URL,auth={"playerId":PLAYER_ID,"playerName":PLAYER_NAME,"accountName":PLAYER_NAME,"roomCode":ROOM_CODE,"token":PLAYER_TOKEN},namespaces=["/agent"],transports=["websocket"])
   except Exception as exc: logging.warning("Retrying server in 5s: %s",exc)
  time.sleep(5)
def lua_stream():
 global lua_socket
 while True:
  try:
   with socket.create_connection((LUA_HOST,LUA_PORT),timeout=10) as stream:
    stream.settimeout(None)
    file=stream.makefile("rb")
    stream.settimeout(15)
    greeting=json.loads(file.readline(MAX_BYTES+1))
    if greeting.get("type")!="hello" or greeting.get("session")!=os.environ.get("LUA_SESSION"):
     raise OSError("Wrong Lua session")
    stream.settimeout(15)
    with lua_lock: lua_socket=stream
    logging.info("Lua session verified")
    if os.environ.get("LUA_READY_FILE"): Path(os.environ["LUA_READY_FILE"]).write_text(greeting["session"])
    last_raw=None
    while True:
     raw=file.readline(MAX_BYTES+1)
     if not raw: break
     if len(raw)>MAX_BYTES: raise OSError("Oversized Lua message")
     try:
      payload=json.loads(raw)
      if payload.get("type")=="commandResult":
       with pending_lock:
        item=pending.get(payload.get("commandId"))
        if item:
         event,result=item;result.update(ok=payload.get("ok") is True,error=str(payload.get("error",""))[:500]);event.set()
       continue
      payload["playerId"]=PLAYER_ID;payload["playerName"]=PLAYER_NAME;payload["observedAt"]=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
      state=State.model_validate(payload)
      if raw==last_raw:
       delivered=send("heartbeat",{"type":"heartbeat","protocolVersion":1,"playerId":PLAYER_ID,"observedAt":payload["observedAt"]})
      else:
       delivered=send("state",{"type":"state","data":state.model_dump()})
      last_raw=raw if delivered else None
     except (json.JSONDecodeError,ValidationError) as exc: logging.warning("Discarded invalid Lua state: %s",exc)
  except (OSError, ValueError) as exc: logging.warning("Lua unavailable, retrying in 3s: %s",exc);time.sleep(3)
  finally:
   with lua_lock: lua_socket=None
def autosave_loop():
 try:
  from .autosave import INTERVAL_SECONDS, commit_backup
 except ImportError:
  from autosave import INTERVAL_SECONDS, commit_backup
 folder=os.getenv("AUTOSAVE_DIR");staging=os.getenv("AUTOSAVE_STAGING")
 if not folder or not staging: return
 next_save=time.monotonic()+INTERVAL_SECONDS
 while True:
  time.sleep(max(0,next_save-time.monotonic()))
  next_save=time.monotonic()+INTERVAL_SECONDS
  if lua_socket is None: continue
  try:
   result=send_lua_command(["SAVE"],str(uuid.uuid4()),timeout=30)
   if not result.get("ok"): raise ValueError(result.get("error","Sauvegarde non confirmÃ©e"))
   saved=commit_backup(staging,folder,int(os.environ["ROM_CRC32"]))
   logging.info("Sauvegarde automatique crÃ©Ã©e : %s (3 maximum)",saved)
  except Exception as exc: logging.warning("Sauvegarde automatique Ã©chouÃ©e, anciennes sauvegardes conservÃ©es : %s",exc)

if __name__=="__main__":
 threading.Thread(target=connect_server,daemon=True).start()
 threading.Thread(target=autosave_loop,daemon=True).start()
 lua_stream()
