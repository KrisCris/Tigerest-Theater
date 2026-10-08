-- Run the real Lua entry points with a deterministic mpv event loop. Network,
-- OSD submission and media properties are the only substituted boundaries.
local original_mp = mp
local unpack = unpack or table.unpack
local fixture = debug.getinfo(1, 'S').source:sub(2):match('^(.*)[/\\]')
local root = fixture .. '/../../resources/mpv/plugins/uosc_danmaku/'

local function sandbox(integration, mapping)
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
        if name == 'modules/utils' or name == 'modules/options' or name == 'modules/mapping'
            or (mapping and name == 'modules/menu')
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
        -- Existing matcher regressions explicitly exercise third-party legacy APIs.
        if not mapping then env.options.api_server = 'http://legacy.example.test' end
    end
    return state
end

local cases = {}
local function mapping_reply(s, index, origin, episode, text)
    s.requests[index](true, {status=0, stdout='HTTP/1.1 200 OK\r\n\r\n' .. require('mp.utils').format_json({
        success=true, matched=true, match={origin=origin, bangumiId='tmdb-55', episodeId=episode,
            animeTitle='Chosen work', episodeTitle=text}, danmaku={count=1, comments={{p='10,1,16777215',m=text}}}})})
end
function cases.manual_selection_wins_over_delayed_shared_hit()
    local s = sandbox(true, true)
    s.emit('file-loaded')
    s.props['user-data/tigerest/danmaku/mapping-auth-file'] = '/private/header'
    s.env.io = setmetatable({open=function() return {read=function() return 'Authorization: Bearer fixture-token\n' end,close=function() end} end},{__index=io})
    s.env.set_episode_id('55555',true,'http://nas.tigerest.top:18443','tmdb-55',s.env.mapping_playback_token())
    mapping_reply(s,2,'manual','55555','MANUAL_CHOICE')
    mapping_reply(s,1,'shared','11111','DELAYED_AUTO')
    assert(s.env.DANMAKU.episode == 'MANUAL_CHOICE' and s.env.DANMAKU.mapping_origin == 'manual',
        'A delayed auto lookup for the same file must not replace an explicit selection')
end
function cases.manual_selection_prevents_delayed_lookup_fallback()
    local s = sandbox(true, true)
    s.emit('file-loaded')
    s.props['user-data/tigerest/danmaku/mapping-auth-file'] = '/private/header'
    s.env.io = setmetatable({open=function() return {read=function() return 'Authorization: Bearer fixture-token\n' end,close=function() end} end},{__index=io})
    s.env.set_episode_id('55555',true,'http://nas.tigerest.top:18443','tmdb-55',s.env.mapping_playback_token())
    mapping_reply(s,2,'manual','55555','MANUAL_CHOICE')
    s.requests[1](true,{status=0,stdout='HTTP/1.1 200 OK\r\n\r\n{"success":true,"matched":false}'})
    assert(#s.requests == 2,'An old lookup miss must not start a legacy chain after manual selection')
end
function cases.manual_selection_cancels_existing_legacy_chain()
    local s = sandbox(true, true)
    s.emit('file-loaded')
    s.requests[1](true,{status=0,stdout='HTTP/1.1 200 OK\r\n\r\n{"success":true,"matched":false}'})
    assert(#s.requests == 2,'Expected pending legacy anime lookup')
    s.props['user-data/tigerest/danmaku/mapping-auth-file'] = '/private/header'
    s.env.io = setmetatable({open=function() return {read=function() return 'Authorization: Bearer fixture-token\n' end,close=function() end} end},{__index=io})
    s.env.set_episode_id('55555',true,'http://nas.tigerest.top:18443','tmdb-55',s.env.mapping_playback_token())
    mapping_reply(s,3,'manual','55555','MANUAL_CHOICE')
    s.respond(2,{animes={{type='tvseries',animeTitle='Fixture series',bangumiId='42'}}})
    assert(#s.requests == 3,'Pending legacy matching must not resume after an explicit choice')
    assert(s.env.DANMAKU.episode == 'MANUAL_CHOICE','The existing legacy chain must preserve the manual choice')
end
function cases.anime_search_selection_keeps_original_playback_identity()
    local s = sandbox(true,true)
    s.env.uosc_available = true
    s.env.update_menu_uosc = function(_,_,items) return require('mp.utils').format_json({items=items}) end
    s.env.get_animes('Fixture series')
    s.respond(1,{animes={{animeTitle='Work A catalog',bangumiId='tmdb-11'}}})
    local menu = require('mp.utils').parse_json(s.env.latest_menu_anime)
    local row = menu.items[1].value
    s.emit('on_unload')
    s.props.path = 'https://example.test/replacement.mkv'
    s.props['user-data/tigerest/emby/series-name'] = 'Work B'
    s.messages['search-episodes-event'](unpack(row,4))
    assert(#s.requests == 1,'A cached anime selection from work A must not fetch or calibrate against work B')
    assert(s.env.latest_menu_anime == nil or s.env.latest_menu_anime == '' or #s.env.latest_menu_anime == 0,
        'Unload must invalidate cached anime menus')
end
function cases.shared_lookup_precedes_local_history_and_uses_complete_response()
    local s = sandbox(true, true)
    s.set_history({show_danmaku = true, ['Fixture series Season1'] = {
        fname = 'Fixture series S01E03', episodeNumber = 3, episodeId = 123,
        animeTitle = 'Wrong previous title', episodeTitle = 'Wrong previous episode'}})
    s.emit('file-loaded')
    local args = s.request_args[1]
    assert(args and args[#args] == 'http://nas.tigerest.top:18443/api/tigerest/v1/danmaku',
        'Every playback must look up shared mapping before reusing history')
    local body
    for i, value in ipairs(args) do if value == '--data-binary' then body = require('mp.utils').parse_json(args[i + 1]) end end
    assert(body and body.source.title == 'Fixture series' and body.source.season == 1 and body.source.episode == 3,
        'Lookup must retain exact original metadata identity')
    assert(not body.selection, 'Automatic lookup cannot calibrate')
    s.requests[1](true, {status = 0, stdout = 'HTTP/1.1 200 OK\r\n\r\n' .. require('mp.utils').format_json({
        success = true, matched = true, match = {origin = 'shared', bangumiId = 'tmdb-42',
            episodeId = '999999999', animeTitle = 'Catalog title', episodeTitle = 'Catalog episode'},
        danmaku = {count = 1, comments = {{p = '10,1,16777215', m = 'Shared response'}}}})})
    assert(#s.requests == 1 and s.env.COMMENTS and #s.env.COMMENTS == 1,
        'A shared hit must load the full response without another GET or history matching')
    assert(s.env.DANMAKU.mapping_origin == 'shared', 'Shared provenance must remain visible')
end
function cases.shared_lookup_miss_falls_back_and_stale_response_is_discarded()
    local s = sandbox(true, true)
    s.emit('file-loaded')
    assert(s.request_args[1][#s.request_args[1]]:find('/api/tigerest/v1/danmaku', 1, true), 'Expected shared lookup')
    s.requests[1](true, {status = 0, stdout = 'HTTP/1.1 200 OK\r\n\r\n{"success":true,"matched":false,"reason":"no-mapping"}'})
    assert(s.request_args[2][#s.request_args[2]]:find('/search/anime?', 1, true), 'A mapping miss must retain legacy matching')
    local stale = sandbox(true, true)
    stale.emit('file-loaded'); stale.emit('on_unload')
    stale.props['user-data/tigerest/emby/episode-number'] = 4
    stale.requests[1](true, {status = 0, stdout = 'HTTP/1.1 200 OK\r\n\r\n{"success":true,"matched":false}'})
    assert(#stale.requests == 1 and stale.env.COMMENTS == nil, 'Stale lookup must neither load nor start fallback for replacement media')
end
local function mapping_header(s)
    s.props['user-data/tigerest/danmaku/mapping-auth-file'] = '/private/fixture-header'
    s.env.io = setmetatable({open = function(path)
        assert(path == '/private/fixture-header', 'Only the private header may be opened')
        return {read=function() return 'Authorization: Bearer fixture-private-token\n' end, close=function() end}
    end}, {__index=io})
end
function cases.explicit_selection_uses_original_identity_and_private_header_reference()
    local s = sandbox(true, true); mapping_header(s)
    s.env.DANMAKU.anime, s.env.DANMAKU.episode = 'Selected catalog title', 'Catalog E5'
    s.env.set_episode_id('99000005', true, 'http://nas.tigerest.top:18443', 'tmdb-99', s.env.mapping_playback_token())
    local args, body = s.request_args[1]
    for i, value in ipairs(args) do
        assert(not value:find('fixture-private-token', 1, true), 'Credential cannot appear in subprocess arguments')
        if value == '--data-binary' then body = require('mp.utils').parse_json(args[i + 1]) end
    end
    assert(body.source.title == 'Fixture series' and body.source.episode == 3 and body.source.season == 1,
        'Manual selection must preserve the original source, even when selected catalog numbering differs')
    assert(body.selection.bangumiId == 'tmdb-99' and body.selection.episodeId == '99000005', 'Both selected IDs must travel unchanged')
    local header = false; for _, value in ipairs(args) do if value == '@/private/fixture-header' then header = true end end
    assert(header, 'curl receives only a reference to the private header')
    s.requests[1](true, {status=0, stdout='HTTP/1.1 200 OK\r\n\r\n' .. require('mp.utils').format_json({success=true,matched=true,
        match={origin='manual',episodeId='99000005',bangumiId='tmdb-99',animeTitle='Selected catalog title',episodeTitle='Catalog E5'},
        danmaku={count=1,comments={{p='10,1,16777215',m='Manual response'}}}})})
    assert(#s.requests == 1 and #s.env.COMMENTS == 1 and s.env.DANMAKU.mapping_origin == 'manual',
        'Successful manual POST replaces the GET entirely')
end
function cases.manual_post_failure_loads_exact_chosen_id_and_reports_unsaved_mapping()
    local s = sandbox(true, true); mapping_header(s)
    local notice
    s.env.show_message = function(value) notice = value end
    s.env.set_episode_id('99000005', true, 'http://nas.tigerest.top:18443', 'tmdb-99', s.env.mapping_playback_token())
    s.requests[1](true, {status=0, stdout='HTTP/1.1 503 Busy\r\n\r\n{"success":false}'})
    assert(s.request_args[2][#s.request_args[2]]:find('/comment/99000005?',1,true), 'Failure must fetch the chosen episode without ID arithmetic')
    s.respond(2,{count=1,comments={{p='10,1,16777215',m='Legacy fallback'}}})
    assert(notice == '弹幕已加载，但共享匹配未保存', 'Fallback must not imply that calibration was saved')
end
function cases.no_token_third_party_unknown_season_and_stale_manual_are_legacy_only()
    local no_token = sandbox(true, true)
    no_token.env.set_episode_id('99000005',true,'http://nas.tigerest.top:18443','99',no_token.env.mapping_playback_token())
    assert(no_token.request_args[1][#no_token.request_args[1]]:find('/comment/99000005?',1,true), 'No token selects legacy GET')
    local third = sandbox(true, true); mapping_header(third)
    third.env.set_episode_id('99000005',true,'https://third.example.test','99',third.env.mapping_playback_token())
    assert(third.request_args[1][#third.request_args[1]]:find('https://third.example.test/api/v2/comment/',1,true), 'Third parties never receive the mapping protocol')
    for _, season in ipairs({-1,0,1.5,1001}) do
        local unknown = sandbox(true, true); unknown.props['user-data/tigerest/emby/season-number'] = season
        unknown.emit('file-loaded')
        assert(not unknown.request_args[1][#unknown.request_args[1]]:find('/tigerest/',1,true), 'Unknown seasons and specials must not be guessed')
    end
    local stale = sandbox(true,true); mapping_header(stale)
    local token = stale.env.mapping_playback_token(); stale.emit('on_unload')
    stale.env.set_episode_id('99000005',true,'http://nas.tigerest.top:18443','99',token)
    assert(#stale.requests == 0, 'Stale menu selection must never calibrate the replacement playback')
end
function cases.rate_limit_cooldown_survives_playback_change()
    local s = sandbox(true,true)
    s.emit('file-loaded')
    s.requests[1](true,{status=0,stdout='HTTP/1.1 429 Too Many Requests\r\nRetry-After: 120\r\n\r\n{"success":false}'})
    s.emit('on_unload'); s.props['user-data/tigerest/emby/episode-number'] = 4
    local count = #s.requests
    s.env.auto_load_danmaku(s.props.path,'Fixture series Season1','Fixture series S01E04',4)
    assert(#s.requests == count + 1 and not s.request_args[#s.requests][#s.request_args[#s.requests]]:find('/tigerest/',1,true),
        'A new playback during Retry-After must skip another mapping POST')
end
function cases.manual_menu_carries_catalog_and_original_generation_to_selection()
    local s = sandbox(true,true); mapping_header(s)
    s.env.uosc_available = true
    local items
    s.env.update_menu_uosc = function(_, _, value) if type(value) == 'table' then items = value end end
    s.env.get_episodes('Chosen catalog title','tmdb-99','http://nas.tigerest.top:18443',s.env.mapping_playback_token())
    s.respond(1,{bangumi={episodes={{episodeId='99000005',episodeTitle='Catalog E5',episodeNumber=5}}}})
    local event = items[2].value
    assert(event[8] == 'tmdb-99' and event[9] == s.env.mapping_playback_token(), 'Menu must preserve both catalog ID and playback identity')
    s.messages['load-danmaku'](event[4],event[5],event[6],event[7],event[8],event[9])
    assert(s.request_args[2][#s.request_args[2]]:find('/tigerest/',1,true), 'Real manual event must call calibration POST')
    s.emit('on_unload')
    s.messages['load-danmaku'](event[4],event[5],event[6],event[7],event[8],event[9])
    assert(#s.requests == 2, 'Old menu events cannot load or calibrate a replacement video')
end
function cases.rife_clock_owner_survives_comment_and_window_transitions()
    local s = sandbox()
    s.props['video-sync'] = 'audio'
    s.props['display-fps'] = 240
    s.props['estimated-vf-fps'] = 60
    s.props['user-data/tigerest/rife-clock-owned'] = true
    s.start_render()
    assert(s.props['video-sync'] == 'audio', 'RIFE audio clock must not be overwritten by danmaku')
    local before = s.overlays[1].updates
    s.advance(1)
    assert(s.overlays[1].updates - before <= 61, 'Do not submit 240 OSD updates when audio presentation consumes 60')
    assert(s.overlays[1].updates - before >= 58, 'RIFE comments must keep moving')
    s.set('video-sync', 'display-vdrop') -- An explicit display-clock owner is respected too.
    before = s.overlays[1].updates
    s.advance(1)
    assert(s.overlays[1].updates - before >= 238, 'Fullscreen retains high refresh animation')
    s.set('video-sync', 'audio')
    s.env.hide_danmaku_func(); s.env.show_danmaku_func()
    assert(s.props['video-sync'] == 'audio', 'Comment toggles cannot take over the RIFE clock')
    s.set('video-sync', 'display-resample') -- Restore before releasing ownership.
    s.set('user-data/tigerest/rife-clock-owned', false)
    assert(s.props['video-sync'] == 'display-resample', 'RIFE original preference must survive release')
    s.set('video-sync', 'audio')
    assert(s.props['video-sync'] == 'display-vdrop', 'Ordinary audio playback still gets independent comment cadence')
end

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
function cases.nearby_dates_match_a_corroborated_episode_within_one_week()
    for _, dates in ipairs({
        {'2026-07-20', '2026-07-17'}, -- The reported production failure.
        {'2026-08-03', '2026-07-27'}, -- Seven days, crossing a month.
        {'2026-12-28', '2027-01-04'}, -- Seven days in the other direction.
        {'2024-03-02', '2024-02-24'}, -- Leap-year boundary.
        {'1963-01-04', '1963-01-01'}, -- Dates before the Windows CRT epoch.
        {'1900-03-03', '1900-02-24'}, -- Century years are not always leap years.
    }) do
        local s = sandbox(true)
        s.set_history({show_danmaku = true})
        s.props['user-data/tigerest/emby/premiere-date'] = dates[1] .. 'T00:00:00Z'
        s.props['user-data/tigerest/emby/episode-name'] = '被怀疑是私生子，还要陪她去初次冒险'
        s.emit('file-loaded')
        s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
        s.respond(2, {bangumi = {episodes = {
            {episodeNumber = '4', episodeTitle = '第4话 Another episode', episodeId = 420004, airDate = dates[2]},
            {episodeNumber = '3', episodeTitle = '第3话 被怀疑是私生子 还要陪她去初次冒险', episodeId = 420003, airDate = dates[2]},
        }}})
        assert(s.request_args[3] and s.request_args[3][#s.request_args[3]]:find('/comment/420003?', 1, true),
            'A corroborated E3 within seven days must load E3 instead of the nearby E4: ' .. dates[1])
        s.respond(3, {count = 1, comments = {{p = '10,1,16777215', m = 'Matched without manual search'}}})
        assert(s.props['user-data/uosc_danmaku/has-danmaku'], 'The first automatic match must render its comments')
    end
end
function cases.nearby_dates_decline_out_of_range_or_unconfirmed_episodes()
    for _, record in ipairs({
        {date = '2026-07-12', number = '3', title = 'Confirmed episode'}, -- Eight days before.
        {date = '2026-07-28', number = '3', title = 'Confirmed episode'}, -- Eight days after.
        {date = '1989-07-17', number = '3', title = 'Confirmed episode'}, -- Old release, matching text.
        {date = '2026-07-17', number = '4', title = 'Confirmed episode'}, -- Wrong episode number.
        {date = '2026-07-17', number = '3', title = 'Unrelated story'},
        {date = '', number = '3', title = 'Confirmed episode'},
        {date = '2026-07-00', number = '3', title = 'Confirmed episode'},
    }) do
        local s = sandbox(true)
        s.set_history({show_danmaku = true})
        s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
        s.props['user-data/tigerest/emby/episode-name'] = record.expected or 'Confirmed episode'
        local notice
        s.env.show_message = function(message) notice = message end
        s.emit('file-loaded')
        s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
        s.respond(2, {bangumi = {episodes = {{episodeNumber = record.number,
            episodeTitle = '第' .. record.number .. '话 ' .. record.title, episodeId = 420003, airDate = record.date}}}})
        assert(#s.requests == 2, 'An unconfirmed or out-of-range episode must not be loaded: ' .. record.date)
        assert(notice and notice ~= '', 'Declined matching must keep the manual search hint')
    end
end
function cases.generic_episode_titles_match_unique_series_number_and_week()
    for _, expected in ipairs({'', '第8集', '第 8 集', '第8话'}) do
        for _, date in ipairs({'2026-08-21', '2026-08-16', '2026-08-30'}) do
            local s = sandbox(true)
            s.props['user-data/tigerest/emby/series-name'] = '『你们先走我断后』，于是10年后我成为了传说'
            s.props['user-data/tigerest/emby/episode-number'] = 8
            s.props['user-data/tigerest/emby/episode-name'] = expected
            s.props['user-data/tigerest/emby/premiere-date'] = '2026-08-23T16:00:00.0000000Z'
            s.emit('file-loaded')
            s.respond(1, {animes = {{type = 'tvseries',
                animeTitle = '『你们先走我断后』，于是10年后我成为了传说', bangumiId = '19635'}}})
            s.respond(2, {bangumi = {episodes = {
                {episodeNumber = '5', episodeTitle = '第5话 十年后 居然有人让我先走', episodeId = 196350005, airDate = '2026-07-31'},
                {episodeNumber = '8', episodeTitle = '第8话 时隔十年 小队重聚', episodeId = 196350008, airDate = date},
            }}})
            assert(s.request_args[3] and s.request_args[3][#s.request_args[3]]:find('/comment/196350008?', 1, true),
                'A unique E8 within seven days must load even without a real episode title: ' .. expected .. ' / ' .. date)
            s.respond(3, {count = 1, comments = {{p = '10,1,16777215', m = 'E8 automatically loaded'}}})
            assert(s.props['user-data/uosc_danmaku/has-danmaku'], 'Generic-title matching must render on the first attempt')
        end
    end
end
function cases.generic_episode_titles_still_require_correct_number_and_week()
    for _, record in ipairs({
        {date = '2026-07-12', number = '3'}, {date = '2026-07-28', number = '3'},
        {date = '2026-07-17', number = '4'}, {date = '', number = '3'},
    }) do
        local s = sandbox(true)
        s.props['user-data/tigerest/emby/episode-name'] = '第3集'
        s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20'
        s.emit('file-loaded')
        s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
        s.respond(2, {bangumi = {episodes = {{episodeNumber = record.number,
            episodeTitle = 'Actual story title', episodeId = 420003, airDate = record.date}}}})
        assert(#s.requests == 2, 'Missing episode text cannot bypass the number or date boundary')
    end
end
function cases.generic_episode_titles_require_a_confident_series_match()
    for _, another_release in ipairs({false, true}) do
        local s = sandbox(true)
        local weak_title = 'Other serial'
        local score = s.env.jaro_winkler('Fixture series', weak_title)
        assert(score >= 0.75 and score < 0.85, 'Fixture must exercise a weak but searchable series title: ' .. score)
        s.props['user-data/tigerest/emby/episode-name'] = '第3集'
        s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20'
        s.emit('file-loaded')
        local animes = {{type = 'tvseries', animeTitle = weak_title, bangumiId = '43'}}
        if another_release then table.insert(animes, 1, {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}) end
        s.respond(1, {animes = animes})
        local response = {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = 'Actual story title',
            episodeId = 420003, airDate = '2026-07-17'}}}}
        s.respond(2, response)
        if another_release then s.respond(3, response) end
        assert(#s.requests == (another_release and 3 or 2),
            'Weak series evidence must neither load on its own nor establish uniqueness for another release')
    end
end
function cases.generic_episode_titles_require_complete_unique_candidates()
    for _, conflict in ipairs({'duplicate', 'incomplete', 'failed', 'provider', 'missing-date', 'invalid-date'}) do
        local s = sandbox(true)
        s.props['user-data/tigerest/emby/episode-name'] = '第3集'
        s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20'
        if conflict == 'provider' then s.env.options.api_server = 'http://first.example.test,http://second.example.test' end
        s.emit('file-loaded')
        local anime = {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}
        local other = {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '43'}
        local episode = {episodeNumber = '3', episodeTitle = 'Actual story title', episodeId = 420003, airDate = '2026-07-17'}
        if conflict == 'provider' then
            s.respond(1, {animes = {anime}}); s.respond(2, {animes = {anime}})
            s.respond(3, {bangumi = {episodes = {episode}}}); s.respond(4, {bangumi = {episodes = {episode}}})
        else
            s.respond(1, {animes = {anime, other}})
            s.respond(2, {bangumi = {episodes = {episode}}})
            if conflict == 'duplicate' then s.respond(3, {bangumi = {episodes = {episode}}})
            elseif conflict == 'failed' then s.requests[3](false, {status = 22, stdout = ''}, 'controlled failure'); s.advance(0.1)
            elseif conflict == 'missing-date' or conflict == 'invalid-date' then
                s.respond(3, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = 'Another story title',
                    episodeId = 430003, airDate = conflict == 'missing-date' and '' or '2026-07-00'}}}})
            else s.respond(3, {}) end
        end
        assert(#s.requests == (conflict == 'provider' and 4 or 3), 'Missing episode titles must preserve ambiguity/error vetoes: ' .. conflict)
    end
    for _, record in ipairs({{}, {title = ''}, {title = false}, {title = 77}}) do
        local s = sandbox(true)
        local notice
        s.env.show_message = function(message) notice = message end
        s.props['user-data/tigerest/emby/episode-name'] = '第3集'
        s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20'
        s.emit('file-loaded')
        s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
        s.respond(2, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = record.title,
            episodeId = 420003, airDate = '2026-07-17'}}}})
        assert(#s.requests == 2 and notice and notice ~= '', 'Malformed provider titles must finish with a manual hint')
    end
end
function cases.exact_dates_take_priority_over_a_nearby_release()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
    s.props['user-data/tigerest/emby/episode-name'] = 'Confirmed episode'
    s.emit('file-loaded')
    s.respond(1, {animes = {
        {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'},
        {type = 'tvseries', animeTitle = 'Fixture series remake', bangumiId = '43'},
    }})
    s.respond(2, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
        episodeId = 420003, airDate = '2026-07-17'}}}})
    assert(s.request_args[3] and s.request_args[3][#s.request_args[3]]:find('/bangumi/43', 1, true),
        'Nearby dates must wait for other candidates to be checked for an exact date')
    s.respond(3, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
        episodeId = 430003, airDate = '2026-07-20'}}}})
    assert(s.request_args[4] and s.request_args[4][#s.request_args[4]]:find('/comment/430003?', 1, true),
        'An exact date must win even when a nearby candidate arrived first')
end
function cases.nearby_date_ambiguity_across_releases_requires_manual_selection()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
    s.props['user-data/tigerest/emby/episode-name'] = 'Confirmed episode'
    local notice
    s.env.show_message = function(message) notice = message end
    s.emit('file-loaded')
    s.respond(1, {animes = {
        {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'},
        {type = 'tvseries', animeTitle = 'Fixture series remake', bangumiId = '43'},
    }})
    s.respond(2, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
        episodeId = 420003, airDate = '2026-07-17'}}}})
    s.respond(3, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
        episodeId = 430003, airDate = '2026-07-18'}}}})
    assert(#s.requests == 3, 'Two corroborated nearby releases must not silently select either one')
    assert(notice and notice ~= '', 'Ambiguous releases must still offer manual matching')
end
function cases.nearby_date_ambiguity_within_one_release_requires_manual_selection()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
    s.props['user-data/tigerest/emby/episode-name'] = 'Confirmed episode'
    s.emit('file-loaded')
    s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
    s.respond(2, {bangumi = {episodes = {
        {episodeNumber = '3', episodeTitle = '第3话 Confirmed episode', episodeId = 420003, airDate = '2026-07-17'},
        {episodeNumber = '3', episodeTitle = '第3话 Confirmed episode', episodeId = 420033, airDate = '2026-07-18'},
    }}})
    assert(#s.requests == 2, 'Duplicate episode numbers with nearby dates must not select by response order')
end
function cases.ambiguous_exact_dates_block_a_nearby_match_in_the_same_release()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
    s.props['user-data/tigerest/emby/episode-name'] = 'Confirmed episode'
    s.emit('file-loaded')
    s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
    s.respond(2, {bangumi = {episodes = {
        {episodeNumber = '3', episodeTitle = '第3话 Confirmed episode', episodeId = 420003, airDate = '2026-07-20'},
        {episodeNumber = '3', episodeTitle = '第3话 Confirmed episode', episodeId = 420033, airDate = '2026-07-20'},
        {episodeNumber = '3', episodeTitle = '第3话 Confirmed episode', episodeId = 420333, airDate = '2026-07-17'},
    }}})
    assert(#s.requests == 2, 'A nearby episode must not override unresolved exact-date matches')
end
function cases.ambiguous_exact_release_blocks_a_later_nearby_release()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
    s.props['user-data/tigerest/emby/episode-name'] = 'Confirmed episode'
    s.emit('file-loaded')
    s.respond(1, {animes = {
        {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'},
        {type = 'tvseries', animeTitle = 'Fixture series remake', bangumiId = '43'},
    }})
    s.respond(2, {bangumi = {episodes = {
        {episodeNumber = '3', episodeTitle = '第3话 Confirmed episode', episodeId = 420003, airDate = '2026-07-20'},
        {episodeNumber = '3', episodeTitle = '第3话 Confirmed episode', episodeId = 420033, airDate = '2026-07-20'},
    }}})
    s.respond(3, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
        episodeId = 430003, airDate = '2026-07-17'}}}})
    assert(#s.requests == 3, 'Another nearby release must not override ambiguous exact-date matches')
end
function cases.incomplete_release_details_cannot_establish_a_unique_nearby_match()
    for _, failed in ipairs({true, false}) do
        local s = sandbox(true)
        s.set_history({show_danmaku = true})
        s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
        s.props['user-data/tigerest/emby/episode-name'] = 'Confirmed episode'
        s.emit('file-loaded')
        s.respond(1, {animes = {
            {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'},
            {type = 'tvseries', animeTitle = 'Fixture series remake', bangumiId = '43'},
        }})
        s.respond(2, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
            episodeId = 420003, airDate = '2026-07-17'}}}})
        if failed then s.requests[3](false, {status = 22, stdout = ''}, 'controlled request failure'); s.advance(0.1)
        else s.respond(3, {}) end
        assert(#s.requests == 3, 'Failed or invalid release details must not be treated as a ruled-out candidate')
    end
end
function cases.nearby_fallback_waits_for_all_provider_searches()
    for _, failed in ipairs({true, false}) do
        local s = sandbox(true)
        s.env.options.api_server = 'http://first.example.test,http://second.example.test'
        s.set_history({show_danmaku = true})
        s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
        s.props['user-data/tigerest/emby/episode-name'] = 'Confirmed episode'
        s.emit('file-loaded')
        assert(#s.requests == 2, 'Both configured providers must be searched')
        s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
        s.respond(3, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
            episodeId = 420003, airDate = '2026-07-17'}}}})
        assert(#s.requests == 3, 'A nearby result must wait for the slower provider')
        if failed then
            s.requests[2](false, {status = 22, stdout = ''}, 'controlled request failure'); s.advance(0.1)
            assert(#s.requests == 3, 'A failed provider leaves uniqueness unconfirmed')
        else
            s.respond(2, {animes = {}})
            assert(s.request_args[4] and s.request_args[4][#s.request_args[4]]:find('/comment/420003?', 1, true),
                'A successful empty provider response permits the single corroborated nearby result')
        end
    end
end
function cases.stalled_release_details_finish_with_a_manual_hint()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
    s.props['user-data/tigerest/emby/episode-name'] = 'Confirmed episode'
    local notice
    s.env.show_message = function(message) notice = message end
    s.emit('file-loaded')
    s.respond(1, {animes = {
        {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'},
        {type = 'tvseries', animeTitle = 'Fixture series remake', bangumiId = '43'},
    }})
    s.respond(2, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
        episodeId = 420003, airDate = '2026-07-17'}}}})
    s.advance(16)
    assert(notice and notice ~= '', 'Stalled release details must eventually offer manual matching')
    assert(#s.requests == 3, 'A timed-out release must leave nearby uniqueness unconfirmed')
    s.respond(3, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
        episodeId = 430003, airDate = '2026-07-20'}}}})
    assert(#s.requests == 3, 'A late response after the deadline must not start comment loading')
end
function cases.nearby_candidate_ids_are_scoped_to_provider_and_release()
    for _, multiple_providers in ipairs({false, true}) do
        local s = sandbox(true)
        s.set_history({show_danmaku = true})
        s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
        s.props['user-data/tigerest/emby/episode-name'] = 'Confirmed episode'
        local notice
        s.env.show_message = function(message) notice = message end
        if multiple_providers then s.env.options.api_server = 'http://first.example.test,http://second.example.test' end
        s.emit('file-loaded')
        local first = {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}
        local second = {type = 'tvseries', animeTitle = 'Fixture series remake', bangumiId = multiple_providers and '42' or '43'}
        local response = function(date) return {bangumi = {episodes = {{episodeNumber = '3',
            episodeTitle = '第3话 Confirmed episode', episodeId = 10002, airDate = date}}}} end
        if multiple_providers then
            s.respond(1, {animes = {first}})
            s.respond(2, {animes = {second}})
            s.respond(3, response('2026-07-17'))
            s.respond(4, response('2026-07-18'))
        else
            s.respond(1, {animes = {first, second}})
            s.respond(2, response('2026-07-17'))
            s.respond(3, response('2026-07-18'))
        end
        assert(#s.requests == (multiple_providers and 4 or 3),
            'Deployment-local episode IDs must not collapse different releases or providers')
        assert(notice and notice ~= '', 'Conflicting identities must require manual selection')
    end
end
function cases.duplicate_nearby_records_in_one_release_are_not_ambiguous()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
    s.props['user-data/tigerest/emby/episode-name'] = 'Confirmed episode'
    s.emit('file-loaded')
    s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
    local episode = {episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
        episodeId = 420003, airDate = '2026-07-17'}
    s.respond(2, {bangumi = {episodes = {episode, episode}}})
    assert(s.request_args[3] and s.request_args[3][#s.request_args[3]]:find('/comment/420003?', 1, true),
        'Repeated records for one provider/release/episode must still be one candidate')
end
function cases.malformed_candidate_entries_finish_with_a_manual_hint()
    for _, stage in ipairs({'anime', 'missing-id', 'episode'}) do
        local s = sandbox(true)
        s.set_history({show_danmaku = true})
        s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
        local notice
        s.env.show_message = function(message) notice = message end
        s.emit('file-loaded')
        local anime = {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}
        if stage == 'anime' then
            s.respond(1, {animes = {false}})
        elseif stage == 'missing-id' then
            anime.bangumiId = nil
            s.respond(1, {animes = {anime}})
        else
            s.respond(1, {animes = {anime}})
            s.respond(2, {bangumi = {episodes = {false}}})
        end
        s.advance(16)
        assert(notice and notice ~= '', 'Malformed ' .. stage .. ' entries must finish with manual matching')
        assert(#s.requests == (stage == 'episode' and 2 or 1), 'Malformed entries must not load comments')
    end
end
function cases.exact_match_survives_an_incomplete_candidate_scan()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
    s.emit('file-loaded')
    s.respond(1, {animes = {
        {type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'},
        {type = 'tvseries', animeTitle = 'Fixture series remake', bangumiId = '43'},
    }})
    s.respond(2, {})
    s.respond(3, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
        episodeId = 430003, airDate = '2026-07-20'}}}})
    assert(s.request_args[4] and s.request_args[4][#s.request_args[4]]:find('/comment/430003?', 1, true),
        'An incomplete scan only blocks weaker nearby dates, not a known exact match')
end
function cases.release_detail_deadlines_do_not_survive_file_unload()
    local s = sandbox(true)
    s.set_history({show_danmaku = true})
    s.props['user-data/tigerest/emby/premiere-date'] = '2026-07-20T00:00:00Z'
    local notices = 0
    s.env.show_message = function() notices = notices + 1 end
    s.emit('file-loaded')
    s.respond(1, {animes = {{type = 'tvseries', animeTitle = 'Fixture series', bangumiId = '42'}}})
    s.emit('on_unload')
    local previous_notices = notices
    s.advance(16)
    s.respond(2, {bangumi = {episodes = {{episodeNumber = '3', episodeTitle = '第3话 Confirmed episode',
        episodeId = 420003, airDate = '2026-07-20'}}}})
    assert(notices == previous_notices and #s.requests == 2,
        'Unloaded episode deadlines and late detail responses must not affect the next file')
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
