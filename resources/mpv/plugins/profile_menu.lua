-- Tigerest Theater 的 UOSC 画质档菜单。
-- 档位来自客户端的 mpv.conf（默认 / 真人 / 激进测试，以及用户自建的 tigerest-user-* 档位）。
-- 切档由客户端执行：它按 mpv.conf 当前内容逐项设置并核对着色器数量，设置页修改后无需重启。

local mp = require('mp')
local utils = require('mp.utils')

local current_profile = mp.get_property('user-data/profile_menu/current') or 'tigerest-default'

-- 客户端尚未发布档位列表时使用的内置三档。
local profiles = {
	{ title = '默认', hint = 'Anime AA：SSim + Krig + ravu zoom', profile = 'tigerest-default' },
	{ title = '真人', hint = '真人影视：SSim + ravu zoom', profile = 'tigerest-liveaction' },
	{ title = '激进测试', hint = 'Anime4K 完整链，用于检查 shader 挂载', profile = 'tigerest-aggressive-test' },
}

local function find_profile(name)
	for _, item in ipairs(profiles) do
		if item.profile == name then
			return item
		end
	end
	return nil
end

local function current_title()
	local item = find_profile(current_profile)
	return item and item.title or current_profile
end

local function update_button()
	local filters_payload = utils.format_json({
		icon = 'tune',
		tooltip = '滤镜: ' .. current_title(),
		command = 'script-binding profile_menu/open',
	})
	mp.commandv('script-message-to', 'uosc', 'set-button', 'filters', filters_payload)

	local diagnostics_payload = utils.format_json({
		icon = 'assessment',
		tooltip = '播放诊断（打开后按 2 查看完整帧处理流程）',
		command = 'script-binding stats/display-stats-toggle',
	})
	mp.commandv('script-message-to', 'uosc', 'set-button', 'diagnostics', diagnostics_payload)

end

local function apply_profile(name)
	-- 客户端负责清空旧着色器、按 mpv.conf 设置档位并在画面上提示结果。
	mp.commandv('script-message', 'tigerest-apply-profile', name)
end

local function build_menu()
	local items = {}
	for _, item in ipairs(profiles) do
		items[#items + 1] = {
			title = item.title,
			hint = item.hint,
			value = {'script-message-to', 'profile_menu', 'apply-profile', item.profile},
			active = current_profile == item.profile,
		}
	end
	return {
		type = 'profile-menu',
		title = '滤镜',
		hint = '切换 mpv.conf 中的画质档位',
		items = items,
	}
end

local function open_menu()
	mp.commandv('script-message-to', 'uosc', 'open-menu', utils.format_json(build_menu()))
end

mp.register_script_message('apply-profile', apply_profile)
	mp.add_key_binding(nil, 'open', open_menu)
	mp.add_key_binding(nil, 'apply-default', function() apply_profile('tigerest-default') end)
	mp.add_key_binding(nil, 'apply-liveaction', function() apply_profile('tigerest-liveaction') end)
	mp.add_key_binding(nil, 'apply-aggressive-test', function() apply_profile('tigerest-aggressive-test') end)

-- 客户端在启动和保存 mpv.conf 后发布档位列表。
mp.observe_property('user-data/profile_menu/profiles', 'string', function(_, value)
	local parsed = value and utils.parse_json(value)
	if type(parsed) == 'table' and #parsed > 0 then
		profiles = parsed
		update_button()
	end
end)

-- 客户端每次切档后写入当前档位；观察它以同步菜单高亮和按钮提示。
mp.observe_property('user-data/profile_menu/current', 'string', function(_, value)
	if value and value ~= '' and value ~= current_profile then
		current_profile = value
		update_button()
	end
end)

update_button()
	mp.register_event('file-loaded', update_button)
