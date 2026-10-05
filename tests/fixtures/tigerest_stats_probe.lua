-- Exercise the shipped stats script inside libmpv; only read-only video metrics
-- and OSD output are controlled, so this also checks mpv's Lua API compatibility.
local mp = require 'mp'
local source = debug.getinfo(1, 'S').source:gsub('^@', '')
local fixture_dir = source:match('^(.*)[/\\]') or '.'
local bindings, output = {}, ''
local props = {
    ['current-vo'] = 'gpu-next',
    ['vo-configured'] = true,
    ['video-osd'] = true,
    ['osd-dimensions'] = {w=1920, h=1080, ml=0, mr=0, mt=0, mb=0},
    ['display-fps'] = '120.000',
    ['estimated-display-fps'] = '119.999',
    ['display-sync-active'] = false,
    ['video-sync'] = 'audio',
    ['filename'] = 'fixture.mkv',
    ['media-title'] = 'fixture.mkv',
    ['decoder-frame-drop-count'] = '3',
    ['frame-drop-count'] = '7',
    ['vsync-jitter'] = '0.125',
    ['vsync-ratio'] = '1.0',
    ['vo-passes'] = {fresh={{desc='fixture shader pass', last=1200000,
        avg=800000, peak=2000000, samples={800000, 1200000}, count=2}}},
}
local rife_data = '{"factor":2,"model_path":"rife-v4.26","engine_path":"C:/private/rife/engine.plan","runtime_path":"C:/private/runtime"}'
local original_native, original_osd = mp.get_property_native, mp.get_property_osd
local original_bool, original_binding = mp.get_property_bool, mp.add_key_binding
mp.get_property_native = function(name, default)
    if props[name] ~= nil then return props[name] end
    return original_native(name, default)
end
mp.get_property_osd = function(name, default)
    if props[name] ~= nil and type(props[name]) ~= 'table' then return tostring(props[name]) end
    return original_osd(name, default)
end
mp.get_property_bool = function(name, default)
    if props[name] ~= nil then return props[name] end
    return original_bool(name, default)
end
mp.add_key_binding = function(key, name, callback, opts)
    bindings[name] = callback
    return original_binding(key, name, callback, opts)
end
mp.osd_message = function(text) output = text end

local loaded, load_error = pcall(dofile, fixture_dir .. '/../../resources/mpv/plugins/stats.lua')
mp.register_script_message('tigerest-stats-probe', function(scenario)
    local ok, err = pcall(function()
        assert(loaded, load_error)
        props['display-sync-active'] = scenario == 'display'
        props['video-sync'] = scenario == 'display' and 'display-resample' or 'audio'
        props['decoder-frame-drop-count'] = scenario == 'output-only' and '' or '3'
        if scenario == 'rife' or scenario == 'rife-path-model'
            or scenario == 'rife-invalid' or scenario == 'other-filter' then
            props['video-params'] = {w=1920, h=1080, pixelformat='yuv420p',
                colormatrix='bt.709', primaries='bt.709', gamma='bt.1886'}
            local data = scenario == 'rife-invalid' and '{broken-json' or rife_data
            if scenario == 'rife-path-model' then
                data = '{"factor":2,"model_path":"C:\\\\private\\\\models\\\\rife-v4.26\\\\"}'
            end
            props['vf'] = {{name='vapoursynth', enabled=true,
                label=scenario == 'other-filter' and 'custom-vs' or 'tigerest-rife',
                params={file='C:/private/rife/interpolate.vpy',
                        ['user-data']=data}}}
        end
        local name = scenario == 'detail' and 'display-page-2'
            or scenario == 'help' and 'display-page-6' or 'display-page-1'
        assert(bindings[name], 'missing page binding: ' .. name)
        output = ''
        bindings[name]()
        assert(output ~= '', 'page did not render')
        mp.set_property('user-data/tigerest-stats-test/output', output)
        if props['vf'] then
            mp.set_property_native('user-data/tigerest-stats-test/filters', props['vf'])
        end
    end)
    mp.set_property('user-data/tigerest-stats-test/error', ok and '' or tostring(err))
    mp.set_property_bool('user-data/tigerest-stats-test/done', true)
end)
mp.set_property_bool('user-data/tigerest-stats-test/ready', true)
