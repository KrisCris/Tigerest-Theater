#!/usr/bin/env python3
"""Execute the shipped PC Lua matcher to generate the iPad parity oracle."""
import json, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def work(id,title,episodes,server='http://fixture',type='tvseries'):
 return {'bangumiId':str(id),'animeTitle':title,'type':type,'_server':server,'episodes':episodes}
def ep(id,n,title):return {'episodeId':str(id),'episodeNumber':str(n),'episodeTitle':title}
cases=[
 {'name':'title-priority','title':'作品','season':1,'number':1,'episodeTitle':'终点','works':[work(1,'作品',[ep(11,1,'第1话 起点'),ep(12,2,'第2话 终点')])]},
 {'name':'ambiguous-title','title':'作品','season':1,'number':1,'episodeTitle':'终点','works':[work(1,'作品',[ep(11,1,'终点'),ep(12,2,'终点')])]},
 {'name':'deduplicate-rows','title':'作品','season':1,'number':1,'episodeTitle':'起点','works':[work(1,'作品',[ep(11,1,'起点'),ep(11,1,'起点')])]},
 {'name':'exclude-credits','title':'作品','season':1,'number':1,'episodeTitle':'OP','works':[work(1,'作品',[ep(11,'C1','OP'),ep(12,1,'第1话 起点'),ep(13,1,'opening theme')])]},
 {'name':'season-period','title':'作品','season':2,'number':1,'episodeTitle':'第1集','works':[work(1,'作品',[ep(11,1,'开始')]),work(2,'作品 第二期',[ep(21,1,'开始')])]},
 {'name':'english-season','title':'The Story','season':3,'number':1,'episodeTitle':'','works':[work(1,'The Story Third Season',[ep(11,1,'开始')])]},
 {'name':'closest-work','title':'转生后的大圣女极力隐瞒圣女的身份','season':1,'number':1,'episodeTitle':'','works':[work(1,'转生后的大圣女，极力隐瞒圣女的身份',[ep(11,1,'开始')]),work(2,'转生后的大圣女 极力隐藏圣女身份',[ep(21,1,'开始')])]},
 {'name':'provider-local-identities','title':'作品','season':1,'number':1,'episodeTitle':'','works':[work(1,'作品',[ep(11,1,'开始')]),work(1,'作品',[ep(11,1,'开始')],'http://second')]},
 {'name':'special-release','title':'作品','season':0,'number':1,'episodeTitle':'','works':[work(1,'作品 特别篇',[ep(11,1,'特别篇')]),work(2,'作品',[ep(21,1,'开始')])]},
 {'name':'wrong-type','title':'作品','season':1,'number':1,'episodeTitle':'','works':[work(1,'作品',[ep(11,1,'开始')],type='movie')]},
]
# Recorded anonymous API response: 青之箱 S1E1 is catalogued as 蓝箱.
bluebox=work(18278,'蓝箱',[ep(182780001,1,'第1话 千夏前辈')])
bluebox['titles']=[{'title':x} for x in ['蓝箱','Ao no Hako','アオのハコ','Blue Box','青春之箱','青之箱']]
wrong_season=work(19249,'青之箱 第二季',[ep(192490001,1,'第1话')]);wrong_season['titles']=[{'title':'青之箱'}]
other=work(999,'其他作品',[ep(999001,1,'千夏前辈')]);other['titles']=[{'title':'青之箱'}]
cases += [
 {'name':'bluebox-official-alias','title':'青之箱','season':1,'number':1,'episodeTitle':'千夏前辈','works':[bluebox,wrong_season],'required':'http://fixture/182780001'},
 {'name':'alias-cannot-cross-season','title':'青之箱','season':1,'number':1,'episodeTitle':'','works':[wrong_season],'required':''},
 {'name':'alias-cannot-resolve-ambiguous-releases','title':'青之箱','season':1,'number':1,'episodeTitle':'千夏前辈','works':[bluebox,other],'required':''},
]
def lua(v):
 if v is None:return 'nil'
 if isinstance(v,bool):return 'true' if v else 'false'
 if isinstance(v,str):return json.dumps(v,ensure_ascii=False)
 if isinstance(v,(int,float)):return str(v)
 if isinstance(v,list):return '{'+','.join(map(lua,v))+'}'
 return '{'+','.join('['+lua(k)+']='+lua(x) for k,x in v.items())+'}'
source=ROOT/'resources/mpv/plugins/uosc_danmaku'
program='''
package.preload['mp.utils']=function()return {parse_json=function(x)return x end}end
package.preload['mp.msg']=function()return setmetatable({},{__index=function()return function()end end})end
mp={add_hook=function()end,get_property_bool=function()return true end,get_property_native=function()return current.episodeTitle end}
options={api_server='http://fixture'}
show_message=function()end
'''+f'dofile({lua(str(source/"modules/utils.lua"))})\n'+f'local f=io.open({lua(str(source/"apis/dandanplay.lua"))});local code=f:read("*all");f:close();local match=assert(loadstring(code.."\\nreturn match_anime"))()\n'+'''
make_danmaku_request_args=function(_,url)return {url}end
parse_title=function()return current.title,current.season,current.number end
get_api_server_list=function()local seen,r={},{};for _,w in ipairs(current.works)do if not seen[w._server]then seen[w._server]=true;r[#r+1]=w._server end end;return r end
parallel_requests=function(servers,build,each,final)
 for _,server in ipairs(servers)do local url=build(server)[1];local body
 if url:find('/search/anime',1,true)then local animes={};for _,w in ipairs(current.works)do if w._server==server then animes[#animes+1]=w end end;body={animes=animes}
 else local id=url:match('/bangumi/(.+)$');for _,w in ipairs(current.works)do if w._server==server and w.bangumiId==id then body={bangumi={episodes=w.episodes,titles=w.titles}}end end end
 each(server,nil,body)
 end
 if final then final()end
end
set_episode_id=function(id,_,server)selected=server..'/'..tostring(id)end
'''+f'local cases={lua(cases)}\n'+'''for _,c in ipairs(cases)do current=c;DANMAKU={};selected='';match();print(c.name..'\t'..selected)end
'''
result=subprocess.check_output(['/opt/homebrew/bin/luajit','-'],input=program,text=True)
expected=dict(line.split('\t',1) for line in result.splitlines())
for case in cases:
 case['expected']=expected[case['name']]
 if 'required' in case:assert case['expected']==case['required'], (case['name'],case['expected'],case['required'])
path=ROOT/'apple/Core/Tests/AppleCoreTests/Fixtures/pc-danmaku.json'
path.write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n')
print(result,end='')
# Execute the actual PC header builder; store only digests, never credentials.
header_program=f'''
package.path={lua(str(source/'?.lua'))}..';'..package.path
package.preload['mp.utils']=function()return {{}}end
package.preload['mp.msg']=function()return {{}}end
mp={{add_hook=function()end}}
options={{user_agent='mpv_danmaku/1.0',proxy=''}}
AES=require('modules/aes');Base64=require('modules/base64');Sha256=require('modules/hash')
dofile({lua(str(source/'modules/utils.lua'))})
KEY={{}};for i=0,31 do KEY[i+1]=i end;KEY=table_to_zero_indexed(KEY)
resolve_managed_api_url=function(x)return x end
mapping_rate_limit_message=function()return nil end
os.time=function()return 1800000000 end
dofile({lua(str(source/'apis/dandanplay.lua'))})
for _,url in ipairs({lua(['https://api.dandanplay.net/api/v2/search/anime?keyword=test','https://api.dandanplay.net/api/v2/comment/11?withRelated=true&chConvert=0'])}) do
 local args=make_danmaku_request_args('GET',url);local headers={{}}
 for i=1,#args do if args[i]=='-H' and args[i+1]:find('^X%-') then headers[#headers+1]=args[i+1]end end
 table.sort(headers);print(Sha256(table.concat(headers,'\\n')))
end
'''
checks=subprocess.check_output(['/opt/homebrew/bin/luajit','-'],input=header_program,text=True).splitlines()
(ROOT/'apple/Core/Tests/AppleCoreTests/Fixtures/pc-danmaku-signing.json').write_text(json.dumps(checks)+'\n')
print('PC signing fingerprints generated:',len(checks))
