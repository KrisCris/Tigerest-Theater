-- Native transport probe: real mpv timers/subprocesses/curl, local HTTP only.
local utils = require('mp.utils')
local output
local function save(name, value)
    local file = assert(io.open(output .. '/' .. name .. '.json', 'wb'))
    file:write(utils.format_json(value)); file:close()
end
function show_message() end
mp.register_script_message('http-probe-init', function(root, directory)
    output = directory
    dofile(root .. '/modules/utils.lua')
    dofile(root .. '/modules/http.lua')
    dofile(root .. '/modules/mapping.lua')
    save('ready', {ready=true})
end)
mp.register_script_message('http-probe-request', function(name, url)
    request_danmaku_http({'curl', '--noproxy', '*', url}, {retry=true, kind='comment'}, function(result)
        result.running = is_async_running()
        save(name, result)
    end)
end)
mp.register_script_message('http-probe-cancel', function()
    cancel_danmaku_async_requests()
    save('cancelled', {running=is_async_running()})
end)
