local msg = require('mp.msg')
local utils = require("mp.utils")

local function extract_url(url)
    local path = url:match("^https?://[^/]+(/[^%?]*)")
    return path
end

local function generateXSignature(url, time, appid, app_accept)
    local url_path = extract_url(url)
    if not url_path then
        return nil
    end

    local dataToHash = string.format("%s%d%s%s", AES.ECB.decrypt(KEY, Base64.decode(appid)),
    time, url_path, AES.ECB.decrypt(KEY, Base64.decode(app_accept)))
    local hash = Sha256(dataToHash)
    local base64Hash = Base64.encode(hex_to_bin(hash))
    return base64Hash
end

-- 写入history.json
-- 读取episodeId获取danmaku
function prepare_episode_id(input, selected_server)
    DANMAKU.source = "dandanplay"
    for url, source in pairs(DANMAKU.sources) do
        if source.from == "api_server" then
            if not source.from_history then
                DANMAKU.sources[url] = nil
            else
                DANMAKU.sources[url]["data"] = nil
            end
        end
    end

    if not selected_server then
        if DANMAKU.api_server ~= nil then
            selected_server = DANMAKU.api_server
        else
            local servers = get_api_server_list(options.api_server)
            if servers and #servers > 0 then
                selected_server = servers[1]
            end
        end
    end

    selected_server = resolve_api_server(selected_server)
    DANMAKU.api_server = selected_server

    write_history(input, selected_server)
    set_danmaku_button()
    DANMAKU.mapping_origin = nil
    return selected_server
end

function set_episode_id(input, from_menu, api_server, bangumi_id, playback_token)
    if from_menu and not begin_manual_danmaku_selection(playback_token) then return end
    local selected_server = resolve_api_server(api_server or DANMAKU.api_server
        or get_api_server_list(options.api_server)[1])
    local function legacy(save_failed)
        prepare_episode_id(input, selected_server)
        fetch_danmaku(input, from_menu or false, selected_server, save_failed)
    end
    if from_menu and select_shared_danmaku(input, bangumi_id, selected_server, playback_token, legacy) then return end
    legacy()
end

-- 回退使用额外的弹幕获取方式
function get_danmaku_fallback(query)
    local function do_fallback()
        if options.fallback_server == "" then return end
        local url = options.fallback_server .. "/?ac=dm&url=" .. query
        msg.verbose("尝试获取弹幕：" .. url)

        local args = make_danmaku_request_args("GET", url)
        if not args then return end

        fetch_danmaku_data(args, function(data)
            if data ~= nil and data["xml"] ~= nil then
                if DANMAKU.sources[query] ~= nil then
                    DANMAKU.sources[query]["data"] = data["xml"]
                else
                    DANMAKU.sources[query] = {from = "user_custom", data = data["xml"]}
                end
                load_danmaku(true)
                return
            end

            if not data or not data["comments"] or data["count"] <= 1 then
                msg.info("备用服务器无数据或返回格式不正确")
                show_message("备用服务器无数据或返回格式不正确", 3)
                return
            end

            save_danmaku_data(data["comments"], query, "user_custom")
            load_danmaku(true)
        end)
    end

    if query:find('bilibili.com') or query:find('bilivideo.c[nom]+') then
        load_danmaku_for_bilibili(query, function(success)
            if not success then do_fallback() end
        end)
        return
    end

    if query:find('bahamut.akamaized.net') then
        load_danmaku_for_bahamut(query, function(success)
            if not success then do_fallback() end
        end)
        return
    end

    if query:find('mgtv.com') then
        load_danmaku_for_mgtv(query, function(success)
            if not success then do_fallback() end
        end)
        return
    end

    if query:find('iqiyi.com') then
        load_danmaku_for_iqiyi(query, function(success)
            if not success then do_fallback() end
        end)
        return
    end

    if query:find('v.qq.com') then
        load_danmaku_for_tencent(query, function(success)
            if not success then do_fallback() end
        end)
        return
    end

    if query:find('v.youku.com') then
        load_danmaku_for_youku(query, function(success)
            if not success then do_fallback() end
        end)
        return
    end

    do_fallback()
end

-- 返回弹幕请求参数
function make_danmaku_request_args(method, url, headers, body)
    url = resolve_managed_api_url(url)
    local args = {
        "curl",
        "-L",
        "-X",
        method,
        "-H",
        "Accept: application/json",
        "-H",
        "User-Agent: " .. options.user_agent,
    }

    if headers then
        for k, v in pairs(headers) do
            table.insert(args, '-H')
            table.insert(args, string.format('%s: %s', k, v))
        end
    end

    if body then
        table.insert(args, '-d')
        table.insert(args, utils.format_json(body))
        table.insert(args, '-H')
        table.insert(args, 'Content-Type: application/json')
    end

    table.insert(args, '--compressed')

    if url:find("api%.dandanplay%.") then
        local time = os.time()
        local appid = "UgjRIH45lE1BBLNmir1WKw=="
        local app_accept = "SzuWlFZAPRMqeWf9qmfp8dcvYr3hvxuSrIRZuAeEfko="
        table.insert(args, '-H')
        table.insert(args, string.format('X-AppId: %s', AES.ECB.decrypt(KEY, Base64.decode(appid))))
        table.insert(args, '-H')
        table.insert(args, string.format('X-Signature: %s', generateXSignature(url, time, appid, app_accept)))
        table.insert(args, '-H')
        table.insert(args, string.format('X-Timestamp: %s', time))
    end

    if options.proxy ~= "" then
        table.insert(args, '-x')
        table.insert(args, options.proxy)
    end

    table.insert(args, url)

    return args
end

local function normalize_danmaku_response(d)
    if not d then return d end
    -- 已经是 comments/count 格式则直接返回
    if d.comments or d.count then return d end

    if d.danmuku and type(d.danmuku) == "table" then
        local out = {}
        for _, item in ipairs(d.danmuku) do
            -- item 预期为数组，索引: 1=time, 2=pos(right/top/bottom), 3=color(hex), 5=content
            local time = tonumber(item[1]) or 0
            local pos = item[2] or "right"
            local color = item[3] or ""
            local content = item[5] or item[4] or ""

            local mode = 1
            if pos == "right" then
                mode = 1
            elseif pos == "top" then
                mode = 4
            elseif pos == "bottom" then
                mode = 5
            end

            local colorDec = 16777215
            if type(color) == "number" then
                colorDec = color
            elseif type(color) == "string" then
                colorDec = hex_to_int_color(color)
            end

            local p = string.format("%.2f,%d,%d", time, mode, colorDec)
            table.insert(out, { p = p, m = content })
        end
        return { comments = out, count = tonumber(d.danum) or #out }
    end

    return d
end

-- 尝试通过解析文件名匹配剧集
local function broadcast_date(value)
    return type(value) == 'string' and value:match('^(%d%d%d%d%-%d%d%-%d%d)') or nil
end

local function broadcast_day(value)
    local date = broadcast_date(value)
    if not date then return nil end
    local year, month, day = date:match('^(%d+)%-(%d+)%-(%d+)$')
    year, month, day = tonumber(year), tonumber(month), tonumber(day)
    if year < 1 or month < 1 or month > 12 then return nil end
    local leap = year % 4 == 0 and (year % 100 ~= 0 or year % 400 == 0)
    local month_days = {31, leap and 29 or 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
    if day < 1 or day > month_days[month] then return nil end
    -- Civil days avoid timezone/DST shifts and Windows' pre-1970 os.time limit.
    local previous_year = year - 1
    local ordinal = 365 * previous_year + math.floor(previous_year / 4)
        - math.floor(previous_year / 100) + math.floor(previous_year / 400) + day
    for index = 1, month - 1 do ordinal = ordinal + month_days[index] end
    return ordinal
end

local function episode_title(value)
    return tostring(value or ''):gsub('^第%s*%d+%s*话%s*', ''):gsub('^第%s*%d+%s*集%s*', '')
        :gsub('[%s%p]', '')
end

local function valid_api_id(value)
    return type(value) == 'number' or (type(value) == 'string' and value ~= '')
end

local function match_episode(anime, episode_num, premiere_date, expected_title, fallback, confident_series, api_server, callback)
    local bangumiId = anime.bangumiId
    local url = api_server .. "/api/v2/bangumi/" .. bangumiId
    local args = make_danmaku_request_args("GET", url)

    if args == nil then
        callback(nil, nil, true)
        return
    end

    parallel_requests({api_server}, function() return args end, function(_, error, json)
        if error then
            msg.error(error)
            callback(nil, nil, true)
            return
        end

        local data = utils.parse_json(json)
        if type(data) ~= 'table' or type(data.bangumi) ~= 'table'
            or type(data.bangumi.episodes) ~= 'table' then
            msg.info("无结果")
            callback(nil, nil, true)
            return
        end

        local dated_episodes, titled_episodes, nearby_episodes = {}, {}, {}
        local expected_day = broadcast_day(premiere_date)
        local malformed_episode = false
        local unconfirmed_series = false
        for _, episode in ipairs(data.bangumi.episodes) do
            local valid = type(episode) == 'table'
            local ep_num = valid and tonumber(episode.episodeNumber)
            local date_matches = valid and premiere_date and broadcast_date(episode.airDate) == premiere_date
            local number_matches = valid and not premiere_date and ep_num == tonumber(episode_num)
            -- When trying a lower-ranked title without dates, require corroborating
            -- episode text if Emby supplied it (e.g. an original and its remake).
            local title_matches = valid and (not fallback or expected_title == ''
                or jaro_winkler(expected_title, episode_title(episode.episodeTitle)) >= 0.85)
            if ep_num and valid_api_id(episode.episodeId)
                and type(episode.episodeTitle) == 'string' and episode.episodeTitle:match('%S') then
                if date_matches then
                    dated_episodes[#dated_episodes + 1] = episode
                    if expected_title ~= '' and episode_title(episode.episodeTitle) == expected_title then
                        titled_episodes[#titled_episodes + 1] = episode
                    end
                elseif number_matches and title_matches then
                    callback(episode)
                    return
                elseif expected_day and ep_num == tonumber(episode_num) then
                    local air_day = broadcast_day(episode.airDate)
                    if not air_day then
                        -- A same-numbered episode without a usable date has not
                        -- been ruled out, so another release is not proven unique.
                        malformed_episode = true
                    elseif math.abs(expected_day - air_day) <= 7 then
                        if expected_title == '' then
                            -- Emby may only know "第8集". Without episode text,
                            -- require a stronger series match and global uniqueness.
                            if confident_series then
                                nearby_episodes[#nearby_episodes + 1] = episode
                            else
                                unconfirmed_series = true
                            end
                        elseif jaro_winkler(expected_title, episode_title(episode.episodeTitle)) >= 0.85 then
                            nearby_episodes[#nearby_episodes + 1] = episode
                        end
                    end
                end
            else
                malformed_episode = true
            end
        end

        -- Streaming services may release several episodes on the same day.
        -- Resolve exact titles before episode numbers; a date alone may remap
        -- continuous Emby numbering only when it identifies one unique episode.
        if #titled_episodes == 1 then callback(titled_episodes[1]); return end
        local candidates = #titled_episodes > 0 and titled_episodes or dated_episodes
        local numbered_episode, numbered_count = nil, 0
        for _, episode in ipairs(candidates) do
            if tonumber(episode.episodeNumber) == tonumber(episode_num) then
                numbered_episode, numbered_count = episode, numbered_count + 1
            end
        end
        if numbered_count == 1 then callback(numbered_episode); return end
        if #dated_episodes == 1 then callback(dated_episodes[1]); return end
        -- Unresolved exact-date ambiguity cannot be replaced by a weaker date.
        callback(nil, nearby_episodes, #dated_episodes > 0 or malformed_episode or unconfirmed_series)
    end, nil, {per_request_timeout = 15})
end

local function match_anime()
    local anime_type = "tvseries"
    local title, season_num, episode_num = parse_title()
    if not episode_num then
        msg.info("无法解析剧集信息")
        return
    end

    if title:match("OVA") or title:match("OAD") then
        anime_type = "ova"
    end

    -- 并发在多个 api_server 上搜索，遇到第一个可接受的匹配就取消其余请求
    local encoded_query = url_encode(title)
    local servers = get_api_server_list(options.api_server)

    local matched = false
    local cancel_fn = nil
    local searches_finished = false
    local pending_candidates = 0
    local nearby_candidates = {}
    local fallback_uncertain = false
    local premiere_date, expected_title = nil, ''
    if mp.get_property_bool('user-data/tigerest/emby/valid', false) then
        premiere_date = broadcast_date(mp.get_property_native('user-data/tigerest/emby/premiere-date'))
        expected_title = episode_title(mp.get_property_native('user-data/tigerest/emby/episode-name'))
    end

    local function accept_episode(anime, episode, server)
        matched = true
        DANMAKU.anime = anime.animeTitle
        DANMAKU.episode = episode.episodeTitle
        msg.info('匹配剧集: ' .. anime.animeTitle .. ' - ' .. episode.episodeTitle)
        set_episode_id(episode.episodeId, nil, server)
        if cancel_fn then pcall(cancel_fn) end
    end

    local function finish_unmatched()
        if searches_finished and pending_candidates == 0 and not matched then
            -- Wait for every release/server to finish: an exact date wins,
            -- and nearby dates are usable only with one corroborated episode.
            local selected, count = nil, 0
            for _, candidate in pairs(nearby_candidates) do
                selected, count = candidate, count + 1
            end
            if count == 1 and not fallback_uncertain then
                if expected_title == '' then
                    msg.info('Matched unique series/episode number with broadcast date within seven days (no episode title)')
                else
                    msg.info('Matched episode number/title with broadcast date within seven days')
                end
                accept_episode(selected.anime, selected.episode, selected.server)
                return
            end
            msg.info('没有找到对应剧集的弹幕')
            show_message('未找到对应剧集的弹幕，可在弹幕菜单中手动匹配', 5)
        end
    end

    local function title_score(anime_title)
        local target_title = title:gsub('½', '1/2')
        if tonumber(season_num) and tonumber(season_num) > 1 then
            target_title = target_title .. ' 第' .. number_to_chinese(season_num) .. '季'
        end
        anime_title = tostring(anime_title or ''):gsub('½', '1/2')
            :gsub('^%s*(.-)%s*$', '%1'):gsub('%s*%(.-%)%s*$', ''):gsub('%s*【.-】.*$', '')
        if anime_title:match('第一[季部]') and tonumber(season_num) == 1 then
            target_title = target_title .. ' 第一季'
        end
        return jaro_winkler(target_title, anime_title)
    end

    local function build_args(server)
        local url = server .. "/api/v2/search/anime"
        local full_url = url .. "?keyword=" .. encoded_query
        return make_danmaku_request_args("GET", full_url)
    end

    local function per_response(server, err, out)
        if matched then return end
        if err then
            fallback_uncertain = true
            msg.debug(("search anime failed for %s: %s"):format(server, tostring(err)))
            return
        end
        local data = utils.parse_json(out)
        if type(data) ~= 'table' or type(data.animes) ~= 'table' then
            fallback_uncertain = true
            return
        end
        local local_candidates = {}
        for _, anime in ipairs(data.animes) do
            if type(anime) ~= 'table' then
                fallback_uncertain = true
            elseif anime.type == anime_type and title_score(anime.animeTitle) >= 0.75 then
                if valid_api_id(anime.bangumiId) then
                    table.insert(local_candidates, anime)
                else
                    fallback_uncertain = true
                end
            end
        end
        table.sort(local_candidates, function(a, b)
            return title_score(a.animeTitle) > title_score(b.animeTitle)
        end)
        if #local_candidates == 0 then return end
        pending_candidates = pending_candidates + 1
        local function try_candidate(index)
            local anime = local_candidates[index]
            if matched or not anime then
                pending_candidates = pending_candidates - 1
                finish_unmatched()
                return
            end
            match_episode(anime, episode_num, premiere_date, expected_title, index > 1,
                title_score(anime.animeTitle) >= 0.85, server, function(episode, nearby, uncertain)
                fallback_uncertain = fallback_uncertain or uncertain
                if episode and not matched then
                    pending_candidates = pending_candidates - 1
                    accept_episode(anime, episode, server)
                    return
                end
                for _, candidate in ipairs(nearby or {}) do
                    -- Custom providers allocate deployment-local IDs. Keep their
                    -- candidates separate; repeat records within one release dedupe.
                    local key = server .. '\0' .. tostring(anime.bangumiId) .. '\0' .. tostring(candidate.episodeId)
                    nearby_candidates[key] = {anime = anime, episode = candidate, server = server}
                end
                try_candidate(index + 1)
            end)
        end
        try_candidate(1)
    end

    local function final_cb()
        searches_finished = true
        finish_unmatched()
    end

    cancel_fn = parallel_requests(servers, build_args, per_response, final_cb, { concurrency = 5, per_request_timeout = 15 })
end

-- 执行哈希匹配获取弹幕
local function match_file(file_path, file_name, callback)
    -- 计算文件哈希
    local hash = nil
    local file_info = utils.file_info(file_path)
    if file_info and file_info.size >= 16 * 1024 * 1024 then
        local file, error = io.open(normalize(file_path), 'rb')
        if file and not error then
            local m = MD5.new()
            for _ = 1, 16 * 1024 do
                local content = file:read(1024)
                if not content then
                    break
                end
                m:update(content)
            end
            file:close()
            hash = m:finish()
        end
    end

    if hash then msg.info('hash:', hash) end

    -- A synthetic hash leaves the service matching only the ambiguous series
    -- name/number. Prefer the episode's known broadcast date in that case.
    if not hash and mp.get_property_bool('user-data/tigerest/emby/valid', false)
        and broadcast_date(mp.get_property_native('user-data/tigerest/emby/premiere-date')) then
        match_anime()
        return
    end

    local title, season_num, episode_num = parse_title()
    if title and episode_num then
        if season_num then
            file_name = title .. " S" .. season_num .. "E" .. episode_num
        else
            file_name = title .. " E" .. episode_num
        end
    else
        file_name = title
    end

    local servers = get_api_server_list(options.api_server)

    local matched = false
    local cancel_fn = nil

    local function build_args(server)
        local url = server .. "/api/v2/match"
        return make_danmaku_request_args("POST", url, { ["Content-Type"] = "application/json" }, {
            fileName = file_name,
            fileHash = hash or "a1b2c3d4e5f67890abcd1234ef567890",
            matchMode = "hashAndFileName"
        })
    end

    local function per_response(server, err, out)
        if matched then return end
        if err then
            msg.debug(("match failed for %s: %s"):format(server, tostring(err)))
            return
        end
        local data = utils.parse_json(out)
        if not data or not data.isMatched then
            return
        end
        matched = true
        DANMAKU.anime = data.matches[1].animeTitle
        DANMAKU.episode = data.matches[1].episodeTitle

        set_episode_id(data.matches[1].episodeId, nil, server)
        if cancel_fn then pcall(cancel_fn) end
        if callback then pcall(callback) end
    end

    local function final_cb()
        if not matched then
            callback("没有匹配的剧集")
        end
    end

    cancel_fn = parallel_requests(servers, build_args, per_response, final_cb, { concurrency = 5, per_request_timeout = 15 })
end

-- 异步获取弹幕数据
function fetch_danmaku_data(args, callback)
    call_cmd_async(args, function(error, json)
        if error then
            show_message("获取数据失败", 3)
            msg.error("HTTP 请求失败：" .. error)
            return
        end
        local data = utils.parse_json(json)
        if data ~= nil then
            data = normalize_danmaku_response(data)
        else
            local danmaku = parse_xml_danmaku(json)
            if #danmaku > 0 then
                data = {}
                data["xml"] = danmaku
            end
        end
        callback(data)
    end)
end

-- 保存弹幕数据
function save_danmaku_data(comments, query, danmaku_source)
    local danmaku_list = save_danmaku_to_list(comments)

    if DANMAKU.sources[query] ~= nil then
        DANMAKU.sources[query]["data"] = danmaku_list
    else
        DANMAKU.sources[query] = {from = danmaku_source, data = danmaku_list}
    end
end

function save_danmaku_xml(url, xml_string)
    local danmaku_list = parse_xml_danmaku(xml_string)

    if DANMAKU.sources[url] ~= nil then
        DANMAKU.sources[url]["data"] = danmaku_list
    else
        DANMAKU.sources[url] = {from = "user_custom", data = danmaku_list}
    end
end

function save_danmaku_json(url, json_string)
    local danmaku_list = parse_json_danmaku(json_string)

    if DANMAKU.sources[url] ~= nil then
        DANMAKU.sources[url]["data"] = danmaku_list
    else
        DANMAKU.sources[url] = {from = "user_custom", data = danmaku_list}
    end
end

function save_danmaku_downloaded(url, downloaded_file)
    local danmaku_list = parse_danmaku_file(downloaded_file)
    if file_exists(downloaded_file) then
        os.remove(downloaded_file)
    end
    if DANMAKU.sources[url] ~= nil then
        DANMAKU.sources[url]["data"] = danmaku_list
    else
        DANMAKU.sources[url] = {from = "user_custom", data = danmaku_list}
    end
end

-- 处理获取到的数据
function handle_fetched_danmaku(data, url, from_menu)
    if data and data["comments"] then
        if data["count"] == 0 then
            if DANMAKU.sources[url] == nil then
                DANMAKU.sources[url] = {from = "api_server"}
            end
            show_message("该集弹幕内容为空，结束加载", 3)
            msg.verbose("该集弹幕内容为空，结束加载")
            return
        end
        save_danmaku_data(data["comments"], url, "api_server")
        load_danmaku(from_menu)
    else
        show_message("无数据", 3)
        msg.info("无数据")
    end
end

-- 匹配弹幕库 comment, 仅匹配dandan本身弹幕库
-- 通过danmaku api（url）+id获取弹幕
function fetch_danmaku(episodeId, from_menu, api_server, save_failed)
    api_server = resolve_api_server(api_server)
    local url = api_server .. "/api/v2/comment/" .. episodeId .. "?withRelated=true&chConvert=0"
    show_message("弹幕加载中...", 30)
    msg.verbose("尝试获取弹幕：" .. url)
    local args = make_danmaku_request_args("GET", url)

    if args == nil then
        return
    end

    fetch_danmaku_data(args, function(data)
        handle_fetched_danmaku(data, url, from_menu)
        if save_failed and data and data.comments then
            show_message('弹幕已加载，但共享匹配未保存', 5)
        end
    end)
end

-- 从用户添加过的弹幕源添加弹幕
function addon_danmaku(dir, from_menu)
    if dir then
        local history_json = read_file(HISTORY_PATH)
        local history = utils.parse_json(history_json) or {}
        if history[dir] and history[dir].extra ~= nil then
            return
        end
    end
    for url, source in pairs(DANMAKU.sources) do
        if source.from ~= "api_server" then
            add_danmaku_source(url, from_menu)
        end
    end
end

--通过输入源url获取弹幕库
function add_danmaku_source(query, from_menu)
    if DANMAKU.sources[query] == nil then
        DANMAKU.sources[query] = {from = "user_custom"}
    end

    from_menu = from_menu or false
    if from_menu then
        add_source_to_history(query, DANMAKU.sources[query])
    end

    if is_protocol(query) then
        add_danmaku_source_online(query, from_menu)
    else
        add_danmaku_source_local(query, from_menu)
    end
end

function add_danmaku_source_local(query, from_menu)
    local path = normalize(query)
    if not file_exists(path) then
        msg.warn("无效的文件路径")
        return
    end
    if not (string.match(path, "%.xml$") or string.match(path, "%.json$")) then
        msg.warn("仅支持弹幕文件")
        return
    end

    if DANMAKU.sources[query] ~= nil then
        DANMAKU.sources[query]["from"] = "user_local"
        DANMAKU.sources[query]["data"] = parse_danmaku_file(path)
    else
        DANMAKU.sources[query] = {from = "user_local", data = parse_danmaku_file(path)}
    end

    set_danmaku_button()
    load_danmaku(from_menu)
end

--通过输入源url获取弹幕库
function add_danmaku_source_online(query, from_menu)
    set_danmaku_button()
    show_message("弹幕加载中...", 30)
    msg.verbose("尝试获取弹幕：" .. query)

    local servers = get_api_server_list(options.api_server)

    -- 过滤掉指向 dandanplay.net 的服务器
    local filtered = {}
    for _, s in ipairs(servers) do
        if type(s) == "string" and not s:lower():find("dandanplay%.net") then
            table.insert(filtered, s)
        end
    end
    servers = filtered
    if #servers == 0 then
        get_danmaku_fallback(query)
        return
    end

    local matched = false
    local cancel_fn = nil

    local function build_args(server)
        local url = server .. "/api/v2/extcomment?url=" .. url_encode(query)
        return make_danmaku_request_args("GET", url)
    end

    local function per_response(server, err, out)
        if matched then return end
        if err then
            msg.debug(("extcomment failed for %s: %s"):format(server, tostring(err)))
            return
        end
        local data = utils.parse_json(out)
        data = normalize_danmaku_response(data)
        if not data or not data["comments"] or data["count"] <= 1 then
            return
        end
        matched = true
        -- 保存并加载弹幕
        save_danmaku_data(data["comments"], query, "user_custom")
        load_danmaku(from_menu)
        -- 取消其他未完成请求
        if cancel_fn then pcall(cancel_fn) end
    end

    local function final_cb()
        if not matched then
            -- 所有服务器都未返回有效弹幕，回退到备用服务器
            msg.info("所有服务器均无有效弹幕，尝试备用服务器")
            get_danmaku_fallback(query)
        end
    end

    cancel_fn = parallel_requests(servers, build_args, per_response, final_cb, { concurrency = 3, per_request_timeout = 30 })
end

-- 将弹幕转换为 Lua table
function save_danmaku_to_list(comments)
    local danmaku_list = {}

    for _, comment in ipairs(comments) do
        local p = comment["p"]
        local shift = comment["shift"]
        if p then
            local fields = split(p, ",")
            if shift ~= nil then
                fields[1] = tonumber(fields[1]) + tonumber(shift)
            end
            local time = tonumber(fields[1])
            local type = tonumber(fields[2])
            local color = tonumber(fields[3]) or 0xFFFFFF
            local size = 25
            local m_value = comment["m"]
                            :gsub("[%z\1-\31]", "")
                            :gsub("\\", "")
                            :gsub("\"", "")
            table.insert(danmaku_list, {
                time = time,
                type = type,
                size = size,
                color = color,
                text = m_value
            })
        end
    end

    return danmaku_list
end

-- 通过文件前 16M 的 hash 值进行弹幕匹配
function get_danmaku_with_hash(file_name, file_path)
    if type(MD5) ~= "table" or not MD5.sum then
        msg.warn("MD5 模块不支持 Lua 5.1，回退到文件名匹配")
        match_anime()
        return
    end
    if is_protocol(file_path) then
        set_danmaku_button()
        local temp_file = "temp-" .. PID .. ".mp4"
        local arg = {
            "curl",
            "--connect-timeout",
            "10",
            "--max-time",
            "30",
            "--range",
            "0-16777215",
            "--user-agent",
            options.user_agent,
            "--output",
            utils.join_path(DANMAKU_PATH, temp_file),
            "-L",
            file_path,
        }

        if options.proxy ~= "" then
            table.insert(arg, '-x')
            table.insert(arg, options.proxy)
        end

        call_cmd_async(arg, function(error)
            file_path = utils.join_path(DANMAKU_PATH, temp_file)

            match_file(file_path, file_name, function(error)
                if error then
                    msg.error(error)
                    msg.info("尝试通过解析文件名获取弹幕")
                    match_anime()
                end
            end)
        end)
    else
        local dir = get_parent_directory(file_path)
        local excluded_path = utils.parse_json(options.excluded_path)
        if PLATFORM == "windows" then
            for i, path in pairs(excluded_path) do
                excluded_path[i] = path:gsub("/", "\\")
            end
        end
        if contains_any(excluded_path, dir) then
            match_anime()
            return
        end
        match_file(file_path, file_name, function(error)
            if error then
                msg.error(error)
                msg.info("尝试通过解析文件名获取弹幕")
                match_anime()
            end
        end)
    end
end
