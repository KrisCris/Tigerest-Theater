-- Emby owns loading and play-session reporting. UOSC only requests a queue item.
local mp = require('mp')
local utils = require('mp.utils')
local playlist = {property = 'user-data/tigerest/web-playlist'}

function playlist.read(raw)
	if raw == nil then raw = mp.get_property_native(playlist.property) end
	local data = type(raw) == 'string' and utils.parse_json(raw) or nil
	if type(data) ~= 'table' or type(data.items) ~= 'table' or #data.items == 0 then return nil end
	return data
end

function playlist.select(item_id)
	local data = playlist.read()
	if not data or item_id == data.currentItemId then return end
	for _, item in ipairs(data.items) do
		if type(item.PlaylistItemId) == 'string' and item.PlaylistItemId == item_id then
			mp.commandv('script-message', 'tigerest-playlist-item', item_id)
			return
		end
	end
end

function playlist.navigate(delta)
	local data = playlist.read()
	if not data then return false end
	for index, item in ipairs(data.items) do
		if item.PlaylistItemId == data.currentItemId then
			local target = data.items[index + delta]
			if target then playlist.select(target.PlaylistItemId) end
			break
		end
	end
	-- At either end (or during a queue update), never fall through to mpv's URL
	-- playlist or directory. Emby determines whether another episode exists.
	return true
end

function playlist.serialize(raw)
	local data, items, selected = playlist.read(raw), {}, nil
	if not data then return items end
	for index, item in ipairs(data.items) do
		local hint = tostring(index)
		if type(item.IndexNumber) == 'number' then
			hint = 'E' .. tostring(item.IndexNumber)
			if type(item.ParentIndexNumber) == 'number' then hint = 'S' .. tostring(item.ParentIndexNumber) .. ' ' .. hint end
		end
		local active = item.PlaylistItemId == data.currentItemId
		items[#items + 1] = {
			title = type(item.Name) == 'string' and item.Name ~= '' and item.Name or ('Episode ' .. index),
			hint = hint,
			value = item.PlaylistItemId,
			active = active,
		}
		if active then selected = #items end
	end
	return items, selected
end

return playlist
