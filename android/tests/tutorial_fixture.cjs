// This preference belongs only to the disposable debug profile. Gesture tests opt in to the real first-run flow.
const {execFileSync}=require('node:child_process');
module.exports=function prepareTutorialFixture(){
 const adb=process.env.ADB||'C:/platform-tools-latest-windows/platform-tools/adb.exe',serial=process.env.ANDROID_SERIAL||'cd8bdd86';
 execFileSync(adb,['-s',serial,'shell','run-as','top.tigerest.theater.debug','sh'],{encoding:'utf8',windowsHide:true,input:'mkdir -p shared_prefs\nprintf \'%s\' \'<?xml version="1.0" encoding="utf-8"?><map><boolean name="gesturesTutorialSeen" value="true" /></map>\' > shared_prefs/player-ui.xml\n'});
};
