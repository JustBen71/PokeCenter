-- Pokérace BPEF minimal live reader. Read-only: no write* API is used.
local PROFILE = "emerald-fr-bpef-live-v1"
local SAVE_BLOCK_1_PTR = 0x03005D8C
local SAVE_BLOCK_2_PTR = 0x03005D90
local PORT = 8765
local listener, client = nil, nil
local frames = 0
local commandBuffer = ""
local outdoorNames = {
    [0]="Clementi-Ville", [1]="Poivressel", [2]="Lavandia", [3]="Merouville",
    [4]="Cimetronelle", [5]="Nenucrique", [6]="Algatia", [7]="Atalanopolis",
    [8]="Eternara", [9]="Bourg-en-Vol", [10]="Rosyeres", [11]="Myokara",
    [12]="Vermilava", [13]="Autequia", [14]="Vergazon", [15]="Pacifiville"
}
for mapNumber=16, 49 do outdoorNames[mapNumber] = "Route " .. tostring(mapNumber + 85) end
local function mapName(group, number)
    if group == 0 and outdoorNames[number] then return outdoorNames[number] end
    return string.format("Zone inconnue (%d:%d)", group, number)
end

local function pointerIsEwram(value)
    return value >= 0x02000000 and value < 0x02040000
end

local function decodeChar(value)
    if value >= 0xBB and value <= 0xD4 then return string.char(65 + value - 0xBB) end
    if value >= 0xD5 and value <= 0xEE then return string.char(97 + value - 0xD5) end
    if value >= 0xA1 and value <= 0xAA then return string.char(48 + value - 0xA1) end
    local chars = {[0x00]=" ",[0x01]="À",[0x04]="Ç",[0x05]="È",[0x06]="É",[0x07]="Ê",[0x1B]="à",[0x1E]="ç",[0x1F]="è",[0x20]="é",[0x21]="ê",[0xAB]="!",[0xAC]="?",[0xAD]=".",[0xB4]="'",[0xB8]=",",[0xBA]="/"}
    return chars[value] or "?"
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
    if internalId >= 1 and internalId <= 251 then return internalId end
    if internalId >= 277 and internalId <= 411 then return internalId - 25 end
    return nil
end

local function readPokemon(slot)
    local base = 0x020244EC + (slot - 1) * 100
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
    return string.format('{"slot":%d,"speciesId":%d,"speciesName":"Pokémon %d","nickname":"%s","level":%d,"currentHp":%d,"maxHp":%d,"shiny":%s}', slot, species, species, escape(nickname), level, currentHp, maxHp, shinyValue < 8 and "true" or "false")
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
    if #v < 41 or v[1] ~= "INJECT" then return end
    local n = function(i) return tonumber(v[i]) or 0 end
    local slot, national, level = n(2), n(3), n(5)
    if slot < 1 or slot > 6 or national < 1 or national > 386 or level < 1 or level > 100 then return end
    local internal = national <= 251 and national or national + 25
    local tid, sid, nature, ability, shiny = n(27), n(28), n(24), n(23), n(41) == 1
    local otId = ((sid << 16) | tid) & 0xFFFFFFFF
    local personality = makePersonality(nature, shiny, otId)
    local raw = {}
    raw[0]=(internal|(n(22)<<16))&0xFFFFFFFF;raw[1]=n(6)&0xFFFFFFFF;raw[2]=(n(25)<<8)&0xFFFFFFFF
    raw[3]=(n(14)|(n(16)<<16))&0xFFFFFFFF;raw[4]=(n(18)|(n(20)<<16))&0xFFFFFFFF;raw[5]=(n(15)|(n(17)<<8)|(n(19)<<16)|(n(21)<<24))&0xFFFFFFFF
    raw[6]=(n(35)|(n(36)<<8)|(n(37)<<16)|(n(38)<<24))&0xFFFFFFFF;raw[7]=(n(39)|(n(40)<<8))&0xFFFFFFFF;raw[8]=0;raw[9]=0
    raw[10]=(n(29)|(n(30)<<5)|(n(31)<<10)|(n(32)<<15)|(n(33)<<20)|(n(34)<<25)|(ability<<31))&0xFFFFFFFF;raw[11]=0
    local checksum=0;for i=0,11 do checksum=(checksum+(raw[i]&0xFFFF)+((raw[i]>>16)&0xFFFF))&0xFFFF end
    local base,key=0x020244EC+(slot-1)*100,personality~otId
    emu:write32(base,personality);emu:write32(base+4,otId);writeText(base+8,v[4],10);emu:write8(base+0x12,2);emu:write8(base+0x13,2);writeText(base+0x14,v[26],7);emu:write8(base+0x1B,0);emu:write16(base+0x1C,checksum);emu:write16(base+0x1E,0)
    local order=orders[(personality%24)+1];local starts={G=0,A=3,E=6,M=9}
    for physical=0,3 do local logical=starts[order:sub(physical+1,physical+1)];for word=0,2 do emu:write32(base+0x20+(physical*3+word)*4,(raw[logical+word]~key)&0xFFFFFFFF) end end
    emu:write32(base+0x50,0);emu:write8(base+0x54,level);emu:write8(base+0x55,0xFF);emu:write16(base+0x56,n(7));emu:write16(base+0x58,n(8));emu:write16(base+0x5A,n(9));emu:write16(base+0x5C,n(10));emu:write16(base+0x5E,n(11));emu:write16(base+0x60,n(12));emu:write16(base+0x62,n(13))
    local count=emu:read8(0x020244E9);if slot>count then emu:write8(0x020244E9,slot) end
    console:log(string.format("Pokérace: Pokémon %d inséré dans le slot %d",national,slot))
end

local function snapshot()
    local sb1, sb2 = emu:read32(SAVE_BLOCK_1_PTR), emu:read32(SAVE_BLOCK_2_PTR)
    if not pointerIsEwram(sb1) or not pointerIsEwram(sb2) then return nil end
    local name = readText(sb2, 7)
    local trainerId = emu:read16(sb2 + 0x0A)
    local hours = emu:read16(sb2 + 0x0E)
    local minutes, seconds = emu:read8(sb2 + 0x10), emu:read8(sb2 + 0x11)
    local mapGroup, mapNumber = emu:read8(sb1 + 0x04), emu:read8(sb1 + 0x05)
    local partyCount = emu:read8(0x020244E9)
    if name == "" or name:find("?", 1, true) or hours > 9999 or minutes > 59 or seconds > 59 or partyCount > 6 then return nil end
    local elapsed = hours * 3600 + minutes * 60 + seconds
    local party = {}
    for slot = 1, partyCount do
        local pokemon = readPokemon(slot)
        if pokemon then party[#party + 1] = pokemon end
    end
    return string.format('{"protocolVersion":1,"playerId":"placeholder","game":{"name":"pokemon-emerald","language":"fr","profileId":"%s","romStatus":"recognized","revision":"BPEF v0","header":{"title":"POKEMON EMER","gameCode":"BPEF","version":0},"romSha256":null},"trainer":{"name":"%s","id":%d,"playTimeSeconds":%d,"partyCount":%d},"location":{"mapGroup":%d,"mapNumber":%d,"label":"%s"},"party":[%s],"observedAt":"1970-01-01T00:00:00Z","diagnostic":"Lecture RAM mGBA active."}', PROFILE, escape(name), trainerId, elapsed, partyCount, mapGroup, mapNumber, escape(mapName(mapGroup, mapNumber)), table.concat(party, ","))
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
    if not listener then ensureServer() end
    if listener and not client then client = listener:accept() end
    if client and client:hasdata() then
        local chunk = client:receive(4096)
        if chunk then
            commandBuffer = commandBuffer .. chunk
            while commandBuffer:find("\n", 1, true) do
                local ending = commandBuffer:find("\n", 1, true)
                local line = commandBuffer:sub(1, ending - 1)
                commandBuffer = commandBuffer:sub(ending + 1)
                injectPokemon(splitTabs(line))
            end
        end
    end
    if client and frames % 300 == 0 then
        local data = snapshot()
        if data then local sent = client:send(data .. "\n"); if not sent then client = nil end end
    end
end)

console:log("Pokérace: profil BPEF chargé; lecture et insertion actives")
