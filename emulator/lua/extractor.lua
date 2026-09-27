-- Generated launch configuration is required. Unknown ROMs never access memory.
local listener, client = nil, nil
local frames = 0
local commandBuffer = ""
local config = assert(POKERACE_CONFIG, "Lancez le client player.cmd pour identifier la ROM")
local identity, data = config.identity, config.data
local profile = identity.profile
local enabled = identity.status == "recognized" and profile ~= nil
local PROFILE = enabled and profile.profileId or ""
local SAVE_BLOCK_1_PTR = enabled and profile.saveBlock1Pointer or 0
local SAVE_BLOCK_2_PTR = enabled and profile.saveBlock2Pointer or 0
local PORT = config.port
local function mapName(group, number)
    return data.maps[profile.language][tostring(group) .. ":" .. tostring(number)] or string.format("Zone inconnue (%d:%d)", group, number)
end

local function pointerIsEwram(value)
    return value >= 0x02000000 and value <= 0x0203FFF0
end

local function decodeChar(value)
    return data.characters[tostring(value)] or "?"
end

local function readText(address, maxLength)
    local result = ""
    for i = 0, maxLength - 1 do
        local value = emu:read8(address + i)
        if value == 0xFF then break end
        result = result .. decodeChar(value)
    end
    return result
end

local function escape(value)
    return value:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n")
end

local orders = {"GAEM","GAME","GEAM","GEMA","GMAE","GMEA","AGEM","AGME","AEGM","AEMG","AMGE","AMEG","EGAM","EGMA","EAGM","EAMG","EMGA","EMAG","MGAE","MGEA","MAGE","MAEG","MEGA","MEAG"}

local function nationalSpecies(internalId)
    return data.internalToNational[tostring(internalId)]
end
local function internalSpecies(national)
    for id, dex in pairs(data.internalToNational) do if dex == national then return tonumber(id) end end
end

local function readPokemon(slot)
    local base = profile.partyAddress + (slot - 1) * 100
    local personality, otId = emu:read32(base), emu:read32(base + 4)
    local key = personality ~ otId
    local words, checksum = {}, 0
    for i = 0, 11 do
        local word = (emu:read32(base + 0x20 + i * 4) ~ key) & 0xFFFFFFFF
        words[i] = word
        checksum = (checksum + (word & 0xFFFF) + ((word >> 16) & 0xFFFF)) & 0xFFFF
    end
    if checksum ~= emu:read16(base + 0x1C) then return nil end
    local order = orders[(personality % 24) + 1]
    local growthBlock = assert(order:find("G", 1, true)) - 1
    local internalId = words[growthBlock * 3] & 0xFFFF
    local species = nationalSpecies(internalId)
    local level, currentHp, maxHp = emu:read8(base + 0x54), emu:read16(base + 0x56), emu:read16(base + 0x58)
    if not species or level < 1 or level > 100 or maxHp < 1 or maxHp > 999 or currentHp > maxHp then return nil end
    local nickname = readText(base + 8, 10)
    local shinyValue = ((otId & 0xFFFF) ~ ((otId >> 16) & 0xFFFF) ~ (personality & 0xFFFF) ~ ((personality >> 16) & 0xFFFF)) & 0xFFFF
    local raw = ""
    for i = 0, 99 do raw = raw .. string.format("%02x", emu:read8(base + i)) end
    return string.format('{"slot":%d,"speciesId":%d,"speciesName":"%s","nickname":"%s","level":%d,"currentHp":%d,"maxHp":%d,"shiny":%s,"raw":"%s"}', slot, species, escape(data.species[profile.language][tostring(species)]), escape(nickname), level, currentHp, maxHp, shinyValue < 8 and "true" or "false", raw)
end

-- SaveBlock1 gameStats use the same save encryption key as money.
local lastTrainerBattles, lastTrainerLead = nil, nil
local function readEvents()
    if not enabled then return nil end
    local sb1,sb2=emu:read32(SAVE_BLOCK_1_PTR),emu:read32(SAVE_BLOCK_2_PTR)
    if not pointerIsEwram(sb1) or sb1>0x0203EA30 or not pointerIsEwram(sb2) or sb2>0x0203FF50 then return nil end
    local key=emu:read32(sb2+0xAC)
    local trainers=(emu:read32(sb1+0x159C+9*4) ~ key)&0xFFFFFFFF
    local captures=(emu:read32(sb1+0x159C+11*4) ~ key)&0xFFFFFFFF
    if trainers>16777215 or captures>16777215 then return nil end
    if lastTrainerBattles and trainers>lastTrainerBattles then
        lastTrainerLead=''
        for i=0,7 do lastTrainerLead=lastTrainerLead..string.format('%02x',emu:read8(profile.partyAddress+i)) end
    elseif lastTrainerBattles and trainers<lastTrainerBattles then lastTrainerLead=nil end
    lastTrainerBattles=trainers
    return string.format('{"trainerBattles":%d,"captures":%d,"trainerLead":%s}',trainers,captures,lastTrainerLead and ('"'..lastTrainerLead..'"') or 'null')
end

local function splitTabs(line)
    local values = {}
    for value in (line .. "\t"):gmatch("(.-)\t") do values[#values + 1] = value end
    return values
end

local function encodeChar(char)
    local byte = char:byte()
    if byte >= 65 and byte <= 90 then return 0xBB + byte - 65 end
    if byte >= 48 and byte <= 57 then return 0xA1 + byte - 48 end
    if char == " " then return 0x00 end
    if char == "-" then return 0xAE end
    return 0xAC
end

local function writeText(address, value, length)
    for i = 0, length - 1 do emu:write8(address + i, i < #value and encodeChar(value:sub(i + 1, i + 1)) or 0xFF) end
end

local function makePersonality(nature, shiny, otId)
    local tid, sid = otId & 0xFFFF, (otId >> 16) & 0xFFFF
    for high = 0, 65535 do
        local low = shiny and ((tid ~ sid ~ high) & 0xFFFF) or ((high * 109 + 31337) & 0xFFFF)
        local pid = ((high << 16) | low) & 0xFFFFFFFF
        local sv = (tid ~ sid ~ high ~ low) & 0xFFFF
        if pid % 25 == nature and ((shiny and sv < 8) or (not shiny and sv >= 8)) then return pid end
    end
    return nature
end

local function injectPokemon(v)
    if v[1] == "SAVE" then
        if #v ~= 1 or not config.autosavePath then error("Sauvegarde automatique non configurée") end
        if not emu:saveStateFile(config.autosavePath, 31) then error("Échec de la sauvegarde mGBA") end
        return
    end
    if not enabled then error("ROM non validée : écriture interdite") end
    if profile.allowWrites == false then error("Profil validé en lecture uniquement : insertion non validée") end
    if v[1] == "BUNDLE" then
        local beforeMoney,afterMoney=tonumber(v[2]),tonumber(v[4])
        local before,after=v[3],v[5]
        if #v~=5 or not beforeMoney or not afterMoney or beforeMoney%1~=0 or afterMoney%1~=0 or beforeMoney<0 or beforeMoney>999999 or afterMoney<0 or afterMoney>999999
            or #before%200~=0 or #after%200~=0 or #before>1200 or #after>1200 or #after<200 or before:find('[^a-f0-9]') or after:find('[^a-f0-9]') then error("Transaction invalide") end
        local sb1,sb2=emu:read32(SAVE_BLOCK_1_PTR),emu:read32(SAVE_BLOCK_2_PTR)
        if not pointerIsEwram(sb1) or sb1>0x0203FB6C or not pointerIsEwram(sb2) or sb2>0x0203FF50 then error("Partie indisponible") end
        local key=emu:read32(sb2+0xAC);local encrypted=emu:read32(sb1+0x490)
        local count=emu:read8(profile.partyCountAddress)
        if count~=#before/200 or ((encrypted~key)&0xFFFFFFFF)~=beforeMoney then error("L'équipe ou le solde a changé") end
        local actual,backup='',{}
        for i=0,599 do backup[i]=emu:read8(profile.partyAddress+i);if i<count*100 then actual=actual..string.format('%02x',backup[i]) end end
        if actual~=before then error("Un Pokémon a changé") end
        local ok,failure=pcall(function()
            -- RESTORE validates every checksum and all resulting party stats.
            for slot=1,#after/200 do injectPokemon({'RESTORE',tostring(slot),after:sub((slot-1)*200+1,slot*200)}) end
            for i=#after/2,599 do emu:write8(profile.partyAddress+i,0) end
            emu:write8(profile.partyCountAddress,#after/200)
            emu:write32(sb1+0x490,(afterMoney~key)&0xFFFFFFFF)
            if emu:read32(sb1+0x490)~=((afterMoney~key)&0xFFFFFFFF) or emu:read8(profile.partyCountAddress)~=#after/200 then error("Transaction non confirmée") end
        end)
        if not ok then
            for i=0,599 do emu:write8(profile.partyAddress+i,backup[i]) end
            emu:write8(profile.partyCountAddress,count);emu:write32(sb1+0x490,encrypted);error(failure)
        end
        return
    end
    if v[1] == "BUY" then
        local price, expectedMoney, expectedCount = tonumber(v[2]), tonumber(v[3]), tonumber(v[4])
        local sb1, sb2 = emu:read32(SAVE_BLOCK_1_PTR), emu:read32(SAVE_BLOCK_2_PTR)
        if #v ~= 45 or v[5] ~= "INJECT" or not price or price%1~=0 or price<1 or price>999999
            or not expectedCount or expectedCount%1~=0 or expectedCount<0 or expectedCount>=6
            or not pointerIsEwram(sb1) or sb1>0x0203FB6C or not pointerIsEwram(sb2) or sb2>0x0203FF50 then error("Achat invalide ou équipe pleine") end
        local count = emu:read8(profile.partyCountAddress)
        local encrypted, key = emu:read32(sb1+0x490), emu:read32(sb2+0xAC)
        local money = (encrypted ~ key) & 0xFFFFFFFF
        if count~=expectedCount or tonumber(v[6])~=count+1 then error("L'équipe a changé : achat refusé") end
        if money>999999 or money~=expectedMoney or money<price then error("Solde changé ou insuffisant : achat refusé") end
        for i=1,count do if not readPokemon(i) then error("Équipe invalide") end end
        local base, backup = profile.partyAddress+count*100, {}
        for i=0,99 do backup[i]=emu:read8(base+i) end
        local injection={};for i=5,#v do injection[#injection+1]=v[i] end
        -- One frame callback: game code cannot run between debit and insertion.
        local ok,failure=pcall(function()
            injectPokemon(injection)
            emu:write32(sb1+0x490,((money-price) ~ key)&0xFFFFFFFF)
            if emu:read32(sb1+0x490)~=((money-price) ~ key)&0xFFFFFFFF or emu:read8(profile.partyCountAddress)~=count+1 then error("Achat non confirmé") end
        end)
        if not ok then
            for i=0,99 do emu:write8(base+i,backup[i]) end
            emu:write8(profile.partyCountAddress,count);emu:write32(sb1+0x490,encrypted)
            error(failure)
        end
        return
    end
    if v[1] == "PATCH" then
        local slot = tonumber(v[2])
        if #v ~= 4 or not slot or slot % 1 ~= 0 or slot < 1 or slot > 6 or slot > emu:read8(profile.partyCountAddress) then error("Cible indisponible") end
        local base, current = profile.partyAddress+(slot-1)*100, ""
        for i = 0, 99 do current=current..string.format("%02x",emu:read8(base+i)) end
        if current ~= v[3] then error("Le Pokémon a changé depuis le tirage") end
        v={"RESTORE",v[2],v[4]}
    end
    if v[1] == "REMOVE" then
        local slot, count = tonumber(v[2]), emu:read8(profile.partyCountAddress)
        if #v ~= 3 or not slot or slot % 1 ~= 0 or slot < 1 or slot > count or count > 6
            or not pointerIsEwram(emu:read32(SAVE_BLOCK_1_PTR)) or not pointerIsEwram(emu:read32(SAVE_BLOCK_2_PTR)) then error("Équipe indisponible") end
        if count <= 1 then error("Gardez au moins un Pokémon dans l'équipe") end
        local backup, expected = {}, ""
        for i = 0, count*100-1 do backup[i]=emu:read8(profile.partyAddress+i) end
        for i = (slot-1)*100, slot*100-1 do expected=expected..string.format("%02x",backup[i]) end
        if expected ~= v[3] then error("Le Pokémon a changé : actualisez puis réessayez") end
        for i = 1, count do if not readPokemon(i) then error("Équipe invalide") end end
        local result = {}
        for i = 0, count*100-1 do
            result[i] = i < (slot-1)*100 and backup[i] or (i < (count-1)*100 and backup[i+100] or 0)
        end
        local ok, failure = pcall(function()
            for i = 0, count*100-1 do emu:write8(profile.partyAddress+i,result[i]) end
            for i = 0, count*100-1 do if emu:read8(profile.partyAddress+i) ~= result[i] then error("Suppression non confirmée") end end
            emu:write8(profile.partyCountAddress,count-1)
            if emu:read8(profile.partyCountAddress) ~= count-1 then error("Compteur incorrect") end
        end)
        if not ok then
            for i = 0, count*100-1 do emu:write8(profile.partyAddress+i,backup[i]) end
            emu:write8(profile.partyCountAddress,count)
            error(failure)
        end
        return
    end
    if v[1] == "RESTORE" then
        if #v ~= 3 or #v[3] ~= 200 or v[3]:find("[^a-f0-9]") then error("Copie Pokémon invalide") end
        local slot = tonumber(v[2])
        local count = emu:read8(profile.partyCountAddress)
        if not slot or slot % 1 ~= 0 or slot < 1 or slot > 6 or count > 6 or slot > count + 1
            or not pointerIsEwram(emu:read32(SAVE_BLOCK_1_PTR)) or not pointerIsEwram(emu:read32(SAVE_BLOCK_2_PTR)) then error("Équipe indisponible ou slot non contigu") end
        local bytes = {}
        for i = 0, 99 do bytes[i] = tonumber(v[3]:sub(i*2+1, i*2+2), 16) end
        local function word(i) return bytes[i] | (bytes[i+1]<<8) | (bytes[i+2]<<16) | (bytes[i+3]<<24) end
        local pid, key = word(0), word(0) ~ word(4)
        local sum = 0
        for i = 0, 11 do local w = (word(32+i*4) ~ key) & 0xFFFFFFFF; sum = (sum+(w&65535)+(w>>16))&65535 end
        local growth = assert(orders[(pid%24)+1]:find("G",1,true))-1
        local species = nationalSpecies((word(32+growth*12) ~ key)&65535)
        local hp, maxHp = bytes[86]+bytes[87]*256, bytes[88]+bytes[89]*256
        if sum ~= bytes[28]+bytes[29]*256 or not species or bytes[84]<1 or bytes[84]>100 or maxHp<1 or maxHp>999 or hp>maxHp then error("Copie corrompue") end
        local base, backup = profile.partyAddress+(slot-1)*100, {}
        for i = 0, 99 do backup[i] = emu:read8(base+i) end
        local ok, failure = pcall(function()
            for i = 0, 99 do emu:write8(base+i,bytes[i]) end
            for i = 0, 99 do if emu:read8(base+i) ~= bytes[i] then error("Copie différente après écriture") end end
            if slot > count then emu:write8(profile.partyCountAddress,slot) end
            if emu:read8(profile.partyCountAddress) ~= math.max(slot,count) then error("Compteur équipe incorrect") end
        end)
        if not ok then
            for i = 0, 99 do emu:write8(base+i,backup[i]) end
            emu:write8(profile.partyCountAddress,count)
            error(failure)
        end
        return
    end
    if #v ~= 41 or v[1] ~= "INJECT" then error("Commande invalide") end
    local n = function(i) return tonumber(v[i]) or 0 end
    local slot, national, level = n(2), n(3), n(5)
    local sb1, sb2 = emu:read32(SAVE_BLOCK_1_PTR), emu:read32(SAVE_BLOCK_2_PTR)
    local count = emu:read8(profile.partyCountAddress)
    if not pointerIsEwram(sb1) or not pointerIsEwram(sb2) or count > 6 or slot > count + 1 then error("Équipe indisponible ou slot non contigu") end
    if slot < 1 or slot > 6 or national < 1 or national > 386 or level < 1 or level > 100 then error("Valeurs Pokémon invalides") end
    local internal = assert(internalSpecies(national))
    local tid, sid, nature, ability, shiny = n(27), n(28), n(24), n(23), n(41) == 1
    local otId = ((sid << 16) | tid) & 0xFFFFFFFF
    local personality = makePersonality(nature, shiny, otId)
    local raw = {}
    raw[0]=(internal|(n(22)<<16))&0xFFFFFFFF;raw[1]=n(6)&0xFFFFFFFF;raw[2]=(n(25)<<8)&0xFFFFFFFF
    raw[3]=(n(14)|(n(16)<<16))&0xFFFFFFFF;raw[4]=(n(18)|(n(20)<<16))&0xFFFFFFFF;raw[5]=(n(15)|(n(17)<<8)|(n(19)<<16)|(n(21)<<24))&0xFFFFFFFF
    raw[6]=(n(35)|(n(36)<<8)|(n(37)<<16)|(n(38)<<24))&0xFFFFFFFF;raw[7]=(n(39)|(n(40)<<8))&0xFFFFFFFF;raw[8]=0;raw[9]=0
    raw[10]=(n(29)|(n(30)<<5)|(n(31)<<10)|(n(32)<<15)|(n(33)<<20)|(n(34)<<25)|(ability<<31))&0xFFFFFFFF;raw[11]=0
    local checksum=0;for i=0,11 do checksum=(checksum+(raw[i]&0xFFFF)+((raw[i]>>16)&0xFFFF))&0xFFFF end
    local base,key=profile.partyAddress+(slot-1)*100,personality~otId
    emu:write32(base,personality);emu:write32(base+4,otId);writeText(base+8,v[4],10);emu:write8(base+0x12,profile.language == "fr" and 3 or 2);emu:write8(base+0x13,2);writeText(base+0x14,v[26],7);emu:write8(base+0x1B,0);emu:write16(base+0x1C,checksum);emu:write16(base+0x1E,0)
    local order=orders[(personality%24)+1];local starts={G=0,A=3,E=6,M=9}
    for physical=0,3 do local logical=starts[order:sub(physical+1,physical+1)];for word=0,2 do emu:write32(base+0x20+(physical*3+word)*4,(raw[logical+word]~key)&0xFFFFFFFF) end end
    emu:write32(base+0x50,0);emu:write8(base+0x54,level);emu:write8(base+0x55,0xFF);emu:write16(base+0x56,n(7));emu:write16(base+0x58,n(8));emu:write16(base+0x5A,n(9));emu:write16(base+0x5C,n(10));emu:write16(base+0x5E,n(11));emu:write16(base+0x60,n(12));emu:write16(base+0x62,n(13))
    local count=emu:read8(profile.partyCountAddress);if slot>count then emu:write8(profile.partyCountAddress,slot) end
    if not readPokemon(slot) or emu:read32(base) ~= personality or emu:read32(base+4) ~= otId
        or emu:read8(base+0x54) ~= level or emu:read16(base+0x56) ~= n(7) then
        error("Échec de vérification après écriture")
    end
    for physical=0,3 do
        local logical=starts[order:sub(physical+1,physical+1)]
        for word=0,2 do
            if emu:read32(base+0x20+(physical*3+word)*4) ~= ((raw[logical+word]~key)&0xFFFFFFFF) then
                error("Données Pokémon différentes après écriture")
            end
        end
    end
    console:log(string.format("Pokérace: Pokémon %d inséré dans le slot %d",national,slot))
end

local function readProgression(sb1)
    if not config.progression then return "null" end
    local completed = {}
    for _, objective in ipairs(config.progression.objectives) do
        local done = false
        for _, flag in ipairs(objective.flags) do
            local byte = emu:read8(sb1 + config.progression.flagsOffset + math.floor(flag / 8))
            if (byte & (1 << (flag % 8))) ~= 0 then done = true end
        end
        if done then completed[#completed+1] = '"' .. objective.id .. '"' end
    end
    return '{"version":1,"completed":[' .. table.concat(completed,",") .. ']}'
end

local function snapshot()
    if not enabled then return config.diagnosticJson end
    local sb1, sb2 = emu:read32(SAVE_BLOCK_1_PTR), emu:read32(SAVE_BLOCK_2_PTR)
    if not pointerIsEwram(sb1) or not pointerIsEwram(sb2) then return nil end
    local name = readText(sb2, 7)
    local trainerId = emu:read16(sb2 + 0x0A)
    local hours = emu:read16(sb2 + 0x0E)
    local minutes, seconds = emu:read8(sb2 + 0x10), emu:read8(sb2 + 0x11)
    local mapGroup, mapNumber = emu:read8(sb1 + 0x04), emu:read8(sb1 + 0x05)
    local partyCount = emu:read8(profile.partyCountAddress)
    if name == "" or name:find("?", 1, true) or hours > 9999 or minutes > 59 or seconds > 59 or partyCount > 6 then return nil end
    local moneyJson = ""
    if sb1<=0x0203FB6C and sb2<=0x0203FF50 then
        local money=(emu:read32(sb1+0x490) ~ emu:read32(sb2+0xAC))&0xFFFFFFFF
        if money<=999999 then moneyJson=',"money":'..tostring(money) end
    end
    local events=readEvents();local eventsJson=events and (',"events":'..events) or ''
    local elapsed = hours * 3600 + minutes * 60 + seconds
    local party = {}
    for slot = 1, partyCount do
        local pokemon = readPokemon(slot)
        if not pokemon then return nil end
        party[#party + 1] = pokemon
    end
    return string.format('{"protocolVersion":1,"playerId":"placeholder","game":%s,"capabilities":["compare-replace-v1","auction-purchase-v1","game-bundle-v1"],"progression":%s%s,"trainer":{"name":"%s","id":%d,"playTimeSeconds":%d,"partyCount":%d%s},"location":{"mapGroup":%d,"mapNumber":%d,"label":"%s"},"party":[%s],"observedAt":"1970-01-01T00:00:00Z","diagnostic":null}', config.gameJson, readProgression(sb1), eventsJson, escape(name), trainerId, elapsed, partyCount, moneyJson, mapGroup, mapNumber, escape(mapName(mapGroup, mapNumber)), table.concat(party, ","))
end

local function ensureServer()
    if listener then return end
    listener = socket.bind("127.0.0.1", PORT)
    if not listener then console:error("Pokérace: port 8765 indisponible; retirez les anciennes copies du script") return end
    listener:listen(1)
    console:log("Pokérace: extracteur en écoute sur 127.0.0.1:8765")
end

callbacks:add("frame", function()
    frames = frames + 1
    if enabled and profile.allowWrites~=false then readEvents() end
    if not listener then ensureServer() end
    if listener and not client then
        client = listener:accept()
        if client then client:send('{"type":"hello","session":"' .. config.session .. '"}\n') end
    end
    if client and client:hasdata() then
        local chunk = client:receive(4096)
        if chunk then
            commandBuffer = commandBuffer .. chunk
            if #commandBuffer > 32768 then client:close(); client = nil; commandBuffer = ""; return end
            while commandBuffer:find("\n", 1, true) do
                local ending = commandBuffer:find("\n", 1, true)
                local line = commandBuffer:sub(1, ending - 1)
                commandBuffer = commandBuffer:sub(ending + 1)
                local values = splitTabs(line)
                local commandId = table.remove(values, #values)
                if commandId and commandId:match("^[a-f0-9%-]+$") then
                    local ok, failure = pcall(injectPokemon, values)
                    client:send(string.format('{"type":"commandResult","commandId":"%s","ok":%s,"error":"%s"}\n', commandId, ok and "true" or "false", escape(ok and "" or tostring(failure))))
                end
            end
        end
    end
    if client and frames % 60 == 0 then
        local ok, result = pcall(snapshot)
        local data = ok and result or nil
        if not data then data = config.waitingJson end
        if data then local sent = client:send(data .. "\n"); if not sent then client = nil end end
    end
end)

console:log(enabled and ("Pokérace: profil " .. PROFILE .. " chargé") or "Pokérace: ROM inconnue, mémoire désactivée")
