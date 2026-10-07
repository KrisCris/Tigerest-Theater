// Boundary fixture for Emby 4.10 navdrawercontent/listview. Native custom-action
// rows have data-index; their route lives in the owning itemsContainer.getItem().
// Real app routing, drawer focus management and history still require Qt/device QA.
window.settingsRoutes = new (settingsModules.get('tigerest/settings.js').factory())().getRoutes();
for (const route of settingsRoutes) route.path = '/plugins/tigerest-native-settings/' + route.path;
const settingsHost = document.querySelector('#host');
function FixtureBaseView() {}
FixtureBaseView.prototype.onResume = function () {};
FixtureBaseView.prototype.onPause = function () {};
window.settingsRouter = {
    setTitle() {},
    async show(path) {
        window.settingsController?.onPause({});
        const route = settingsRoutes.find(route => route.path === path);
        if (!route) { window.returned = true; return; }
        settingsHost.replaceChildren();
        const Controller = settingsModules.get(route.controller).factory({default: FixtureBaseView}, {default: settingsRouter});
        window.settingsController = new Controller({querySelector: () => settingsHost}, {});
        settingsController.onResume({});
        document.querySelector('.mainDrawer').classList.remove('drawer-open');
        await new Promise(resolve => setTimeout(resolve, 40));
    }
};
window.renderSettingsDrawer = () => {
    const container = document.querySelector('.navDrawerItemsContainer');
    container.replaceChildren();
    // This is the shared filter in Emby's getAppSettingsMenuItems(), also used
    // by getSettingsDrawerHtml() for the full settings overview.
    container.items = [{Name: 'General', href: '/settings/general', Icon: '&#xe8b8;'},
        ...settingsRoutes.filter(route => route.type === 'settings' && route.settingsType !== 'user')
            .map(route => ({Name: route.title, href: route.path, Icon: route.icon}))];
    container.getItem = index => container.items[index];
    container.items.forEach((item, index) => {
        const button = document.createElement('button');
        button.className = 'navMenuOption navDrawerListItem listItem';
        button.dataset.index = index;
        const content = document.createElement('div');
        content.className = 'navMenuOption-listItem-content listItem-content';
        const image = document.createElement('div');
        image.className = 'navDrawerListItemImageContainer listItemImageContainer';
        const icon = document.createElement('i');
        icon.className = 'md-icon navDrawerListItemIcon';
        icon.innerHTML = item.Icon;
        image.append(icon);
        const label = document.createElement('div');
        label.className = 'listItemBody navDrawerListItemBody';
        const text = document.createElement('span');
        text.className = 'listItemBodyText';
        text.textContent = item.Name;
        label.append(text);
        content.append(image, label); button.append(content); container.append(button);
        button.addEventListener('click', () => settingsRouter.show(item.href));
    });
};
window.openSettingsCategory = async section => {
    document.querySelector(`[data-settings-category="${section}"]`).click();
    await new Promise(resolve => setTimeout(resolve, 50));
};
renderSettingsDrawer();
tigerestInstallSettingsMenu();
