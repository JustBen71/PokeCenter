import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from apps.agent.player_client import discover, make_script, ROOT
from emulator.roms import identify
from lupa.lua54 import LuaRuntime


class PlayerTests(unittest.TestCase):
    def test_scan_paths_duplicates_and_extensions(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'Émeraude.gba').touch()
            (root / 'Emerald.GBA').touch()
            (root / 'save.sav').touch()
            self.assertEqual(len(discover([root, root])), 2)

    def test_unknown_header_never_selects_profile(self):
        with tempfile.TemporaryDirectory() as folder:
            rom = Path(folder) / 'test.gba'
            content = bytearray(192); content[172:176] = b'BPEF'
            rom.write_bytes(content)
            info = identify(rom)
            self.assertEqual(info['status'], 'unknown')
            self.assertIsNone(info['profile'])
            self.assertEqual(info['sha'], hashlib.sha256(content).hexdigest())
            manifest=Path(folder)/'manifest.json'
            entry={'sha256':info['sha'],'profileId':'emerald-fr-bpef-v0','language':'fr','revision':'BPEF v0','validated':True}
            manifest.write_text(json.dumps({'version':1,'roms':[entry]}))
            self.assertEqual(identify(rom,manifest)['status'],'recognized')
            content[172:176]=b'BPEE';rom.write_bytes(content)
            self.assertEqual(identify(rom,manifest)['status'],'unknown')
            entry['sha256']=hashlib.sha256(content).hexdigest()
            manifest.write_text(json.dumps({'version':1,'roms':[entry]}))
            with self.assertRaises(ValueError): identify(rom,manifest)
            rom.write_bytes(b'broken')
            self.assertIsNone(identify(rom)['header'])

    def run_lua(self, language=None):
        profile = json.loads((ROOT / f'emulator/profiles/emerald-{language}-bp{"ef" if language == "fr" else "ee"}-v0.json').read_text()) if language else None
        info = {'status': 'recognized' if profile else 'unknown', 'sha': 'a'*64,
                'profile': profile, 'header': None, 'diagnostic': None}
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / 'launch.lua'
            make_script(info, 8765, 'test', script)
            lua = LuaRuntime()
            lua.execute('''
                mem={}; writes=0; reads=0; output={}; commands={}
                emu={}
                function emu:read8(a) reads=reads+1; return mem[a] or 0 end
                function emu:read16(a) return self:read8(a) | (self:read8(a+1)<<8) end
                function emu:read32(a) return self:read16(a) | (self:read16(a+2)<<16) end
                function emu:write8(a,v) writes=writes+1; mem[a]=v & 255 end
                function emu:write16(a,v) self:write8(a,v);self:write8(a+1,v>>8) end
                function emu:write32(a,v) self:write16(a,v);self:write16(a+2,v>>16) end
                console={log=function() end,error=function() end}
                callbacks={add=function(self,name,f) tick=f end}
                peer={send=function(self,s) table.insert(output,s);return #s end,
                      hasdata=function() return #commands>0 end,
                      receive=function() return table.remove(commands,1) end,close=function() end}
                socket={bind=function() return {listen=function() end,accept=function() return peer end} end}
            ''')
            lua.execute(script.read_text('utf-8'))
            return lua

    def test_unknown_lua_reads_and_writes_nothing(self):
        lua = self.run_lua()
        lua.execute('for i=1,60 do tick() end')
        self.assertEqual(lua.globals().reads, 0)
        self.assertEqual(lua.globals().writes, 0)
        payload = json.loads(lua.globals().output[2])
        self.assertEqual(payload['game']['romStatus'], 'unknown')
        lua.globals().commands[1]='INJECT\t00000000-0000-4000-8000-000000000000\n'
        lua.execute('tick()')
        self.assertFalse(json.loads(lua.globals().output[3])['ok'])
        self.assertEqual(lua.globals().reads,0)
        self.assertEqual(lua.globals().writes,0)

    def test_autosave_native_call_and_failure_confirmation(self):
        lua=self.run_lua()
        lua.execute('POKERACE_CONFIG.autosavePath="backup.ss1"; function emu:saveStateFile(path, flags) savedPath=path; savedFlags=flags; return true end')
        command_id='00000000-0000-4000-8000-000000000000'
        lua.globals().commands[1]=f'SAVE\t{command_id}\n'
        lua.execute('tick()')
        self.assertTrue(json.loads(lua.globals().output[2])['ok'])
        self.assertEqual(lua.globals().savedPath,'backup.ss1')
        self.assertEqual(lua.globals().savedFlags,31)
        lua.execute('function emu:saveStateFile() return false end')
        lua.globals().commands[1]=f'SAVE\t{command_id}\n'
        lua.execute('tick()')
        self.assertFalse(json.loads(lua.globals().output[3])['ok'])

    def test_progression_flags_and_league_completion(self):
        lua=self.run_lua('fr')
        lua.execute('emu:write32(0x03005D8C,0x02001000);emu:write32(0x03005D90,0x02002000);emu:write16(0x02002000,0xFFBB)')
        def flag(value):
            address=0x02001000+0x1270+value//8
            mem=lua.globals().mem
            mem[address]=(mem[address] or 0)|(1<<(value%8))
        flag(0x860);flag(0x867);flag(0x500+530)
        lua.execute('for i=1,60 do tick() end')
        completed=json.loads(lua.globals().output[2])['progression']['completed']
        self.assertEqual(set(completed),{'starter','badge1','rival110'})
        flag(0x864)
        lua.execute('for i=1,60 do tick() end')
        completed=json.loads(lua.globals().output[3])['progression']['completed']
        self.assertTrue({'champion','sidney','phoebe','glacia','drake'}<=set(completed))

    def test_all_permutations_and_both_languages(self):
        # Independent fixture generation: known permutation order from Gen III structures.
        orders = ['GAEM','GAME','GEAM','GEMA','GMAE','GMEA','AGEM','AGME','AEGM','AEMG','AMGE','AMEG','EGAM','EGMA','EAGM','EAMG','EMGA','EMAG','MGAE','MGEA','MAGE','MAEG','MEGA','MEAG']
        for lang in ('fr','en'):
            for pid, order in enumerate(orders):
                with self.subTest(lang=lang, permutation=pid):
                    lua = self.run_lua(lang)
                    mem = lua.globals().mem
                    def write(address, value, size):
                        for i in range(size): mem[address+i]=(value>>(i*8))&255
                    write(0x03005D8C, 0x02001000, 4); write(0x03005D90, 0x02002000, 4)
                    write(0x02002000, 0xFF06, 2)  # É
                    write(0x020244E9, 1, 1)
                    base=0x020244EC
                    write(base,pid,4);write(base+4,12345,4);write(base+8,0xFFBB,2)
                    # Internal 411 is Chimecho / Éoko, national 358, NOT 386.
                    blocks={'G':[411,0,0], 'A':[0,0,0], 'E':[0,0,0], 'M':[0,0,0]}
                    write(base+28,411,2)
                    for physical, block in enumerate(order):
                        for word,value in enumerate(blocks[block]): write(base+32+physical*12+word*4,value^pid^12345,4)
                    write(base+84,5,1);write(base+86,12,2);write(base+88,20,2)
                    lua.execute('for i=1,60 do tick() end')
                    payload=json.loads(lua.globals().output[2])
                    self.assertEqual(payload['trainer']['name'],'É')
                    self.assertEqual(payload['party'][0]['speciesId'],358)
                    self.assertEqual(payload['party'][0]['speciesName'],'Éoko' if lang=='fr' else 'Chimecho')
                    write(base+28,0,2)
                    lua.execute('for i=1,60 do tick() end')
                    self.assertEqual(json.loads(lua.globals().output[3])['party'],[])

    def test_insertion_roundtrip_every_species_and_confirmation(self):
        lua=self.run_lua('fr')
        lua.execute('emu:write32(0x03005D8C,0x02001000);emu:write32(0x03005D90,0x02002000);emu:write16(0x02002000,0xFFBB)')
        for species in range(1,387):
            values=['INJECT',1,species,'TEST',5,0,12,20,5,5,5,5,5]
            values += [150,40,0,0,0,0,0,0]
            values += [0,0,species%25,70,'POKER',12345,54321] + [0]*12 + [species%2]
            values += ['00000000-0000-4000-8000-000000000000']
            lua.globals().commands[1]='\t'.join(map(str,values))+'\n'
            lua.execute('for i=1,60 do tick() end')
            output=lua.globals().output
            ack=json.loads(output[len(output)-1]);state=json.loads(output[len(output)])
            self.assertTrue(ack['ok'],ack)
            self.assertEqual(state['party'][0]['speciesId'],species)
            self.assertEqual(state['party'][0]['shiny'],bool(species%2))
            self.assertEqual(lua.eval('emu:read32(0x020244EC) % 25'),species%25)

    def test_read_only_profile_rejects_insertion_without_memory_access(self):
        lua = self.run_lua('fr')
        lua.execute('POKERACE_CONFIG.identity.profile.allowWrites = false')
        lua.globals().commands[1] = 'INJECT\t00000000-0000-4000-8000-000000000000\n'
        lua.execute('tick()')
        result = json.loads(lua.globals().output[2])
        self.assertFalse(result['ok'])
        self.assertIn('lecture uniquement', result['error'])
        self.assertEqual(lua.globals().reads, 0)
        self.assertEqual(lua.globals().writes, 0)

    def test_exact_copy_restore_and_corruption_rejected(self):
        lua=self.run_lua('fr')
        lua.execute('emu:write32(0x03005D8C,0x02001000);emu:write32(0x03005D90,0x02002000);emu:write16(0x02002000,0xFFBB)')
        values=['INJECT',1,255,'TEST',5,135,12,20,11,9,9,12,10]+[10,17,45,32,0,0,0,0]+[0,0,3,70,'TEST',12345,54321]+[31,4,7,9,10,11]+[1,2,3,4,5,6]+[1]
        command_id='00000000-0000-4000-8000-000000000000'
        lua.globals().commands[1]='\t'.join(map(str,values+[command_id]))+'\n'
        lua.execute('for i=1,60 do tick() end')
        state=json.loads(lua.globals().output[len(lua.globals().output)])
        raw=state['party'][0]['raw']
        self.assertEqual(len(raw),200)
        lua.globals().commands[1]=f'RESTORE\t2\t{raw}\t{command_id}\n'
        lua.execute('for i=1,60 do tick() end')
        output=lua.globals().output
        self.assertTrue(json.loads(output[len(output)-1])['ok'])
        state=json.loads(output[len(output)])
        self.assertEqual(state['party'][0]['raw'],state['party'][1]['raw'])
        # Compare-and-replace refuses a stale team snapshot without writing.
        writes=lua.globals().writes
        lua.globals().commands[1]=f'PATCH\t2\t{"f"*200}\t{raw}\t{command_id}\n'
        lua.execute('tick()')
        self.assertFalse(json.loads(output[len(output)])['ok'])
        self.assertEqual(lua.globals().writes,writes)
        lua.globals().commands[1]=f'PATCH\t2\t{raw}\t{raw}\t{command_id}\n'
        lua.execute('tick()')
        self.assertTrue(json.loads(output[len(output)])['ok'])
        writes=lua.globals().writes
        corrupt=raw[:64]+('00' if raw[64:66]!='00' else '01')+raw[66:]
        lua.globals().commands[1]=f'RESTORE\t2\t{corrupt}\t{command_id}\n'
        lua.execute('tick()')
        self.assertFalse(json.loads(output[len(output)])['ok'])
        self.assertEqual(lua.globals().writes,writes)
        # Removing slot 1 compacts the following copy without changing a byte.
        lua.globals().commands[1]=f'REMOVE\t1\t{raw}\t{command_id}\n'
        lua.execute('for i=1,60 do tick() end')
        self.assertTrue(json.loads(output[len(output)-1])['ok'])
        state=json.loads(output[len(output)])
        self.assertEqual(len(state['party']),1)
        self.assertEqual(state['party'][0]['raw'],raw)
        self.assertEqual(lua.eval('emu:read32(0x020244EC+100)'),0)
        writes=lua.globals().writes
        lua.globals().commands[1]=f'REMOVE\t1\t{raw}\t{command_id}\n'
        lua.execute('tick()')
        self.assertFalse(json.loads(output[len(output)])['ok'])
        self.assertEqual(lua.globals().writes,writes)

    def test_auction_purchase_money_slot_and_rollback(self):
        for language in ('fr','en'):
            lua=self.run_lua(language)
            lua.execute('emu:write32(0x03005D8C,0x02001000);emu:write32(0x03005D90,0x02002000);emu:write16(0x02002000,0xFFBB);emu:write32(0x020020AC,0xABCD1234);emu:write32(0x02001490,10000 ~ 0xABCD1234)')
            values=['INJECT',1,255,'TEST',5,135,20,20,11,9,9,12,10]+[10,35,45,40,0,0,0,0]+[0,0,3,70,'TEST',12345,54321]+[31,4,7,9,10,11]+[1,2,3,4,5,6]+[0]
            def buy(price=1000,money=10000,count=0):
                lua.globals().commands[1]='\t'.join(map(str,['BUY',price,money,count]+values+['00000000-0000-4000-8000-000000000000']))+'\n'
                lua.execute('tick()')
                return json.loads(lua.globals().output[len(lua.globals().output)])['ok']
            writes=lua.globals().writes
            self.assertFalse(buy(money=9000));self.assertEqual(lua.globals().writes,writes)
            self.assertFalse(buy(price=11000));self.assertEqual(lua.globals().writes,writes)
            # Force the first debit to fail; insertion and money must both roll back.
            lua.execute('originalWrite32=emu.write32;failDebit=true;function emu:write32(a,v) if a==0x02001490 and failDebit then failDebit=false;error("simulated debit failure") end;originalWrite32(self,a,v) end')
            self.assertFalse(buy());self.assertEqual(lua.eval('emu:read8(0x020244E9)'),0)
            self.assertEqual(lua.eval('emu:read32(0x02001490) ~ emu:read32(0x020020AC)'),10000)
            self.assertEqual(lua.eval('emu:read32(0x020244EC)'),0)
            self.assertTrue(buy());self.assertEqual(lua.eval('emu:read8(0x020244E9)'),1)
            self.assertEqual(lua.eval('emu:read32(0x02001490) ~ emu:read32(0x020020AC)'),9000)
            writes=lua.globals().writes;self.assertFalse(buy());self.assertEqual(lua.globals().writes,writes)
            lua.execute('for i=1,60 do tick() end')
            state=json.loads(lua.globals().output[len(lua.globals().output)])
            self.assertEqual(state['trainer']['money'],9000)
            self.assertEqual(state['party'][0]['speciesId'],255)
            self.assertIn('auction-purchase-v1',state['capabilities'])
            lua.execute('emu:write8(0x020244E9,6)')
            writes=lua.globals().writes;self.assertFalse(buy(money=9000,count=6));self.assertEqual(lua.globals().writes,writes)

    def test_bundle_atomic_team_and_money_transaction(self):
        lua=self.run_lua('fr')
        lua.execute('emu:write32(0x03005D8C,0x02001000);emu:write32(0x03005D90,0x02002000);emu:write32(0x020020AC,0xABCD1234);emu:write32(0x02001490,10000 ~ 0xABCD1234)')
        values=['INJECT',1,255,'TEST',5,135,20,20,11,9,9,12,10]+[10,35,45,40,0,0,0,0]+[0,0,3,70,'TEST',12345,54321]+[31,4,7,9,10,11]+[1,2,3,4,5,6]+[0]
        command_id='00000000-0000-4000-8000-000000000000'
        lua.globals().commands[1]='\t'.join(map(str,values+[command_id]))+'\n'
        lua.execute('for i=1,60 do tick() end')
        raw=json.loads(lua.globals().output[len(lua.globals().output)])['party'][0]['raw']
        def bundle(before,after,money=10000,newmoney=9000):
            lua.globals().commands[1]=f'BUNDLE\t{money}\t{before}\t{newmoney}\t{after}\t{command_id}\n'
            lua.execute('tick()')
            return json.loads(lua.globals().output[len(lua.globals().output)])['ok']
        writes=lua.globals().writes
        self.assertFalse(bundle('f'*200,raw));self.assertEqual(lua.globals().writes,writes)
        self.assertFalse(bundle(raw,raw,money=1));self.assertEqual(lua.globals().writes,writes)
        corrupt=raw[:64]+('00' if raw[64:66]!='00' else '01')+raw[66:]
        self.assertFalse(bundle(raw,raw+corrupt))
        self.assertEqual(lua.eval('emu:read8(0x020244E9)'),1)
        self.assertEqual(lua.eval('emu:read32(0x02001490) ~ emu:read32(0x020020AC)'),10000)
        lua.execute('originalWrite32=emu.write32;failDebit=true;function emu:write32(a,v) if a==0x02001490 and failDebit then failDebit=false;error("simulated") end;originalWrite32(self,a,v) end')
        self.assertFalse(bundle(raw,raw+raw));self.assertEqual(lua.eval('emu:read8(0x020244E9)'),1)
        self.assertTrue(bundle(raw,raw+raw));self.assertEqual(lua.eval('emu:read8(0x020244E9)'),2)
        self.assertEqual(lua.eval('emu:read32(0x02001490) ~ emu:read32(0x020020AC)'),9000)
        self.assertTrue(bundle(raw+raw,raw,money=9000,newmoney=10000))
        self.assertEqual(lua.eval('emu:read32(0x020244EC+100)'),0)

    def test_trainer_battle_and_capture_events_read_encrypted_counters(self):
        lua=self.run_lua('fr')
        lua.execute('emu:write32(0x03005D8C,0x02001000);emu:write32(0x03005D90,0x02002000);emu:write16(0x02002000,0xFFBB);emu:write32(0x020020AC,12345);emu:write32(0x02001490,1000 ~ 12345);emu:write32(0x020025C0,5 ~ 12345);emu:write32(0x020025C8,2 ~ 12345)')
        lua.execute('for i=1,60 do tick() end')
        state=json.loads(lua.globals().output[len(lua.globals().output)])
        self.assertEqual(state['events'],{'trainerBattles':5,'captures':2,'trainerLead':None})
        lua.execute('emu:write32(0x020025C0,6 ~ 12345);emu:write32(0x020244EC,0x12345678);emu:write32(0x020244F0,0x87654321);for i=1,60 do tick() end')
        state=json.loads(lua.globals().output[len(lua.globals().output)])
        self.assertEqual(state['events']['trainerLead'],'7856341221436587')

    def test_localized_characters_and_map_labels(self):
        data=json.loads((ROOT/'emulator/profiles/game-data.json').read_text('utf-8'))
        self.assertEqual(data['characters']['27'],'é')
        self.assertEqual(data['characters']['22'],'à')
        self.assertEqual(data['maps']['fr']['0:9'],'Bourg-en-Vol')
        self.assertEqual(data['maps']['en']['0:9'],'Littleroot Town')


if __name__ == '__main__': unittest.main()
