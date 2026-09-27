import hashlib,json,os,socket,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
ROM=Path(os.environ["ROM_PATH"]).expanduser().resolve()
MANIFEST=Path(os.getenv("ROM_MANIFEST_PATH",ROOT/"profiles"/"rom-manifest.json"))
HOST=os.getenv("EXTRACTOR_HOST","127.0.0.1")
PORT=int(os.getenv("EXTRACTOR_PORT","8765"))
def header(data):
 return {"title":data[0xA0:0xAC].decode("ascii","replace").rstrip("\0 "),"gameCode":data[0xAC:0xB0].decode("ascii","replace"),"version":data[0xBC]}
from roms import identify as identify_rom
def identify():
 return identify_rom(ROM, MANIFEST)

def payload(info):
 p=info["profile"]
 return {"protocolVersion":1,"playerId":"placeholder","game":{"name":"pokemon-emerald","language":p["language"] if p else None,"profileId":p["profileId"] if p else None,"romStatus":info["status"],"revision":p["revision"] if p else None,"header":info["header"],"romSha256":info["sha"]},"trainer":None,"location":None,"party":[],"observedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"diagnostic":info["diagnostic"] or "Profil reconnu, extracteur mémoire en attente de validation d’exécution."}
def serve(info):
 s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind((HOST,PORT));s.listen(5)
 while True:
  c,_=s.accept()
  try:
   while True:c.sendall((json.dumps(payload(info),ensure_ascii=False)+"\n").encode());time.sleep(5)
  except OSError:pass
  finally:c.close()
if __name__=="__main__":
 info=identify();print(json.dumps({"romStatus":info["status"],"header":info["header"],"sha256":info["sha"],"profile":info["profile"]},ensure_ascii=False),flush=True);serve(info)
