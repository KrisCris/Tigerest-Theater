import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from sync_resources import sync, ROOT
class QualityResourcesTests(unittest.TestCase):
    def test_mac_profiles_ship_exact_shaders_and_inherited_parameters(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory);sync(output)
            profiles=json.loads((output/'quality_presets.json').read_text())
            self.assertEqual([p['id'] for p in profiles], ['tigerest-default','tigerest-liveaction','tigerest-aggressive-test'])
            self.assertEqual([len(p['shaders']) for p in profiles],[3,2,4])
            self.assertEqual(profiles[0]['options']['scale-antiring'],'0.95')
            self.assertEqual(profiles[1]['options']['scale-antiring'],'0.7')
            self.assertEqual(profiles[2]['options']['scale-antiring'],'0.5')
            for profile in profiles:
                self.assertEqual(profile['base'],'high-quality')
                self.assertEqual(profile['options']['tone-mapping'],'bt.2446a')
                for relative in profile['shaders']:
                    self.assertEqual((output/relative).read_bytes(),(ROOT/'resources/mpv'/relative).read_bytes())
                    manifest=json.loads((output/'manifest.json').read_text())
                    self.assertEqual(manifest['files'][relative],hashlib.sha256((output/relative).read_bytes()).hexdigest())
if __name__=='__main__':unittest.main()
