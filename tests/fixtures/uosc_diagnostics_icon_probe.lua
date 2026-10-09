local real_mp = require('mp')
local utils = require('mp.utils')
local api = setmetatable({}, {__index=real_mp})
function api.commandv(...)
    local args={...}
    if args[1]=='script-message-to' and args[2]=='uosc' and args[3]=='set-button' and args[4]=='diagnostics' then
        real_mp.set_property_native('user-data/tigerest-test/diagnostic-icon',utils.parse_json(args[5]).icon)
        return
    end
    return real_mp.commandv(...)
end
local env=setmetatable({require=function(name) if name=='mp' then return api end return require(name) end},{__index=_G})
local path=real_mp.get_property_native('user-data/tigerest-test/profile-script')
local fn,err
if setfenv then
    fn,err=loadfile(path)
    assert(fn,err); setfenv(fn,env)
else
    fn,err=loadfile(path,'t',env)
end
assert(fn,err); fn()
