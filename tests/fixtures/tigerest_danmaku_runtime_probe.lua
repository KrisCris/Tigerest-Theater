-- Run the real Lua entry points with a deterministic mpv event loop. Network,
-- OSD submission and media properties are the only substituted boundaries.
local original_mp = mp
local fixture = debug.getinfo(1, 'S').source:sub(2):match('^(.*)[/\\]')
local root = fixture .. '/../../resources/mpv/plugins/uosc_danmaku/'

local function sandbox(integration)
    local env = setmetatable({}, {__index = _G})
    env._G = env
    local props = {pause = false, ['time-pos'] = 10, ['display-fps'] = 120,
        ['osd-width'] = 1920, ['osd-height'] = 1080, vf = {}, speed = 1,
        path = 'https://example.test/video.mkv', ['filename/no-ext'] = 'video',
        ['current-tracks/video'] = {}, duration = 1200, ['container-fps'] = 24}
    local events, observers, messages, timers, overlays, requests, request_args = {}, {}, {}, {}, {}, {}, {}
    local now, visible = 0, true
    local api = {msg = original_mp.msg}
    local function load_script(name)
        local fn, err
        if setfenv then fn, err = loadfile(root .. name); if fn then setfenv(fn, env) end
        else fn, err = loadfile(root .. name, 't', env) end
        assert(fn, err)
        return fn()
    end
    function api.get_property_native(name, fallback)
        if props[name] == nil then return fallback end
        return props[name]
    end
    api.get_property = api.get_property_native
    api.get_property_number = api.get_property_native
    api.get_property_bool = api.get_property_native
    function api.set_property_native(name, value) props[name] = value; return true end
    api.set_property = api.set_property_native
    api.set_property_bool = api.set_property_native
    function api.get_time() return now end
    function api.get_script_name() return 'uosc_danmaku' end
    function api.commandv() end
    function api.command_native(args) return args[2] end
    function api.command_native_async(args, callback)
        requests[#requests + 1] = callback
        request_args[#requests] = args.args
        return #requests
    end
    function api.abort_async_command() end
    function api.register_event(name, fn)
        events[name] = events[name] or {}; table.insert(events[name], fn)
    end
    function api.add_hook(name, _, fn) api.register_event(name, fn) end
    function api.register_script_message(name, fn) messages[name] = fn end
    function api.add_key_binding() end
    function api.observe_property(name, _, fn)
        observers[name] = observers[name] or {}; table.insert(observers[name], fn)
    end
    function api.unobserve_property(fn)
        for _, list in pairs(observers) do
            for i = #list, 1, -1 do if list[i] == fn then table.remove(list, i) end end
        end
    end
    function api.add_timeout(timeout, fn, disabled)
        local timer = {timeout = timeout, callback = fn, enabled = not disabled, due = now + timeout}
        function timer:kill() self.enabled = false end
        function timer:resume() self.enabled = true; self.due = now + self.timeout end
        function timer:is_enabled() return self.enabled end
        timers[#timers + 1] = timer
        return timer
    end
    function api.add_periodic_timer(timeout, fn)
        local timer = api.add_timeout(timeout, fn)
        timer.periodic = true
        return timer
    end
    function api.create_osd_overlay()
        local overlay = {updates = 0}
        function overlay:update() self.updates = self.updates + 1; self.removed = false end
        function overlay:remove() self.removed = true end
        overlays[#overlays + 1] = overlay
        return overlay
    end
    env.mp = api
    env.require = function(name)
        if name == 'mp.msg' then return original_mp.msg end
        if name == 'mp.utils' then return require('mp.utils') end
        if name == 'mp.options' then return {read_options = function() end} end
        if name == 'modules/utils' or name == 'modules/options'
            or (integration and (name == 'modules/parse' or name == 'modules/guess'
                or name == 'modules/render' or name == 'apis/dandanplay')) then
            return load_script(name .. '.lua')
        end
        return {}
    end
    load_script('main.lua')
    if not integration then
        env.get_danmaku_visibility = function() return visible end
        env.set_danmaku_visibility = function(value) visible = value end
    end
    env.toggle_danmaku_switch = function() end
    local restore_sources = env.read_danmaku_source_record
    env.read_danmaku_source_record = function() end
    env.show_message = function() end
    if not integration then env.show_loaded = function() end end
    env.file_exists = function() return false end
    env.save_danmaku = function() end
    local state = {env = env, props = props, overlays = overlays, requests = requests,
        messages = messages, restore_sources = restore_sources, request_args = request_args}
    function state.emit(name)
        for _, fn in ipairs(events[name] or {}) do fn({}) end
    end
    function state.set(name, value)
        props[name] = value
        local copy = {}; for _, fn in ipairs(observers[name] or {}) do copy[#copy + 1] = fn end
        for _, fn in ipairs(copy) do fn(name, value) end
    end
    function state.advance(seconds, wake_delay)
        local finish = now + seconds
        for _ = 1, 10000 do
            local next_timer
            for _, timer in ipairs(timers) do
                if timer.enabled and timer.due <= finish and (not next_timer or timer.due < next_timer.due) then
                    next_timer = timer
                end
            end
            if not next_timer then break end
            now = next_timer.due + (wake_delay or 0)
            if now > finish then break end
            next_timer.enabled = next_timer.periodic or false
            next_timer.due = now + next_timer.timeout
            next_timer.callback()
        end
        now = finish
    end
    function state.start_render()
        load_script('modules/render.lua')
        env.ENABLED = true
        env.COMMENTS = {{start_time = 0, end_time = 30, move = {1920, 50, -1920, 50},
            text = '{\\move(1920,50,-1920,50)}test'}}
        for _, name in ipairs({'osd-width', 'osd-height', 'pause', 'display-fps'}) do state.set(name, props[name]) end
        env.show_danmaku_func()
        state.set('time-pos', 10)
    end
    function state.respond(index, data)
        assert(requests[index], 'Expected HTTP request ' .. index)
        requests[index](true, {status = 0, stdout = require('mp.utils').format_json(data)})
        state.advance(0.1)
    end
    if integration then
        local history
        env.read_file = function() return history end
        env.write_json_file = function(_, value) history = require('mp.utils').format_json(value) end
        function state.set_history(value) history = value and require('mp.utils').format_json(value) end
        function state.history() return history and require('mp.utils').parse_json(history) end
        props['user-data/tigerest/emby/valid'] = true
        props['user-data/tigerest/emby/series-name'] = 'Fixture series'
        props['user-data/tigerest/emby/season-number'] = 1
        props['user-data/tigerest/emby/episode-number'] = 3
        props['media-title'] = 'Fixture series S01E03'
    end
    return state
end

local cases = {}
function cases.fresh_profile_autoloads_through_comment_rendering()
    local s = sandbox(true)
    s.emit('file-loaded')
    assert(#s.requests == 1, 'A fresh profile must start matching on file-loaded without a manual toggle')
    assert(s.request_args[1][#s.request_args[1]]:find('/search/anime?', 1, true), 'Expected anime search')
    s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
    s.respond(2, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = 'Episode three', episodeId = 420003}}}})
    assert(s.request_args[3][#s.request_args[3]]:find('/comment/420003?', 1, true), 'Must fetch the identified episode')
    s.respond(3, {count = 1, comments = {{p = '10,1,16777215', m = 'Fixture comment'}}})
    s.set('time-pos', 10); s.advance(0.05)
    assert(s.props['user-data/uosc_danmaku/has-danmaku'], 'Automatically fetched comments must become visible')
    assert(s.props['user-data/uosc_danmaku/danmaku-count'] == 1, 'Count must reach the player controls')
    assert(s.env.COMMENTS and #s.env.COMMENTS == 1, 'Response must pass through the actual comment parser')
    assert(s.history().show_danmaku == true, 'Fresh profile must retain its enabled preference')
end
function cases.explicit_off_is_preserved()
    local s = sandbox(true)
    s.set_history({show_danmaku = false})
    s.emit('file-loaded'); s.advance(1)
    assert(#s.requests == 0 and not s.env.ENABLED, 'Explicitly disabled danmaku must not issue requests')
    assert(s.history().show_danmaku == false, 'Explicitly disabled preference must survive loading')
end
function cases.premiere_date_resolves_remake_and_split_episode_numbers()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/series-name'] = '乱马½'
    s.props['user-data/tigerest/emby/episode-number'] = 25
    s.props['user-data/tigerest/emby/episode-name'] = '修行与大餐'
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-10-04T00:00:00.0000000Z'
    s.emit('file-loaded')
    s.respond(1, {animes = {
        {type = 'tvseries', animeTitle = '乱马1/2', bangumiId = '4576'},
        {type = 'tvseries', animeTitle = '乱马1/2 第三季', bangumiId = '19972'},
    }})
    s.respond(2, {bangumi = {episodes = {
        {episodeNumber = '1', episodeTitle = '第1话 从中国来的那个家伙', episodeId = 45760001, airDate = '1989-04-15T00:00:00'},
    }}})
    assert(s.request_args[3] and s.request_args[3][#s.request_args[3]]:find('/bangumi/19972', 1, true),
        'A title candidate without the matching broadcast date must not end matching')
    s.respond(3, {bangumi = {episodes = {
        {episodeNumber = '1', episodeTitle = '第1话 修行DEディナー', episodeId = 199720001, airDate = '2026-10-04T00:00:00'},
    }}})
    assert(s.request_args[4] and s.request_args[4][#s.request_args[4]]:find('/comment/199720001?', 1, true),
        'The episode air date must resolve cumulative Emby E25 to the matching release E1')
    s.respond(4, {count = 1, comments = {{p = '10,1,16777215', m = 'Correct release'}}})
    assert(s.props['user-data/uosc_danmaku/has-danmaku'], 'Resolved release must automatically render')
end
function cases.unmatched_episode_is_visible_and_does_not_load_wrong_remake()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-10-04T00:00:00Z'
    local notice
    s.env.show_message = function(message) notice = message end
    s.emit('file-loaded')
    s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
    s.respond(2, {bangumi = {episodes = {
        {episodeNumber = '3', episodeTitle = 'Wrong release', episodeId = 420003, airDate = '1989-04-15T00:00:00'},
    }}})
    s.advance(1)
    assert(#s.requests == 2, 'A conflicting air date must not fetch the same-numbered wrong episode')
    assert(notice and notice ~= '', 'Unmatched episodes must report a visible result instead of silently stopping')
end
function cases.batch_release_uses_episode_number_when_titles_are_translated()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-10-04T00:00:00Z'
    s.props['user-data/tigerest/emby/episode-name'] = '第三集中文译名'
    s.emit('file-loaded')
    s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
    s.respond(2, {bangumi = {episodes = {
        {episodeNumber = '1', episodeTitle = '第1话 First episode', episodeId = 420001, airDate = '2026-10-04T00:00:00'},
        {episodeNumber = '3', episodeTitle = '第3话 A translated title', episodeId = 420003, airDate = '2026-10-04T00:00:00'},
    }}})
    assert(s.request_args[3] and s.request_args[3][#s.request_args[3]]:find('/comment/420003?', 1, true),
        'Several episodes sharing an air date must resolve to Emby E3, not the first episode returned')
end
function cases.batch_release_prefers_exact_episode_title_for_remapped_number()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-10-04T00:00:00Z'
    s.props['user-data/tigerest/emby/episode-name'] = '修行与大餐'
    s.emit('file-loaded')
    s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
    s.respond(2, {bangumi = {episodes = {
        {episodeNumber = '3', episodeTitle = '第3话 另一集', episodeId = 420003, airDate = '2026-10-04T00:00:00'},
        {episodeNumber = '1', episodeTitle = '第1话 修行与大餐', episodeId = 420001, airDate = '2026-10-04T00:00:00'},
    }}})
    assert(s.request_args[3] and s.request_args[3][#s.request_args[3]]:find('/comment/420001?', 1, true),
        'An exact normalized episode title must identify a remapped episode before relying on its number')
end
function cases.batch_release_without_title_or_number_confirmation_declines()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-10-04T00:00:00Z'
    s.props['user-data/tigerest/emby/episode-number'] = 25
    s.props['user-data/tigerest/emby/episode-name'] = '不能确认的译名'
    local notice
    s.env.show_message = function(message) notice = message end
    s.emit('file-loaded')
    s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
    s.respond(2, {bangumi = {episodes = {
        {episodeNumber = '1', episodeTitle = 'First episode', episodeId = 420001, airDate = '2026-10-04T00:00:00'},
        {episodeNumber = '2', episodeTitle = 'Second episode', episodeId = 420002, airDate = '2026-10-04T00:00:00'},
    }}})
    s.advance(1)
    assert(#s.requests == 2, 'A shared premiere date alone must not guess a cumulative episode mapping')
    assert(notice and notice ~= '', 'An ambiguous batch release must show a manual matching hint')
end
function cases.missing_episode_continues_to_supported_candidate()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/episode-name'] = 'A supported episode'
    s.emit('file-loaded')
    s.respond(1, {animes = {
        {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'},
        {type = 'tvseries', animeTitle = 'Fixture series (2024)', bangumiId = '43'},
    }})
    s.respond(2, {bangumi = {episodes = {{episodeNumber = '1', episodeTitle = 'Other episode', episodeId = 420001}}}})
    assert(s.requests[3], 'Missing numbered episode must continue searching candidates')
    s.respond(3, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 A supported episode', episodeId = 430003}}}})
    assert(s.request_args[4] and s.request_args[4][#s.request_args[4]]:find('/comment/430003?', 1, true),
        'Candidate with corroborated episode title must reach comment loading')
end
function cases.dated_episode_does_not_offset_ids_across_release_seasons()
    local s = sandbox(true)
    s.set_history({show_danmaku = true, ['Fixture series Season1'] = {
        animeTitle = 'Fixture series Third season', episodeTitle = '第1话 A later episode',
        episodeNumber = 25, episodeId = 199720001, fname = 'Fixture series S01E25',
    }})
    s.props['user-data/tigerest/emby/premiere-date'] = '2024-10-20T00:00:00Z'
    s.emit('file-loaded')
    assert(s.request_args[1] and s.request_args[1][#s.request_args[1]]:find('/search/anime?', 1, true),
        'A new dated episode must resolve its release instead of adding an offset to a prior season ID')
end
function cases.dated_stream_without_hash_does_not_trust_filename_match()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.env.MD5 = {sum = function() end}
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-10-04T00:00:00Z'
    s.emit('file-loaded')
    s.respond(1, {}) -- The stream range request did not produce a hashable file.
    assert(s.request_args[2] and s.request_args[2][#s.request_args[2]]:find('/search/anime?', 1, true),
        'A dated stream without a real content hash must validate release dates instead of trusting ambiguous filenames')
end
function cases.relay_history_keeps_source_preferences()
    local s = sandbox()
    local remote = 'http://nas.tigerest.top:18443'
    local old = 'https://danmaku-api.152468.xyz/api/v2/comment/123?withRelated=true&chConvert=0'
    local custom = 'https://custom.example/api/v2/comment/456'
    local utils = require('mp.utils')
    s.props['user-data/tigerest/danmaku/api-server'] = remote
    s.env.read_file = function() return utils.format_json({movie = {sources = {
        [old] = {from = 'api_server', blocked = true, delay_segments = {{start = 0, delay = 3}}},
        [custom] = {from = 'user_custom', blocked = true},
    }}}) end
    s.env.DANMAKU.sources = {}
    s.restore_sources('movie')
    local active = remote .. '/api/v2/comment/123?withRelated=true&chConvert=0'
    assert(s.env.DANMAKU.sources[old] == nil, 'Stale history source was retained')
    local restored = s.env.DANMAKU.sources[active]
    assert(restored and restored.blocked and restored.from_history, 'History lost blocked state')
    assert(restored.delay_segments[1].delay == 3, 'History lost timing correction')
    assert(s.env.DANMAKU.sources[custom].blocked, 'Custom source was overwritten')
end
function cases.late_media_properties()
    local s = sandbox()
    local calls = 0; s.env.init = function() calls = calls + 1 end
    s.props['current-tracks/video'], s.props.duration, s.props['container-fps'] = nil, 0, 0
    s.emit('file-loaded')
    assert(s.env.ENABLED, 'Saved enabled state must survive incomplete file-loaded properties')
    s.set('current-tracks/video', {}); s.set('duration', 1200)
    s.emit('playback-restart'); s.advance(1)
    assert(calls == 1, 'Ready stream must initialize once without toggling; got ' .. calls)
    s.emit('playback-restart'); s.advance(1)
    assert(calls == 1, 'Repeated restart must not duplicate loading')
end
function cases.unknown_fps()
    local s = sandbox()
    local calls = 0; s.env.init = function() calls = calls + 1 end
    s.props['container-fps'] = 0
    s.emit('file-loaded'); s.advance(1)
    assert(calls == 1, 'Missing container FPS must not block an otherwise ready video')
end
function cases.display_animation()
    local s = sandbox(); s.start_render()
    local data, count = s.overlays[1].data, s.overlays[1].updates
    s.advance(0.03)
    assert(s.overlays[1].data ~= data, 'Danmaku must move between 24fps video timestamps')
    assert(s.overlays[1].updates - count >= 3, '120Hz display needs multiple updates within a video frame')
    s.set('pause', true); count = s.overlays[1].updates
    s.advance(0.1); assert(s.overlays[1].updates == count, 'Pause must stop animation work')
    s.set('time-pos', 20)
    assert(s.overlays[1].data ~= data, 'Seek while paused must redraw at its new position')
    s.set('pause', false); s.set('paused-for-cache', true)
    count = s.overlays[1].updates; s.advance(0.1)
    assert(s.overlays[1].updates == count, 'Buffering must stop animation work')
    s.set('paused-for-cache', false); s.env.hide_danmaku_func()
    count = s.overlays[1].updates; s.advance(0.1)
    assert(s.overlays[1].updates == count and s.overlays[1].removed, 'Hidden danmaku must stay hidden')
end
function cases.audio_clock_keeps_display_rate_danmaku()
    local s = sandbox(); s.props['video-sync'] = 'audio'; s.start_render()
    assert(s.props['video-sync'] == 'display-vdrop', 'Visible danmaku needs refresh-driven presentation even with audio timing')
    s.env.hide_danmaku_func()
    assert(s.props['video-sync'] == 'audio', 'Hiding danmaku must restore the original audio mode')
    s.env.show_danmaku_func()
    s.set('video-sync', 'display-resample')
    s.env.hide_danmaku_func()
    assert(s.props['video-sync'] == 'display-resample', 'A newer user synchronization choice must survive hiding')
    s.set('video-sync', 'audio'); s.env.show_danmaku_func(); s.emit('on_unload')
    assert(s.props['video-sync'] == 'audio', 'End of file must release the temporary presentation mode')
end
function cases.display_clock_is_preserved()
    for _, mode in ipairs({'display-resample', 'display-vdrop', 'display-adrop'}) do
        local s = sandbox(); s.props['video-sync'] = mode; s.start_render()
        assert(s.props['video-sync'] == mode, 'Visible danmaku must preserve display-driven clock choices')
        s.env.hide_danmaku_func()
        assert(s.props['video-sync'] == mode, 'Hiding danmaku cannot change an unowned mode')
    end
end
function cases.stale_requests()
    local s = sandbox()
    local called = false
    s.env.call_cmd_async({'test'}, function() called = true end)
    s.emit('on_unload'); s.emit('start-file')
    assert(not s.env.is_async_running(), 'Previous file requests must not block next file initialization')
    s.env.call_cmd_async({'next'}, function() end)
    s.requests[1](true, {status = 0, stdout = '{}'})
    assert(not called, 'A previous episode response must not write to the current episode')
    assert(s.env.is_async_running(), 'Stale callback must not decrement current request count')
end
function cases.measured_fps_jitter()
    local s = sandbox(); s.start_render()
    local count = s.overlays[1].updates
    for i = 1, 20 do
        s.advance(0.004)
        s.set('estimated-display-fps', 119 + i / 100)
    end
    assert(s.overlays[1].updates - count >= 9, 'Measured FPS noise must not cancel display timer ticks')
    s.set('display-fps', 60)
    count = s.overlays[1].updates; s.advance(0.05)
    assert(s.overlays[1].updates - count >= 2 and s.overlays[1].updates - count <= 3,
        'Moving to a 60Hz display must update the rendering cadence')
end
function cases.timer_wakeup_drift()
    local s = sandbox(); s.start_render()
    local count = s.overlays[1].updates
    s.advance(1, 0.001)
    assert(s.overlays[1].updates - count >= 119,
        'Small wakeup delays must not accumulate and turn 120Hz into roughly 107Hz')
end
function cases.timestamp_jitter()
    local s = sandbox(); s.start_render()
    s.advance(0.07)
    local x = tonumber(s.overlays[1].data:match('\\pos%(([-%d%.]+),'))
    s.set('time-pos', 10 + 1 / 24)
    s.advance(0.01)
    local next_x = tonumber(s.overlays[1].data:match('\\pos%(([-%d%.]+),'))
    assert(next_x < x, 'A late video timestamp must not move rolling comments backwards')
end
function cases.cancelled_parallel_requests()
    local s = sandbox()
    local callbacks = 0
    s.env.parallel_requests({'test'}, function() return {'test'} end,
        function() callbacks = callbacks + 1 end, function() callbacks = callbacks + 1 end,
        {per_request_timeout = 0.1})
    s.emit('on_unload'); s.advance(0.2)
    assert(callbacks == 0, 'Unloaded request timeout must not trigger fallback on the next file')
end
function cases.disabled_file_restores_history()
    local s = sandbox()
    local restored = 0
    s.env.get_danmaku_visibility = function() return false end
    s.env.read_danmaku_source_record = function() restored = restored + 1 end
    s.emit('file-loaded')
    assert(restored == 1, 'Custom sources and delays must restore even when starting with danmaku off')
end
function cases.early_manual_enable()
    local s = sandbox()
    s.props['current-tracks/video'], s.props.duration = nil, 0
    local calls = 0
    s.env.init = function()
        assert(s.props['current-tracks/video'] and s.props.duration > 0, 'Manual enable must await ready media')
        calls = calls + 1
    end
    s.messages.show_danmaku_keyboard()
    s.set('current-tracks/video', {}); s.set('duration', 1200); s.advance(1)
    assert(calls == 1, 'Manual early enable must initialize once metadata arrives')
end

original_mp.register_script_message('tigerest-danmaku-runtime-probe', function()
    local failures = {}
    for name, test in pairs(cases) do
        local ok, err = pcall(test)
        if not ok then failures[#failures + 1] = name .. ': ' .. tostring(err) end
    end
    original_mp.set_property('user-data/tigerest-test/error', table.concat(failures, '\n'))
    original_mp.set_property_bool('user-data/tigerest-test/done', true)
end)
