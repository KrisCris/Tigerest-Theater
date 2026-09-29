"""Exercise UOSC's real pause button with physical and intended pause separated."""
import os
from pathlib import Path
import subprocess
import tempfile

root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='rife-uosc-') as folder:
    folder=Path(folder)
    module=root/'resources/mpv/plugins/uosc/elements/CycleButton.lua'
    script=folder/'probe.lua'
    script.write_text(r'''
local real_mp=require('mp')
local values={pause='yes',['user-data/tigerest/rife-startup-pause']=false}
local observers={}
local sent,set
mp={get_property_native=function(key)return values[key]end,
    get_property=function(key)return values[key]end,
    set_property=function(key,value)set={key,value}end,
    commandv=function(...)sent={...}end}
package.preload['elements/Button']=function()return {init=function(self,id,props)
    self.observe_mp_property=function(_,key,kind,handler)observers[key]=handler;handler(key,values[key])end
end}end
class=function()return {}end
itable_index_of=function(t,value)for i,v in ipairs(t)do if v==value then return i end end end
itable_find=function(t,fn)for i,v in ipairs(t)do if fn(v)then return i end end end
split=function(value)return {value}end
request_render=function()end
trim=function(value)return value end
local function tests()
    local button=setmetatable({},{__index=dofile([=[MODULE]=])})
    button:init('pause',{prop='pause',states={{value='no',icon='pause'},{value='yes',icon='play'}}})
    assert(button.icon=='pause','preparation must display intended playing state')
    button.on_click()
    assert(sent and sent[1]=='script-message' and sent[2]=='tigerest-rife-toggle-pause','click lost toggle intent')
    assert(not set,'button must not write the physically held pause')
    values['user-data/tigerest/rife-startup-pause']=true
    observers['user-data/tigerest/rife-startup-pause']('',true)
    assert(button.icon=='play','user pause intent not rendered')
    values['user-data/tigerest/rife-startup-pause']=''
    observers['user-data/tigerest/rife-startup-pause']('','')
    button.on_click()
    assert(set and set[1]=='pause' and set[2]=='no','ordinary playback behavior changed')
end
local ok,err=pcall(tests)
local f=assert(io.open([=[RESULT]=],'w'));f:write(ok and 'ok' or tostring(err));f:close()
real_mp.commandv('quit')
'''.replace('MODULE',str(module)).replace('RESULT',str(folder/'result')))
    subprocess.run([os.environ['RIFE_MPV_BINARY'],'--no-config','--idle=yes','--vo=null','--ao=null',
                    '--load-scripts=no',f'--script={script}'],timeout=15,check=True,capture_output=True)
    result=(folder/'result').read_text()
    assert result=='ok',result
print('PASS: UOSC pause intent and normal playback fallback')
