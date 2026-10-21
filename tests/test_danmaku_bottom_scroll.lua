-- Drive uosc_danmaku's ASS conversion with stubs: bottom (type 4) must scroll.
local root = arg[1]
package.path = root .. '/?.lua;' .. root .. '/modules/?.lua;' .. package.path
local noop = function() end
package.preload['mp.msg'] = function() return {info=noop, verbose=noop, warn=noop, error=noop, debug=noop} end
package.preload['mp.utils'] = function() return setmetatable({}, {__index=function() return function() return nil end end}) end
mp = setmetatable({}, {__index=function() return function() return nil end end})
local mp_fields = {get_property=function() return nil end, get_property_number=function() return nil end, get_property_native=function() return nil end,
      register_event=noop, observe_property=noop, add_key_binding=noop, register_script_message=noop, command_native=function() return '/nonexistent/blacklist' end, get_script_directory=function() return root end}
for k, v in pairs(mp_fields) do rawset(mp, k, v) end
options = {fontsize=50, scrolltime=15, fixtime=5, max_screen_danmaku=0, merge_tolerance=-1, merge_without_style=false, displayarea=1.0,
           chConvert=0, blacklist_path='', bold=false, outline=1, shadow=0, opacity=0.7}
show_message = noop
dofile(root .. '/modules/utils.lua')
dofile(root .. '/modules/parse.lua')
DANMAKU = {sources = {['fixture'] = {data = {
  {time=10, type=4, color=0xffffff, text='bottom'},
  {time=10, type=5, color=0xffffff, text='top'},
  {time=10, type=1, color=0xffffff, text='scroll'},
}}}}
convert_danmaku_to_ass_events(true)
assert(type(COMMENTS) == 'table' and #COMMENTS == 3, 'three events, got ' .. tostring(COMMENTS and #COMMENTS))
local by = {}
for _, e in ipairs(COMMENTS) do by[e.clean_text] = e end
assert(by.bottom.style == 'R2L' and by.bottom.move ~= nil, 'bottom scrolls: ' .. tostring(by.bottom.style))
assert(by.bottom.end_time - by.bottom.start_time == 15, 'bottom uses the scroll time')
assert(by.bottom.move[2] < 1080 * 0.2, 'bottom takes an upper scrolling lane, y=' .. tostring(by.bottom.move[2]))
assert(by.top.style == 'TOP' and by.top.pos ~= nil, 'top stays fixed')
assert(by.scroll.style == 'R2L')
print('PASS bottom danmaku scroll in the upper lanes; top stays fixed')
