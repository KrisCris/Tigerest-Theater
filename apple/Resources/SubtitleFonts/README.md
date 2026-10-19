# Apple subtitle font

`SourceHanSansSC-Regular.otf` is the unmodified Adobe Source Han Sans SC
Regular font from the official release tree at commit
`a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2`:

https://github.com/adobe-fonts/source-han-sans/blob/a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2/OTF/SimplifiedChinese/SourceHanSansSC-Regular.otf

SHA-256: `f1d8611151880c6c336aabeac4640ef434fa13cbfbf1ffe82d0a71b2a5637256`

It is distributed under the SIL Open Font License 1.1 in `LICENSE.txt`.
The TV generator bundles the font under `SubtitleFonts` and the license under
`Web/licenses/SourceHanSans-LICENSE.txt`. The iPad generator bundles this directory
as `SubtitleFonts`, including its license.

Both Apple players set MPV's default subtitle family and font directory. Authored ASS styles
and embedded fonts remain enabled, with no forced style overrides.
