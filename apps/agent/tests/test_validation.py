import unittest
from unittest.mock import patch
from apps.agent import agent
from apps.agent.agent import State
class ValidationTest(unittest.TestCase):
 def test_room_transport_resolution(self):
  from io import BytesIO
  with patch.object(agent,'urlopen',return_value=BytesIO(b'{"socketPath":"/rooms/course-a/socket.io"}')):
   self.assertEqual(agent.room_socket_path(),'rooms/course-a/socket.io')
  with patch.object(agent,'urlopen',return_value=BytesIO(b'{"socketPath":"https://other.example/socket.io"}')):
   with self.assertRaises(ValueError):agent.room_socket_path()
 def test_room_rejection_does_not_fall_back_to_global_transport(self):
  from urllib.error import HTTPError
  with patch.object(agent,'urlopen',side_effect=HTTPError('http://localhost',403,'Forbidden',{},None)):
   with self.assertRaises(RuntimeError):agent.room_socket_path()
  with patch.object(agent,'urlopen',side_effect=HTTPError('http://localhost',404,'Not Found',{},None)):
   self.assertEqual(agent.room_socket_path(),'socket.io')
 def test_autosave_schedule_commits_only_after_ack(self):
  clock=[0];delays=[]
  def sleep(seconds):
   delays.append(seconds)
   if len(delays)>2: raise KeyboardInterrupt()
   clock[0]+=seconds
  with patch.dict(agent.os.environ,{'AUTOSAVE_DIR':'folder','AUTOSAVE_STAGING':'pending','ROM_CRC32':'123'}), patch.object(agent,'lua_socket',object()), patch.object(agent.time,'sleep',sleep), patch.object(agent.time,'monotonic',lambda:clock[0]), patch.object(agent,'send_lua_command',side_effect=[{'ok':False,'error':'test failure'},{'ok':True}]) as send, patch('apps.agent.autosave.commit_backup',return_value='saved') as commit:
   with self.assertRaises(KeyboardInterrupt):agent.autosave_loop()
   self.assertEqual(delays[:2],[300,300])
   self.assertEqual(send.call_count,2)
   commit.assert_called_once_with('pending','folder',123)
 def test_copy_command_preserves_bytes_and_waits_for_lua_ack(self):
  command_id='00000000-0000-4000-8000-000000000000'
  raw='ab'*100
  sent=[]
  class Socket:
   def sendall(self,payload):
    sent.append(payload)
    event,result=agent.pending[command_id]
    result.update(ok=True);event.set()
  with patch.object(agent,'lua_socket',Socket()):
   result=agent.command({'type':'injectPokemon','commandId':command_id,'data':{'slot':2,'raw':raw}})
  self.assertTrue(result['ok'])
  self.assertEqual(sent,[f'RESTORE\t2\t{raw}\t{command_id}\n'.encode()])
  self.assertNotIn(command_id,agent.pending)
 def test_conditional_replace_transmits_expected_bytes(self):
  raw='ab'*100
  with patch.object(agent,'send_lua_command',return_value={'ok':True}) as send:
   result=agent.command({'type':'injectPokemon','commandId':'00000000-0000-4000-8000-000000000000','data':{'action':'compareReplace','slot':1,'raw':raw,'expectedRaw':'cd'*100}})
   self.assertTrue(result['ok'])
   self.assertEqual(send.call_args.args[0],['PATCH',1,'cd'*100,raw])
   result=agent.command({'type':'injectPokemon','commandId':'00000000-0000-4000-8000-000000000000','data':{'action':'compareReplace','slot':1,'raw':raw,'expectedRaw':'invalid'}})
   self.assertFalse(result['ok'])
   self.assertEqual(send.call_count,1)
 def test_purchase_is_one_conditional_lua_command(self):
  stats={key:10 for key in ('maxHp','attack','defense','speed','spAttack','spDefense')}
  ivs={key:0 for key in ('hp','attack','defense','speed','spAttack','spDefense')}
  data=dict(action='purchase',price=100,expectedMoney=3000,expectedCount=1,slot=2,speciesId=255,nickname='TEST',level=5,experience=135,currentHp=10,stats=stats,moves=[dict(id=0,pp=0)]*4,heldItem=0,abilitySlot=0,nature=0,friendship=70,otName='TEST',trainerId=1,secretId=2,ivs=ivs,evs=ivs,shiny=False)
  message=dict(type='injectPokemon',commandId='00000000-0000-4000-8000-000000000000',data=data)
  with patch.object(agent,'send_lua_command',return_value={'ok':True}) as send:
   self.assertTrue(agent.command(message)['ok'])
   self.assertEqual(send.call_args.args[0][:7],['BUY',100,3000,1,'INJECT',2,255])
   self.assertEqual(len(send.call_args.args[0]),45)
   data['price']=4000;self.assertFalse(agent.command(message)['ok']);self.assertEqual(send.call_count,1)
 def test_rejects_impossible_hp(self):
  with self.assertRaises(Exception): State.model_validate({"protocolVersion":1,"playerId":"p1","game":{"name":"pokemon-emerald","romStatus":"recognized"},"trainer":None,"location":None,"party":[{"slot":1,"speciesId":1,"speciesName":"Bulbizarre","level":5,"currentHp":21,"maxHp":20,"shiny":False}],"observedAt":"2026-01-01T00:00:00Z"})
